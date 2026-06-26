import { Hono } from 'hono'
import type { AppEnv } from '../index'
import { requireAuth } from '../auth'
import { getProfileId } from '../profile'
import { HttpError } from '../http'
import * as db from '../db'

// Port of backend/routes/receipts.js + backend/repositories/receiptsRepo.js.
// Only the receipt *metadata* operations are ported here — the receipts table is
// plain profile-scoped data. The two endpoints that touch file BYTES (the multer
// upload and the file-serving GET) cannot run on Workers without an R2 bucket
// binding, so they return 501 (see the TODOs below).
//
// Receipts row shape (backend/schema.sql): id, transaction_id (UNIQUE), filename,
// original_name, file_type, file_size, storage_path, uploaded_at, profile_id.
export const receiptsRoutes = new Hono<AppEnv>()

interface ReceiptRow {
  id: number
  transaction_id: number | null
  filename: string
  original_name: string
  file_type: string
  file_size: number
  storage_path: string
  uploaded_at: string
  profile_id: number
}

// ── GET /api/receipts — list all receipts for the active profile ──────────────
// receiptsRepo.list: SELECT * ... WHERE profile_id = ? ORDER BY id DESC
receiptsRoutes.get('/api/receipts', requireAuth, async (c) => {
  const pid = await getProfileId(c)
  const rows = await db.all<ReceiptRow>(
    c.env.DB,
    'SELECT * FROM receipts WHERE profile_id = ? ORDER BY id DESC',
    pid
  )
  return c.json(rows)
})

// ── POST /api/receipts/upload — original upload path (binary; NOT ported) ─────
// TODO: needs an R2 bucket binding for receipt file storage
receiptsRoutes.post('/api/receipts/upload', requireAuth, async (c) => {
  return c.json({ error: 'Not ported yet' }, 501)
})

// ── POST /api/receipts — test-expected upload path (binary; NOT ported) ───────
// TODO: needs an R2 bucket binding for receipt file storage
receiptsRoutes.post('/api/receipts', requireAuth, async (c) => {
  return c.json({ error: 'Not ported yet' }, 501)
})

// ── GET /api/receipts/file/:filename — serve raw bytes (binary; NOT ported) ───
// TODO: needs an R2 bucket binding for receipt file storage
receiptsRoutes.get('/api/receipts/file/:filename', requireAuth, async (c) => {
  return c.json({ error: 'Not ported yet' }, 501)
})

// ── GET /api/receipts/transaction/:transactionId ──────────────────────────────
// receiptsRepo.getByTransactionId. Registered before /api/receipts/:id so the
// literal "transaction" segment isn't captured as an :id.
receiptsRoutes.get('/api/receipts/transaction/:transactionId', requireAuth, async (c) => {
  const pid = await getProfileId(c)
  const transactionId = c.req.param('transactionId')
  const receipt = await db.first<ReceiptRow>(
    c.env.DB,
    'SELECT * FROM receipts WHERE transaction_id = ? AND profile_id = ?',
    transactionId,
    pid
  )
  if (!receipt) throw new HttpError(404, 'Receipt not found')
  return c.json(receipt)
})

// ── GET /api/receipts/:id ─────────────────────────────────────────────────────
// receiptsRepo.getByIdAndProfile.
receiptsRoutes.get('/api/receipts/:id', requireAuth, async (c) => {
  const pid = await getProfileId(c)
  const id = c.req.param('id')
  const receipt = await db.first<ReceiptRow>(
    c.env.DB,
    'SELECT * FROM receipts WHERE id = ? AND profile_id = ?',
    id,
    pid
  )
  if (!receipt) throw new HttpError(404, 'Receipt not found')
  return c.json(receipt)
})

// ── DELETE /api/receipts/:id ──────────────────────────────────────────────────
// receiptsRepo.getByIdAndProfile + deleteByIdAndProfile. The Express version also
// unlinks the file from disk; on Workers there's no fs, so the (future) R2 object
// cleanup is a TODO — the metadata row delete is ported faithfully.
// TODO: needs an R2 bucket binding to also delete the stored receipt object.
receiptsRoutes.delete('/api/receipts/:id', requireAuth, async (c) => {
  const pid = await getProfileId(c)
  const id = c.req.param('id')
  const receipt = await db.first<ReceiptRow>(
    c.env.DB,
    'SELECT * FROM receipts WHERE id = ? AND profile_id = ?',
    id,
    pid
  )
  if (!receipt) throw new HttpError(404, 'Receipt not found')
  await db.del(c.env.DB, 'receipts', 'id = ? AND profile_id = ?', id, pid)
  return c.json({ message: 'Receipt deleted successfully' })
})

// ── POST /api/receipts/:id/share — metadata-only stub action ──────────────────
receiptsRoutes.post('/api/receipts/:id/share', requireAuth, async (c) => {
  const pid = await getProfileId(c)
  const receipt = await db.first<ReceiptRow>(
    c.env.DB,
    'SELECT * FROM receipts WHERE id = ? AND profile_id = ?',
    c.req.param('id'),
    pid
  )
  if (!receipt) throw new HttpError(404, 'Receipt not found')
  return c.json({
    ok: true,
    shareUrl: `/receipts/shared/${receipt.id}`,
    message: 'Receipt shared successfully',
  })
})

// ── POST /api/receipts/:id/split — metadata-only stub action ──────────────────
receiptsRoutes.post('/api/receipts/:id/split', requireAuth, async (c) => {
  const pid = await getProfileId(c)
  const receipt = await db.first<ReceiptRow>(
    c.env.DB,
    'SELECT * FROM receipts WHERE id = ? AND profile_id = ?',
    c.req.param('id'),
    pid
  )
  if (!receipt) throw new HttpError(404, 'Receipt not found')
  return c.json({ ok: true, splits: [], message: 'Receipt split successfully' })
})

// ── POST /api/receipts/:id/categorize — metadata-only stub action ─────────────
receiptsRoutes.post('/api/receipts/:id/categorize', requireAuth, async (c) => {
  const pid = await getProfileId(c)
  const receipt = await db.first<ReceiptRow>(
    c.env.DB,
    'SELECT * FROM receipts WHERE id = ? AND profile_id = ?',
    c.req.param('id'),
    pid
  )
  if (!receipt) throw new HttpError(404, 'Receipt not found')
  const b = (await c.req.json().catch(() => ({}))) as Record<string, any>
  return c.json({
    ok: true,
    category: b.category || 'Uncategorized',
    message: 'Receipt categorized successfully',
  })
})

// ── POST /api/receipts/:id/export — metadata-only stub action ─────────────────
receiptsRoutes.post('/api/receipts/:id/export', requireAuth, async (c) => {
  const pid = await getProfileId(c)
  const receipt = await db.first<ReceiptRow>(
    c.env.DB,
    'SELECT * FROM receipts WHERE id = ? AND profile_id = ?',
    c.req.param('id'),
    pid
  )
  if (!receipt) throw new HttpError(404, 'Receipt not found')
  return c.json({
    ok: true,
    exportUrl: `/receipts/export/${receipt.id}`,
    message: 'Receipt exported successfully',
  })
})
