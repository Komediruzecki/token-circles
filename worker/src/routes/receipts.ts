import { Hono } from 'hono';
import type { Context } from 'hono';
import type { AppEnv } from '../index';
import { requireAuth } from '../auth';
import { getProfileId } from '../profile';
import {
  requirePremium,
  receiptCountLimit,
  RECEIPT_ALLOWED_TYPES,
  RECEIPT_MAX_BYTES,
  receiptMaxBytes,
} from '../plan';
import { HttpError } from '../http';
import * as db from '../db';
import { keyringFor } from '../data-keys';
import { putReceipt, receiptStream } from '../sealed-objects';

// Port of backend/routes/receipts.js + backend/repositories/receiptsRepo.js.
// Only the receipt *metadata* operations are ported here — the receipts table is
// plain profile-scoped data. The two endpoints that touch file BYTES (the multer
// upload and the file-serving GET) cannot run on Workers without an R2 bucket
// binding, so they return 501 (see the TODOs below).
//
// Receipts row shape (backend/schema.sql): id, transaction_id (UNIQUE), filename,
// original_name, file_type, file_size, storage_path, uploaded_at, profile_id.
export const receiptsRoutes = new Hono<AppEnv>();

interface ReceiptRow {
  id: number;
  transaction_id: number | null;
  filename: string;
  original_name: string;
  file_type: string;
  file_size: number;
  storage_path: string;
  uploaded_at: string;
  profile_id: number;
  /** 0: the R2 object is the raw upload. 1: it is sealed under the owner's key (sealed-objects). */
  enc?: number;
}

// The enc marker is storage bookkeeping, not part of the receipt: no response carries it.
function publicReceipt<R extends { enc?: unknown }>(row: R): Omit<R, 'enc'> {
  const { enc: _enc, ...rest } = row;
  return rest;
}

// ── GET /api/receipts — list all receipts for the active profile ──────────────
// receiptsRepo.list: SELECT * ... WHERE profile_id = ? ORDER BY id DESC
receiptsRoutes.get('/api/receipts', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const rows = await db.all<ReceiptRow>(
    c.env.DB,
    'SELECT * FROM receipts WHERE profile_id = ? ORDER BY id DESC',
    pid
  );
  return c.json(rows.map(publicReceipt));
});

