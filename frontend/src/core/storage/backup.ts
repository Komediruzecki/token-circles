import type { ExportData, ExportReceiptFile } from '../../types/storage'

export const BACKUP_VERSION = '3.0.0'
export const BACKUP_EXTENSION_SETTINGS_KEY = '__backup_v3_extensions__'

export interface BackupExtensions {
  budgetsZeroBased: Record<string, unknown>[]
  retirementGoals: Record<string, unknown>[]
  emergencyFundConfig: Record<string, unknown>[]
  customReports: Record<string, unknown>[]
  settingsRows: Record<string, unknown>[]
}

export function receiptBytesFrom(value: unknown): Uint8Array | null {
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  }
  // IndexedDB structured clones can come from a different JS realm in tests and
  // embedded browsers, so `instanceof ArrayBuffer` is not sufficient.
  if (Object.prototype.toString.call(value) === '[object ArrayBuffer]') {
    return new Uint8Array(value as ArrayBuffer)
  }
  return null
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

export function decodeBase64(value: string): ArrayBuffer {
  let binary: string
  try {
    binary = atob(value)
  } catch {
    throw new Error('Backup contains invalid receipt file data')
  }
  const bytes = new Uint8Array(binary.length)
  for (let offset = 0; offset < binary.length; offset++) {
    bytes[offset] = binary.charCodeAt(offset)
  }
  return bytes.buffer
}

export function exportReceiptFiles(receipts: Record<string, unknown>[]): {
  metadata: Record<string, unknown>[]
  files: ExportReceiptFile[]
} {
  const metadata: Record<string, unknown>[] = []
  const files: ExportReceiptFile[] = []
  for (const receipt of receipts) {
    const id = Number(receipt.id)
    if (!Number.isSafeInteger(id) || id <= 0)
      throw new Error('Receipt backup contains an invalid id')
    const bytes = receiptBytesFrom(receipt.file_data)
    if (!bytes) {
      const label =
        typeof receipt.original_name === 'string'
          ? receipt.original_name
          : typeof receipt.filename === 'string'
            ? receipt.filename
            : id.toString()
      throw new Error(`Receipt "${label}" has no file bytes; full backup aborted`)
    }
    const row = { ...receipt }
    delete row.file_data
    metadata.push(row)
    files.push({
      receipt_id: id,
      content_type:
        typeof receipt.file_type === 'string' ? receipt.file_type : 'application/octet-stream',
      data_base64: encodeBase64(bytes),
    })
  }
  return { metadata, files }
}

export function readBackupExtensions(value: unknown): BackupExtensions {
  const source = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const list = (key: keyof BackupExtensions): Record<string, unknown>[] =>
    Array.isArray(source[key]) ? (source[key] as Record<string, unknown>[]) : []
  return {
    budgetsZeroBased: list('budgetsZeroBased'),
    retirementGoals: list('retirementGoals'),
    emergencyFundConfig: list('emergencyFundConfig'),
    customReports: list('customReports'),
    settingsRows: list('settingsRows'),
  }
}

export function backupExtensionsFrom(data: ExportData): BackupExtensions {
  return {
    budgetsZeroBased: data.budgetsZeroBased ?? [],
    retirementGoals: data.retirementGoals ?? [],
    emergencyFundConfig: data.emergencyFundConfig ?? [],
    customReports: data.customReports ?? [],
    settingsRows: data.settingsRows ?? [],
  }
}

const REQUIRED_ARRAYS = [
  'profiles',
  'categories',
  'transactions',
  'accounts',
  'budgets',
  'goals',
  'loans',
] as const

const OPTIONAL_ARRAYS = [
  'retirementGoals',
  'portfolioHoldings',
  'bills',
  'recurring',
  'tags',
  'housings',
  'categoryMappings',
  'receipts',
  'receiptFiles',
  'balanceHistoryRows',
  'importLogs',
  'budgetsZeroBased',
  'emergencyFundConfig',
  'loanRatePeriods',
  'loanPrepayments',
  'transactionTags',
  'customReports',
  'settingsRows',
] as const

