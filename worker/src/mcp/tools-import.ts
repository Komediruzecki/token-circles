import { z } from 'zod';
import { defineTool, guardSize, MAX_ROWS } from './registry';
import { signCapability, CAPABILITY_TTL_SECONDS } from '../signed-url';
import { recomputeBalancesForAccounts } from '../recompute-balances';
import { HttpError } from '../http';
import * as db from '../db';

// Import tools. prepare_import hands out a capability rather than accepting bytes: a base64'd
// spreadsheet inside a tool argument would be emitted token-by-token by the model, which is
// slow, expensive and truncation-prone. The bytes go around the model, not through it.

import { profileArg } from './args';

defineTool({
  name: 'prepare_import',
  title: 'Prepare a document import',
  description:
    'Get a short-lived upload URL for a CSV or XLSX bank statement, plus a ready-to-run curl command. Upload the file with curl - do NOT read the file into a tool argument. Use mode "preview" first to see the detected column mapping and a duplicate estimate without writing anything, then mode "commit". Columns are auto-detected; the server refuses the file if fewer than 95 percent of rows have a readable date and amount.',
  scope: 'import',
  input: z
    .object({
      ...profileArg,
      mode: z
        .enum(['preview', 'commit'])
        .default('preview')
        .describe('preview writes nothing; commit imports.'),
      importId: z
        .string()
        .min(1)
        .max(100)
        .optional()
        .describe(
          'Leave unset for a routine. A fresh id relies on content dedup and adds only new rows; a stable id REPLACES that batch, which discards categorization applied since.'
        ),
      autoCreateCategories: z
        .boolean()
        .default(false)
        .describe(
          'Create categories named in the file. Off by default so a memo column cannot mint a taxonomy.'
        ),
    })
    .strict(),
  handler: async (c, args, profileId) => {
    const secret = c.env.JWT_SECRET;
    if (!secret) throw new HttpError(503, 'Server is not configured for signed uploads.');

    const importId = args.importId ?? crypto.randomUUID();
    const sig = await signCapability(
      {
        tokenId: c.get('token')?.tokenId ?? 'unknown',
        userId: c.get('userId'),
        profileId,
        purpose: 'import',
      },
      secret
    );
    const origin = c.env.API_PUBLIC_ORIGIN ?? new URL(c.req.url).origin;
    const qs = new URLSearchParams({
      sig,
      mode: args.mode,
      importId,
      autoCreateCategories: String(args.autoCreateCategories),
    });
    const uploadUrl = `${origin}/api/v1/import?${qs}`;

    return {
      uploadUrl,
      method: 'POST',
      fileField: 'file',
      importId,
      mode: args.mode,
      expiresInSeconds: CAPABILITY_TTL_SECONDS,
      curl: `curl -fsS -X POST "${uploadUrl}" -F "file=@/path/to/statement.csv"`,
      guidance:
        args.importId === undefined
          ? 'This importId is fresh, which is what a repeating routine wants: re-running the same statement adds only genuinely new rows and leaves existing ones (and their categories) alone.'
          : 'You pinned an importId. Committing again with it REPLACES that batch: the previous rows are deleted and reinserted, so any categorization applied to them since is lost.',
    };
  },
});

defineTool({
  name: 'list_imports',
  title: 'List recent imports',
  description:
    'Recent import batches for the profile, newest first, with row counts and source filenames. Use this to check whether a statement has already been imported before importing it again.',
  scope: 'import',
  input: z
    .object({ ...profileArg, limit: z.number().int().min(1).max(MAX_ROWS).default(20) })
    .strict(),
  handler: async (c, args, profileId) => {
    const rows = await db.all<Record<string, unknown>>(
      c.env.DB,
      `SELECT import_id AS importId, source, imported, duplicates_skipped AS duplicatesSkipped,
              accounts_created AS accountsCreated, categories_created AS categoriesCreated,
              created_at AS createdAt
         FROM import_logs
        WHERE profile_id = ?
        ORDER BY datetime(created_at) DESC, id DESC
        LIMIT ?`,
      profileId,
      args.limit
    );
    return guardSize({ imports: rows });
  },
});

defineTool({
  name: 'undo_import',
  title: 'Undo an import batch',
  description:
    'Delete every transaction that came from one import batch, identified by its importId, and remove the log entry. Scoped to this profile - an id belonging to another profile deletes nothing. This is the only delete this server offers.',
  scope: 'import',
  input: z.object({ ...profileArg, importId: z.string().min(1).max(100) }).strict(),
  handler: async (c, args, profileId) => {
    const removed = await db.run(
      c.env.DB,
      'DELETE FROM transactions WHERE profile_id = ? AND import_id = ?',
      profileId,
      args.importId
    );
    const deleted = removed.meta.changes ?? 0;
    // Account balances are stored, not derived, so deleting rows without this leaves every
    // touched account silently wrong. routes/import-logs.ts does exactly the same after its
    // own batch delete; this mirrors it.
    if (deleted > 0) {
      const accounts = await db.all<{ id: number }>(
        c.env.DB,
        'SELECT id FROM accounts WHERE profile_id = ?',
        profileId
      );
      await recomputeBalancesForAccounts(
        c.env.DB,
        accounts.map((r) => r.id)
      );
    }
    await db.run(
      c.env.DB,
      'DELETE FROM import_logs WHERE profile_id = ? AND import_id = ?',
      profileId,
      args.importId
    );
    return { importId: args.importId, deleted };
  },
});