// ── Upload (PREMIUM) — store the file in R2, save metadata in D1 ───────────────
// Receipt file storage is gated to paid plans (plan.ts) so free accounts don't
// accumulate binary data. Enforces type, per-file size and per-profile count limits,
// and stores the object under the profile id.
async function handleUpload(c: Context<AppEnv>): Promise<Response> {
  await requirePremium(c);
  if (!c.env.RECEIPTS)
    throw new HttpError(501, 'Receipt storage is not configured (R2 bucket missing)');
  const pid = await getProfileId(c);

  const body = await c.req.parseBody();
  const file = body['receipt'] ?? body['file'];
  if (!(file instanceof File)) throw new HttpError(400, 'No receipt file uploaded');
  if (!RECEIPT_ALLOWED_TYPES.includes(file.type)) {
    throw new HttpError(400, `Unsupported file type: ${file.type || 'unknown'}`);
  }
  // Per plan, because an upload is bandwidth and R2 storage — the thing paid actually buys.
  // Falls back to the shared floor so a plan with no cap configured still refuses a huge file.
  const maxBytes = (await receiptMaxBytes(c)) || RECEIPT_MAX_BYTES;
  if (file.size > maxBytes) {
    throw new HttpError(413, `File too large (max ${Math.round(maxBytes / 1024 / 1024)}MB)`);
  }
  // Pre-flight, so an over-quota upload is refused before the file is streamed to R2. It is not
  // the enforcement: counting and then inserting leaves a window where two uploads both see
  // "one under the limit". The conditional INSERT further down is what actually holds the line.
  const countRow = await db.first<{ c: number }>(
    c.env.DB,
    'SELECT COUNT(*) AS c FROM receipts WHERE profile_id = ?',
    pid
  );
  const limit = await receiptCountLimit(c);
  if (limit !== null && (countRow?.c ?? 0) >= limit) {
    throw new HttpError(403, `Receipt limit reached (${limit} per profile)`);
  }

  const txRaw = body['transaction_id'];
  const transactionId = typeof txRaw === 'string' && txRaw ? Number(txRaw) : null;

  // The transaction must belong to the active profile. Without this check a caller could attach a
  // receipt to ANOTHER profile's transaction id, and since receipts.transaction_id is globally
  // UNIQUE that also blocks the real owner from ever attaching one (collision DoS).
  if (transactionId !== null) {
    const ownsTx = await db.first<{ id: number }>(
      c.env.DB,
      'SELECT id FROM transactions WHERE id = ? AND profile_id = ?',
      transactionId,
      pid
    );
    if (!ownsTx) throw new HttpError(404, 'Transaction not found');
  }

  // receipts.transaction_id is UNIQUE — re-uploading for the same transaction replaces the
  // previous receipt (drop its row + R2 object first) rather than hitting a UNIQUE 500. The row
  // goes first and names its object as it stood when deleted (see the DELETE route for why).
  if (transactionId !== null) {
    const prev = await db.writeReturning<{ storage_path: string | null }>(
      c.env.DB,
      'DELETE FROM receipts WHERE transaction_id = ? AND profile_id = ? RETURNING storage_path',
      transactionId,
      pid
    );
    for (const { storage_path } of prev) {
      if (!storage_path) continue;
      await c.env.RECEIPTS.delete(storage_path).catch((e: unknown) => {
        console.error('R2 delete of replaced receipt failed:', e);
      });
    }
  }

  const ext =
    (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
  const key = `${pid}/${crypto.randomUUID()}.${ext}`;
  // Sealed under the user's key when they have one — streamed through the cipher, never buffered —
  // and stored exactly as before when they do not. `enc` says which, and both INSERTs record it.
  const enc = await putReceipt(
    keyringFor(c),
    c.get('userId'),
    c.env.RECEIPTS,
    key,
    file,
    file.type
  );

  let res: D1Result;
  try {
    // Conditional on the quota, evaluated as part of the write. The COUNT above is a read, and two
    // uploads arriving together — a phone finishing in the background while a laptop starts —
    // both read "one under the limit" and both inserted. One statement, so the second sees the
    // first's committed row and inserts nothing.
    res =
      limit === null
        ? await db.insert(c.env.DB, 'receipts', {
            transaction_id: transactionId,
            filename: key,
            original_name: file.name,
            file_type: file.type,
            file_size: file.size,
            storage_path: key,
            profile_id: pid,
            enc,
          })
        : await c.env.DB.prepare(
            `INSERT INTO receipts (transaction_id, filename, original_name, file_type, file_size, storage_path, profile_id, enc)
             SELECT ?, ?, ?, ?, ?, ?, ?, ?
             WHERE (SELECT COUNT(*) FROM receipts WHERE profile_id = ?) < ?`
          )
            .bind(transactionId, key, file.name, file.type, file.size, key, pid, enc, pid, limit)
            .run();
    if ((res.meta.changes ?? 0) === 0) {
      throw new HttpError(403, `Receipt limit reached (${limit ?? 0} per profile)`);
    }
  } catch (e) {
    // Don't orphan the R2 object if the metadata insert fails.
    await c.env.RECEIPTS.delete(key).catch((delErr: unknown) => {
      console.error('R2 cleanup delete after receipt insert failure failed:', delErr);
    });
    throw e;
  }
  const receipt = await db.first<ReceiptRow>(
    c.env.DB,
    'SELECT * FROM receipts WHERE id = ?',
    res.meta.last_row_id
  );
  return c.json(receipt && publicReceipt(receipt), 201);
}
receiptsRoutes.post('/api/receipts/upload', requireAuth, handleUpload);
receiptsRoutes.post('/api/receipts', requireAuth, handleUpload);

// Both file routes serve through here, so they cannot drift. A sealed object is opened on the way
// out through a streaming decrypt, never buffered; a plaintext one is the R2 body as before. The
// type comes from receipts.file_type: a sealed object is stored as application/octet-stream.
async function serveReceipt(
  c: Context<AppEnv>,
  bucket: R2Bucket,
  receipt: ReceiptRow
): Promise<Response> {
  const obj = await bucket.get(receipt.storage_path);
  if (!obj) throw new HttpError(404, 'File not found');
  const body = await receiptStream(keyringFor(c), c.get('userId'), obj, receipt.enc);
  return new Response(body, {
    headers: {
      'Content-Type': receipt.file_type || 'application/octet-stream',
      'Content-Disposition': `inline; filename="${receipt.original_name}"`,
      'Cache-Control': 'private, max-age=3600',
    },
  });
}

// ── GET /api/receipts/file/:filename — stream the file from R2 ─────────────────
// Scoped to the caller's profile (the Express version served any filename with no
// ownership check — fixed here), then streamed straight from R2.
receiptsRoutes.get('/api/receipts/file/:filename', requireAuth, async (c) => {
  if (!c.env.RECEIPTS)
    throw new HttpError(501, 'Receipt storage is not configured (R2 bucket missing)');
  const pid = await getProfileId(c);
  const receipt = await db.first<ReceiptRow>(
    c.env.DB,
    'SELECT * FROM receipts WHERE filename = ? AND profile_id = ?',
    c.req.param('filename'),
    pid
  );
  if (!receipt) throw new HttpError(404, 'Receipt not found');
  return serveReceipt(c, c.env.RECEIPTS, receipt);
});

// ── GET /api/receipts/:id/file — stream the file from R2 by receipt id ────────
// This is the path the frontend's api.getReceiptFile() uses (and what the serverless
// router serves); without it the receipt viewer 404s in server mode.
receiptsRoutes.get('/api/receipts/:id/file', requireAuth, async (c) => {
  if (!c.env.RECEIPTS)
    throw new HttpError(501, 'Receipt storage is not configured (R2 bucket missing)');
  const pid = await getProfileId(c);
  const receipt = await db.first<ReceiptRow>(
    c.env.DB,
    'SELECT * FROM receipts WHERE id = ? AND profile_id = ?',
    c.req.param('id'),
    pid
  );
  if (!receipt) throw new HttpError(404, 'Receipt not found');
  return serveReceipt(c, c.env.RECEIPTS, receipt);
});

// ── GET /api/receipts/transaction/:transactionId ──────────────────────────────
// receiptsRepo.getByTransactionId. Registered before /api/receipts/:id so the
// literal "transaction" segment isn't captured as an :id.
receiptsRoutes.get('/api/receipts/transaction/:transactionId', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const transactionId = c.req.param('transactionId');
  const receipt = await db.first<ReceiptRow>(
    c.env.DB,
    'SELECT * FROM receipts WHERE transaction_id = ? AND profile_id = ?',
    transactionId,
    pid
  );
  if (!receipt) throw new HttpError(404, 'Receipt not found');
  return c.json(publicReceipt(receipt));
});

