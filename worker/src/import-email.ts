import PostalMime from 'postal-mime';
import * as XLSX from 'xlsx';
import { autoDetectMapping } from '../../shared/importMapping';
import type { Env } from './index';
import * as db from './db';
import { executeImport, parseCsv } from './routes/imports';

// Cloudflare Email Routing → Worker email-in (Ask 3). A bank statement forwarded to
// `ingest+<EMAIL_INGEST_SECRET>@<your-domain>` lands here: CSV/XLSX attachments are auto-mapped
// (shared autoDetectMapping) and imported into EMAIL_INGEST_PROFILE_ID via the shared
// executeImport, so dedup is automatic. Disabled unless EMAIL_INGEST_SECRET +
// EMAIL_INGEST_PROFILE_ID are set. The secret lives in the recipient's +tag, so only someone who
// knows the address can reach it; an optional sender allowlist is a second guard.

// Length-independent compare so a wrong secret can't be narrowed by timing the response.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Extract the +tag from a recipient local part: "ingest+SECRET@d.com" -> "SECRET".
function plusTag(address: string): string | null {
  const at = address.indexOf('@');
  const local = at === -1 ? address : address.slice(0, at);
  const plus = local.indexOf('+');
  return plus === -1 ? null : local.slice(plus + 1);
}

interface ParsedTable {
  headers: string[];
  rows: string[][];
}

// Parse a CSV or XLSX attachment into { headers, rows }; null for anything else.
export function parseAttachment(
  filename: string,
  mimeType: string,
  bytes: Uint8Array
): ParsedTable | null {
  const name = (filename || '').toLowerCase();
  const mime = (mimeType || '').toLowerCase();
  const isCsv = name.endsWith('.csv') || mime === 'text/csv';
  const isXlsx =
    /\.(xlsx|xls)$/.test(name) || mime.includes('spreadsheet') || mime.includes('excel');
  if (isCsv) return parseCsv(new TextDecoder().decode(bytes));
  if (isXlsx) {
    const wb = XLSX.read(bytes, { type: 'array' });
    const first = wb.SheetNames[0];
    const sheet = first ? wb.Sheets[first] : undefined;
    if (!sheet) return null;
    const matrix = XLSX.utils.sheet_to_json<any[]>(sheet, {
      header: 1,
      blankrows: false,
      defval: '',
    });
    const headers = (matrix[0] as any[] | undefined)?.map((h) => String(h ?? '')) ?? [];
    const rows = matrix
      .slice(1)
      .filter((r) => Array.isArray(r) && r.some((cell) => cell !== '' && cell != null))
      .map((r) => (r as any[]).map((cell) => String(cell ?? '')));
    return { headers, rows };
  }
  return null;
}

function toBytes(content: unknown): Uint8Array {
  if (content instanceof Uint8Array) return content;
  if (content instanceof ArrayBuffer) return new Uint8Array(content);
  if (typeof content === 'string') return new TextEncoder().encode(content);
  return new Uint8Array(0);
}

export async function handleIngestEmail(message: ForwardableEmailMessage, env: Env): Promise<void> {
  const secret = env.EMAIL_INGEST_SECRET;
  const profileId = Number(env.EMAIL_INGEST_PROFILE_ID);
  if (!secret || !Number.isFinite(profileId) || profileId <= 0) {
    message.setReject('Email ingestion is not configured');
    return;
  }
  const tag = plusTag(message.to || '');
  if (!tag || !safeEqual(tag, secret)) {
    message.setReject('Unauthorized');
    return;
  }
  const allow = (env.EMAIL_INGEST_ALLOWED_SENDERS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (allow.length > 0 && !allow.includes((message.from || '').toLowerCase())) {
    message.setReject('Sender not allowed');
    return;
  }

  try {
    const email = await PostalMime.parse(message.raw);
    const attachments = Array.isArray(email.attachments) ? email.attachments : [];
    let totalImported = 0;
    let totalDupes = 0;
    for (const att of attachments) {
      const table = parseAttachment(att.filename || '', att.mimeType || '', toBytes(att.content));
      if (!table || table.headers.length === 0 || table.rows.length === 0) continue;
      const mapping = autoDetectMapping(table.headers);
      // Without at least a date and amount column the rows can't be turned into transactions.
      if (mapping.date === undefined || mapping.amount === undefined) continue;
      const importId = crypto.randomUUID();
      const outcome = await executeImport(env.DB, profileId, {
        rows: table.rows,
        mapping,
        importId,
      });
      const body = outcome.body as Record<string, unknown>;
      const imp = Number(body.imported ?? 0);
      const dup = Number(body.duplicates ?? 0);
      totalImported += imp;
      totalDupes += dup;
      if (imp > 0 || dup > 0) {
        await db.insert(env.DB, 'import_logs', {
          profile_id: profileId,
          import_id: importId,
          source: `Email import (${(att.filename || 'attachment').slice(0, 120)})`,
          imported: imp,
          duplicates_skipped: dup,
          accounts_created: Number(body.accounts_created ?? 0),
          categories_created: Number(body.categories_created ?? 0),
          details: JSON.stringify({ mode: 'email-in', from: message.from }),
        });
      }
    }
    if (totalImported === 0 && totalDupes === 0) {
      message.setReject('No importable CSV/XLSX attachment found');
      return;
    }
    console.log('[email-in] imported', totalImported, 'dupes', totalDupes, 'from', message.from);
  } catch (err) {
    console.error('[email-in] failed:', err instanceof Error ? err.message : err);
    message.setReject('Could not process the message');
  }
}
