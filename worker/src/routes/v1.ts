import { Hono } from 'hono';
import type { Context } from 'hono';
import { autoDetectMapping } from '../../../shared/importMapping';
import { detectBank, getAdapter, processFiles, toDetectInput } from '../../../shared/bankImport';
import type { BankId } from '../../../shared/bankImport';
import type { AppEnv } from '../index';
import { HttpError } from '../http';
import { verifyCapability } from '../signed-url';
import { assessImport } from '../import-gate';
import { parseAttachment } from '../import-email';
import { executeImport, IMPORT_MAX_BYTES } from './imports';
import { enforce } from '../ratelimit';
import * as db from '../db';

// The ingest surface. Authenticated by a short-lived signed capability rather than the bearer
// token itself, so the model that runs the curl never holds a long-lived credential -- and,
// more importantly, the file bytes never travel through an MCP tool argument.
export const v1Routes = new Hono<AppEnv>();

v1Routes.post('/api/v1/import', async (c) => {
  const secret = c.env.JWT_SECRET;
  if (!secret) throw new HttpError(503, 'Server is not configured for signed uploads.');

  const cap = await verifyCapability(c.req.query('sig') ?? '', 'import', secret);
  if (!cap) return c.json({ error: 'Invalid or expired upload link.' }, 401);

  // The capability names a profile; confirm it still belongs to the user it was minted for.
  // A profile can be deleted or reassigned inside the 15-minute window.
  const owned = await db.first(
    c.env.DB,
    'SELECT 1 AS ok FROM profiles WHERE id = ? AND user_id = ?',
    cap.profileId,
    cap.userId
  );
  if (!owned) throw new HttpError(403, 'That profile does not belong to this user.');

  // Its own bucket: sharing `import:` with the three cookie-authed UI import routes let an
  // agent's batch upload spend the quota a person needs to import a file by hand.
  const limited = await enforce(c, `apiimport:${cap.userId}`, 30, 300);
  if (limited) return limited;

  const form = await c.req.parseBody();
  const file = form['file'];
  if (!(file instanceof File)) throw new HttpError(400, 'No file uploaded (field name: file).');
  if (file.size > IMPORT_MAX_BYTES) {
    throw new HttpError(
      413,
      `File too large (max ${Math.round(IMPORT_MAX_BYTES / 1024 / 1024)}MB)`
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  // Bank adapters first, generic CSV only as a fallback. The generic path guesses a column
  // mapping from row 1's headers, which assumes a file that is already app-shaped: header on
  // the first line, one signed amount column, UTF-8, comma-separated. Real exports usually
  // aren't -- an ERSTE statement is CP1250, semicolon-delimited, carries a bank preamble line
  // above its header, and splits debit and credit into `Isplate`/`Uplate`. The adapters encode
  // exactly those per-bank quirks, so trying them first is what makes the API accept the same
  // files the Bank Imports tab accepts. See shared/bankImport/registry.ts for the adapter list.
  const parsed =
    (await parseViaBank(c, file.name, bytes, cap.profileId)) ?? parseViaGenericCsv(file, bytes);

  const mapping = autoDetectMapping(parsed.headers);
  const table = { headers: parsed.headers, rows: parsed.rows };
  const gate = assessImport(table.rows, mapping);
  if (!gate.ok) {
    return c.json(
      {
        error: gate.reason,
        mapping,
        headers: table.headers,
        parsedBy: parsed.parsedBy,
        bank: parsed.bank ?? null,
        warnings: parsed.warnings,
        dateParseRate: gate.dateParseRate,
        amountParseRate: gate.amountParseRate,
        sample: gate.failing,
      },
      422
    );
  }

  const mode = c.req.query('mode') === 'preview' ? 'preview' : 'commit';
  // Fresh by default. A stable importId makes executeImport delete the prior batch and reinsert,
  // which churns transaction ids and drops any categorization applied since; a fresh one falls
  // through to content dedup, which adds only genuinely new rows. See import-sync.ts for the
  // same reasoning on the daily sheet sync.
  const importId = c.req.query('importId') ?? crypto.randomUUID();
  const autoCreateCategories = c.req.query('autoCreateCategories') === 'true';

  // executeImport creates an account only for a name the caller marks as one -- in the app, from
  // the tick-boxes in the import preview. An API caller has no preview to tick, so marking
  // nothing meant every row landed with account_id NULL: 94 transactions belonging to no
  // account, reported as a clean import. Mark the account the rows were actually booked
  // against, which on the bank path is the one ?account= named (or the adapter label we warned
  // about falling back to).
  const accountNames = new Set<string>();
  if (parsed.targetAccount) accountNames.add(parsed.targetAccount);
  // The generic path's means-of-payment values are whatever the file says, so minting accounts
  // from them stays opt-in -- the same reasoning that gates category creation.
  if (c.req.query('autoCreateAccounts') === 'true' && mapping.means_of_payment !== undefined) {
    for (const row of table.rows) {
      const name = String(row[mapping.means_of_payment] ?? '').trim();
      if (name) accountNames.add(name);
    }
  }
  const categoryTypes = Object.fromEntries([...accountNames].map((n) => [n, 'account']));

  const outcome = await executeImport(c.env.DB, cap.profileId, {
    rows: table.rows,
    mapping,
    importId,
    dryRun: mode === 'preview',
    ...(accountNames.size ? { categoryTypes } : {}),
    // An empty approved list is not "no opinion" -- it is the gate that imports rows
    // uncategorized instead of minting a taxonomy out of a bank's memo column.
    ...(autoCreateCategories ? {} : { approvedCategories: [] }),
  });
  if (outcome.status >= 400) return c.json(outcome.body, outcome.status as 400);

  const body = outcome.body as Record<string, unknown>;
  const imported = Number(body.imported ?? 0);
  const duplicates = Number(body.duplicates ?? 0);

  // Logged even when nothing landed: "the routine ran and found nothing new" and "the routine
  // never ran" are different answers, and only the log can tell them apart.
  if (mode === 'commit') {
    await db.insert(c.env.DB, 'import_logs', {
      profile_id: cap.profileId,
      import_id: importId,
      source: `API import (${file.name.slice(0, 120)})`,
      imported,
      duplicates_skipped: duplicates,
      accounts_created: Number(body.accounts_created ?? 0),
      categories_created: Number(body.categories_created ?? 0),
      details: JSON.stringify({
        mode: 'api-v1',
        tokenId: cap.tokenId,
        parsedBy: parsed.parsedBy,
        ...(parsed.bank ? { bank: parsed.bank.id } : {}),
      }),
    });
  }

  return c.json({
    importId,
    mode,
    imported,
    duplicates,
    accountsCreated: Number(body.accounts_created ?? 0),
    categoriesCreated: Number(body.categories_created ?? 0),
    // executeImport calls these "skipped": rows it could not turn into a transaction.
    skipped: Number(body.skipped ?? 0),
    skippedItems: Array.isArray(body.skipped_items) ? body.skipped_items : [],
    newAccounts: Array.isArray(body.new_accounts) ? body.new_accounts : [],
    newCategories: Array.isArray(body.new_categories) ? body.new_categories : [],
    mapping,
    headers: table.headers,
    dateParseRate: gate.dateParseRate,
    amountParseRate: gate.amountParseRate,
    warnings: [...(Array.isArray(body.warnings) ? body.warnings : []), ...parsed.warnings],
    sample: gate.failing,
    parsedBy: parsed.parsedBy,
    bank: parsed.bank ?? null,
    targetAccount: parsed.targetAccount ?? null,
    // Source rows the adapter saw twice in this one file (overlapping export ranges). Reported,
    // not dropped: executeImport stays the single authority on what actually gets inserted.
    withinBatchDuplicates: parsed.withinBatchDuplicates,
  });
});

/** A file turned into an app-shaped table, plus how that was achieved. */
interface ParsedUpload {
  headers: string[];
  rows: string[][];
  /** 'bank:<id>' when an adapter handled it, 'generic-csv' for the header-guessing path. */
  parsedBy: string;
  bank?: { id: BankId; label: string; confidence: number };
  targetAccount?: string;
  withinBatchDuplicates: number;
  warnings: string[];
}

/**
 * Run the file through the matching bank adapter, or return null to fall back.
 *
 * Null means "the adapters can't do this one" -- either none recognized the file, or the one
 * that did failed to produce rows. Both fall through to the generic CSV path rather than
 * failing the request, so a plain app-shaped CSV still imports and a bank export that an
 * adapter half-recognizes isn't worse off than before this path existed.
 */
async function parseViaBank(
  c: Context<AppEnv>,
  filename: string,
  bytes: Uint8Array,
  profileId: number
): Promise<ParsedUpload | null> {
  const forced = c.req.query('bank') as BankId | undefined;
  const adapter = forced ? getAdapter(forced) : undefined;
  if (forced && !adapter) throw new HttpError(400, `Unknown bank '${forced}'.`);

  const detected = adapter ? null : detectBank(toDetectInput(filename, bytes));
  if (!adapter && !detected) return null;

  const bankId = adapter?.id ?? detected!.adapter.id;
  const label = adapter?.label ?? detected!.adapter.label;
  const confidence = adapter ? 1 : detected!.confidence;

  // Transfer counterpart resolution needs the profile's account names: an adapter can only
  // name the other end of an internal transfer if it can recognize it as an account.
  const accounts = await db.all<{ name: string }>(
    c.env.DB,
    'SELECT name FROM accounts WHERE profile_id = ?',
    profileId
  );
  const knownAccounts = accounts.map((a) => a.name);

  // Without a target account the adapter falls back to its own label, which imports the rows
  // against an account named e.g. "Erste" instead of the caller's real one. Let the caller say.
  const targetAccount = c.req.query('account') ?? undefined;

  const result = await processFiles(
    [{ filename, bytes, bankId, targetAccount }],
    // The Worker has no localStorage, so the user's edited rule sets aren't reachable here;
    // processFiles falls back to the same defaults the UI ships with.
    { knownAccounts, xlsx: () => import('xlsx') }
  );

  const failed = result.perFile.find((f) => f.error);
  if (failed || result.rows.length === 0) return null;

  return {
    headers: result.headers,
    rows: result.rows,
    parsedBy: `bank:${bankId}`,
    bank: { id: bankId, label, confidence },
    targetAccount: result.perFile[0]?.targetAccount,
    withinBatchDuplicates: result.duplicateIndices.length,
    warnings: result.warnings,
  };
}

/** The original path: read the file as a table and guess the mapping from its header row. */
function parseViaGenericCsv(file: File, bytes: Uint8Array): ParsedUpload {
  const table = parseAttachment(file.name, file.type, bytes);
  if (!table || table.headers.length === 0) {
    throw new HttpError(422, 'Could not read the file as CSV or XLSX.');
  }
  return {
    headers: table.headers,
    rows: table.rows,
    parsedBy: 'generic-csv',
    withinBatchDuplicates: 0,
    warnings: [],
  };
}

import { exportBackup } from '../backup';

// The download half of the byte-transport rule: export_snapshot hands the agent this URL
// instead of returning a whole account inline through a tool result.
v1Routes.get('/api/v1/snapshot', async (c) => {
  const secret = c.env.JWT_SECRET;
  if (!secret) throw new HttpError(503, 'Server is not configured for signed downloads.');

  const cap = await verifyCapability(c.req.query('sig') ?? '', 'snapshot', secret);
  if (!cap) return c.json({ error: 'Invalid or expired download link.' }, 401);

  const owned = await db.first(
    c.env.DB,
    'SELECT 1 AS ok FROM profiles WHERE id = ? AND user_id = ?',
    cap.profileId,
    cap.userId
  );
  if (!owned) throw new HttpError(403, 'That profile does not belong to this user.');

  const limited = await enforce(c, `snapshot:${cap.userId}`, 10, 300);
  if (limited) return limited;

  const data = await exportBackup(c.env, cap.userId, [cap.profileId]);

  // exportBackup base64-embeds every receipt file, which is correct for a backup and wrong
  // here: an agent pulling the ledger to analyse spending gets scans that dwarf the data and
  // answer none of its questions. Default to the numbers; make the bytes opt-in.
  const includeReceiptFiles = c.req.query('includeReceiptFiles') === 'true';
  const body = includeReceiptFiles
    ? { ...data, receiptFilesOmitted: false }
    : { ...data, receiptFiles: [], receiptFilesOmitted: true };

  c.header('Content-Disposition', 'attachment; filename="tokencircles-snapshot.json"');
  return c.json(body);
});