// ── GET /api/receipts/:id ─────────────────────────────────────────────────────
// receiptsRepo.getByIdAndProfile.
receiptsRoutes.get('/api/receipts/:id', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const id = c.req.param('id');
  const receipt = await db.first<ReceiptRow>(
    c.env.DB,
    'SELECT * FROM receipts WHERE id = ? AND profile_id = ?',
    id,
    pid
  );
  if (!receipt) throw new HttpError(404, 'Receipt not found');
  return c.json(publicReceipt(receipt));
});

// ── DELETE /api/receipts/:id — remove the R2 object and the metadata row ──────
receiptsRoutes.delete('/api/receipts/:id', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const id = c.req.param('id');
  // The row goes first, and names the object it pointed at as it was deleted. The encryption
  // backfill moves a receipt to a new object and swaps the row to it at any moment; reading the
  // path, deleting that object and then the row left the new object behind with no row pointing
  // at it whenever the swap landed in between. Deleted first, the row can only name the current
  // object — and a swap that comes after finds no row and removes its own copy.
  const [deleted] = await db.writeReturning<{ storage_path: string | null }>(
    c.env.DB,
    'DELETE FROM receipts WHERE id = ? AND profile_id = ? RETURNING storage_path',
    id,
    pid
  );
  if (!deleted) throw new HttpError(404, 'Receipt not found');
  if (c.env.RECEIPTS && deleted.storage_path) {
    await c.env.RECEIPTS.delete(deleted.storage_path).catch((e: unknown) => {
      console.error('R2 delete of receipt failed:', e);
    });
  }
  return c.json({ message: 'Receipt deleted successfully' });
});

// ── POST /api/receipts/:id/share — metadata-only stub action ──────────────────
receiptsRoutes.post('/api/receipts/:id/share', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const receipt = await db.first<ReceiptRow>(
    c.env.DB,
    'SELECT * FROM receipts WHERE id = ? AND profile_id = ?',
    c.req.param('id'),
    pid
  );
  if (!receipt) throw new HttpError(404, 'Receipt not found');
  return c.json({
    ok: true,
    shareUrl: `/receipts/shared/${receipt.id}`,
    message: 'Receipt shared successfully',
  });
});

// ── POST /api/receipts/:id/split — metadata-only stub action ──────────────────
receiptsRoutes.post('/api/receipts/:id/split', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const receipt = await db.first<ReceiptRow>(
    c.env.DB,
    'SELECT * FROM receipts WHERE id = ? AND profile_id = ?',
    c.req.param('id'),
    pid
  );
  if (!receipt) throw new HttpError(404, 'Receipt not found');
  return c.json({ ok: true, splits: [], message: 'Receipt split successfully' });
});

// ── POST /api/receipts/:id/categorize — metadata-only stub action ─────────────
receiptsRoutes.post('/api/receipts/:id/categorize', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const receipt = await db.first<ReceiptRow>(
    c.env.DB,
    'SELECT * FROM receipts WHERE id = ? AND profile_id = ?',
    c.req.param('id'),
    pid
  );
  if (!receipt) throw new HttpError(404, 'Receipt not found');
  const b = (await c.req.json().catch(() => ({}))) as Record<string, any>;
  return c.json({
    ok: true,
    category: b.category || 'Uncategorized',
    message: 'Receipt categorized successfully',
  });
});

// ── POST /api/receipts/:id/export — metadata-only stub action ─────────────────
receiptsRoutes.post('/api/receipts/:id/export', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const receipt = await db.first<ReceiptRow>(
    c.env.DB,
    'SELECT * FROM receipts WHERE id = ? AND profile_id = ?',
    c.req.param('id'),
    pid
  );
  if (!receipt) throw new HttpError(404, 'Receipt not found');
  return c.json({
    ok: true,
    exportUrl: `/receipts/export/${receipt.id}`,
    message: 'Receipt exported successfully',
  });
});
