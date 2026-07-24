/**
 * Receipts handlers — IndexedDB-backed implementations
 */
import { getDB } from '../idb'
import { adapter, currentProfileRecord, idParam, json, notFound, ok } from './helpers'

export async function receiptsUpload(body: unknown): Promise<Response> {
  try {
    const formData = body as FormData
    // The API client appends the file as 'receipt' (the worker accepts both keys)
    const file = (formData.get('receipt') ?? formData.get('file')) as File | null
    const transactionIdRaw = formData.get('transaction_id')

    if (!file) return json({ error: 'No file uploaded' }, 400)

    let transactionId: number | null = null
    if (transactionIdRaw && typeof transactionIdRaw === 'string') {
      transactionId = parseInt(transactionIdRaw, 10)
    }

    const fileData = await file.arrayBuffer()
    const profileId = await adapter.getCurrentProfileId()
    const filename = `${Date.now()}-${file.name}`
    const db = await getDB()
    if (transactionId !== null && !(await currentProfileRecord('transactions', transactionId))) {
      return notFound('Transaction')
    }

    // One receipt per transaction (mirrors the worker): re-upload replaces the old one
    if (transactionId !== null) {
      const previous = await db.getAllFromIndex('receipts', 'by_transaction', transactionId)
      for (const prev of previous) {
        if (prev.profile_id === profileId) await db.delete('receipts', prev.id)
      }
    }

    const id = (await db.add('receipts', {
      transaction_id: transactionId,
      filename,
      original_name: file.name,
      file_type: file.type || 'application/octet-stream',
      file_size: file.size,
      file_data: fileData,
      storage_path: '',
      profile_id: profileId,
      uploaded_at: new Date().toISOString(),
    })) as number

    return json({
      id,
      transaction_id: transactionId,
      filename,
      original_name: file.name,
      file_type: file.type || 'application/octet-stream',
      file_size: file.size,
      url: `/receipts/${filename}`,
      uploaded_at: new Date().toISOString(),
    })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
}

export async function receiptsGet(params: Record<string, string>): Promise<Response> {
  const receipt = await currentProfileRecord('receipts', idParam(params))
  if (!receipt) return notFound('Receipt')
  return json(receipt)
}

export async function receiptsDelete(params: Record<string, string>): Promise<Response> {
  const db = await getDB()
  const id = idParam(params)
  const receipt = await currentProfileRecord('receipts', id)
  if (!receipt) return notFound('Receipt')
  await db.delete('receipts', id)
  return ok()
}

export async function receiptsGetFile(params: Record<string, string>): Promise<Response> {
  const receipt = await currentProfileRecord('receipts', idParam(params))
  if (!receipt || !receipt.file_data) return notFound('Receipt file')

  const ext = receipt.original_name?.split('.').pop()?.toLowerCase()
  let contentType = receipt.file_type || 'application/octet-stream'
  if (!receipt.file_type || receipt.file_type === 'application/octet-stream') {
    const mimeMap: Record<string, string> = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      gif: 'image/gif',
      pdf: 'application/pdf',
      webp: 'image/webp',
    }
    if (ext && mimeMap[ext]) contentType = mimeMap[ext]
  }

  return new Response(receipt.file_data, {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `inline; filename="${receipt.original_name || receipt.filename}"`,
    },
  })
}

export async function receiptsGetByTransaction(params: Record<string, string>): Promise<Response> {
  const db = await getDB()
  const transactionId = idParam(params)
  if (!(await currentProfileRecord('transactions', transactionId))) {
    return notFound('Transaction')
  }
  const receipts = await db.getAllFromIndex('receipts', 'by_transaction', transactionId)
  const pid = await adapter.getCurrentProfileId()
  return json(receipts.filter((receipt) => receipt.profile_id === pid))
}

export async function receiptsGetFileByName(params: Record<string, string>): Promise<Response> {
  const db = await getDB()
  const filename = params.p1
  const pids = adapter.getCurrentProfileIds()
  const all: any[] = []
  for (const pid of pids) {
    const rows = await db.getAllFromIndex('receipts', 'by_profile', pid)
    all.push(...rows)
  }
  const receipt = all.find((r) => r.filename === filename)
  if (!receipt || !receipt.file_data) return notFound('Receipt file')

  const ext = receipt.original_name?.split('.').pop()?.toLowerCase()
  let contentType = receipt.file_type || 'application/octet-stream'
  if (!receipt.file_type || receipt.file_type === 'application/octet-stream') {
    const mimeMap: Record<string, string> = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      gif: 'image/gif',
      pdf: 'application/pdf',
      webp: 'image/webp',
    }
    if (ext && mimeMap[ext]) contentType = mimeMap[ext]
  }

  return new Response(receipt.file_data, {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `inline; filename="${receipt.original_name || receipt.filename}"`,
    },
  })
}
