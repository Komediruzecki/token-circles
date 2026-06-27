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
} from '../plan';
import { HttpError } from '../http';
import * as db from '../db';

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
  return c.json(rows);
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
  if (file.size > RECEIPT_MAX_BYTES) {
    throw new HttpError(
      413,
      `File too large (max ${Math.round(RECEIPT_MAX_BYTES / 1024 / 1024)}MB)`
    );
  }
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

  // receipts.transaction_id is UNIQUE — re-uploading for the same transaction replaces the
  // previous receipt (drop its row + R2 object first) rather than hitting a UNIQUE 500.
  if (transactionId !== null) {
    const prev = await db.first<{ id: number; storage_path: string }>(
      c.env.DB,
      'SELECT id, storage_path FROM receipts WHERE transaction_id = ? AND profile_id = ?',
      transactionId,
      pid
    );
    if (prev) {
      await c.env.RECEIPTS.delete(prev.storage_path).catch(() => {});
      await db.del(c.env.DB, 'receipts', 'id = ?', prev.id);
    }
  }

  const ext =
    (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
  const key = `${pid}/${crypto.randomUUID()}.${ext}`;
  await c.env.RECEIPTS.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type },
  });

  let res: D1Result;
  try {
    res = await db.insert(c.env.DB, 'receipts', {
      transaction_id: transactionId,
      filename: key,
      original_name: file.name,
      file_type: file.type,
      file_size: file.size,
      storage_path: key,
      profile_id: pid,
    });
  } catch (e) {
    // Don't orphan the R2 object if the metadata insert fails.
    await c.env.RECEIPTS.delete(key).catch(() => {});
    throw e;
  }
  const receipt = await db.first(
    c.env.DB,
    'SELECT * FROM receipts WHERE id = ?',
    res.meta.last_row_id
  );
  return c.json(receipt, 201);
}
receiptsRoutes.post('/api/receipts/upload', requireAuth, handleUpload);
receiptsRoutes.post('/api/receipts', requireAuth, handleUpload);

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
  const obj = await c.env.RECEIPTS.get(receipt.storage_path);
  if (!obj) throw new HttpError(404, 'File not found');
  return new Response(obj.body, {
    headers: {
      'Content-Type': receipt.file_type || 'application/octet-stream',
      'Content-Disposition': `inline; filename="${receipt.original_name}"`,
      'Cache-Control': 'private, max-age=3600',
    },
  });
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
  return c.json(receipt);
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
  return c.json(receipt);
});

// ── DELETE /api/receipts/:id — remove the R2 object and the metadata row ──────
receiptsRoutes.delete('/api/receipts/:id', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const id = c.req.param('id');
  const receipt = await db.first<ReceiptRow>(
    c.env.DB,
    'SELECT * FROM receipts WHERE id = ? AND profile_id = ?',
    id,
    pid
  );
  if (!receipt) throw new HttpError(404, 'Receipt not found');
  if (c.env.RECEIPTS && receipt.storage_path) {
    await c.env.RECEIPTS.delete(receipt.storage_path).catch(() => {});
  }
  await db.del(c.env.DB, 'receipts', 'id = ? AND profile_id = ?', id, pid);
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