const PROFILE_SCOPED_ARRAYS = [
  'categories',
  'transactions',
  'accounts',
  'budgets',
  'goals',
  'loans',
  'retirementGoals',
  'portfolioHoldings',
  'bills',
  'recurring',
  'tags',
  'housings',
  'categoryMappings',
  'receipts',
  'importLogs',
  'budgetsZeroBased',
  'emergencyFundConfig',
  'settingsRows',
] as const

function objectRow(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Backup ${context} must be an object`)
  }
  return value as Record<string, unknown>
}

function positiveId(value: unknown, context: string): number {
  const id = Number(value)
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error(`Backup ${context} must be a positive integer`)
  }
  return id
}

/**
 * Reject malformed local restores before opening the destructive IndexedDB
 * transaction. In particular, never "repair" an unknown profile reference by
 * silently assigning the row to a different profile.
 */
export function validateBackupForLocalRestore(value: unknown): asserts value is ExportData {
  const data = objectRow(value, 'payload')
  for (const key of REQUIRED_ARRAYS) {
    if (!Array.isArray(data[key])) throw new Error(`Backup ${key} must be an array`)
  }
  for (const key of OPTIONAL_ARRAYS) {
    if (data[key] !== undefined && !Array.isArray(data[key])) {
      throw new Error(`Backup ${key} must be an array`)
    }
  }
  if (!data.settings || typeof data.settings !== 'object' || Array.isArray(data.settings)) {
    throw new Error('Backup settings must be an object')
  }

  const profiles = data.profiles as unknown[]
  if (profiles.length === 0) throw new Error('Backup must contain at least one profile')
  const profileIds = new Set<number>()
  const profileNames = new Set<string>()
  profiles.forEach((value, index) => {
    const row = objectRow(value, `profiles[${index}]`)
    const id = positiveId(row.id, `profiles[${index}].id`)
    if (profileIds.has(id)) throw new Error(`Backup contains duplicate profile id ${id}`)
    profileIds.add(id)
    const name = typeof row.name === 'string' ? row.name.trim() : ''
    if (!name) throw new Error(`Backup profiles[${index}].name is required`)
    const normalizedName = name.toLocaleLowerCase()
    if (profileNames.has(normalizedName)) {
      throw new Error(`Backup contains duplicate profile name "${name}"`)
    }
    profileNames.add(normalizedName)
  })

  for (const key of PROFILE_SCOPED_ARRAYS) {
    const rows = (data[key] ?? []) as unknown[]
    rows.forEach((value, index) => {
      const row = objectRow(value, `${key}[${index}]`)
      const profileId = positiveId(row.profile_id, `${key}[${index}].profile_id`)
      if (!profileIds.has(profileId)) {
        throw new Error(`${key}[${index}].profile_id references missing profile ${profileId}`)
      }
    })
  }

  const receipts = (data.receipts ?? []) as unknown[]
  const receiptIds = new Set<number>()
  const receiptsWithInlineBytes = new Set<number>()
  receipts.forEach((value, index) => {
    const row = objectRow(value, `receipts[${index}]`)
    const id = positiveId(row.id, `receipts[${index}].id`)
    if (receiptIds.has(id)) throw new Error(`Backup contains duplicate receipt id ${id}`)
    receiptIds.add(id)
    if (receiptBytesFrom(row.file_data)) receiptsWithInlineBytes.add(id)
  })

  const receiptFileIds = new Set<number>()
  const files = (data.receiptFiles ?? []) as unknown[]
  files.forEach((value, index) => {
    const row = objectRow(value, `receiptFiles[${index}]`)
    const receiptId = positiveId(row.receipt_id, `receiptFiles[${index}].receipt_id`)
    if (!receiptIds.has(receiptId)) {
      throw new Error(`receiptFiles[${index}] references missing receipt ${receiptId}`)
    }
    if (receiptFileIds.has(receiptId)) {
      throw new Error(`Backup contains duplicate file data for receipt ${receiptId}`)
    }
    if (typeof row.data_base64 !== 'string') {
      throw new Error(`Backup receiptFiles[${index}].data_base64 must be a string`)
    }
    decodeBase64(row.data_base64)
    receiptFileIds.add(receiptId)
  })

  for (const receiptId of receiptIds) {
    if (!receiptFileIds.has(receiptId) && !receiptsWithInlineBytes.has(receiptId)) {
      throw new Error(`Backup receipt ${receiptId} has no file bytes`)
    }
  }
}
