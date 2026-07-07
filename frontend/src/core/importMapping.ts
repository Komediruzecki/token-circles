/**
 * Shared column-mapping config for the Import page: the target fields, their
 * header-name variants, and the auto-detection that maps a header row onto field
 * indices. Kept in one module so anything that must stay in lock-step with it —
 * e.g. the Bank Imports canonical headers and their contract test — imports the
 * real definitions rather than a drifting hand-copy.
 */

// Column field names for mapping.
export const FIELD_NAMES = [
  { key: 'date', label: 'Date', required: true },
  { key: 'description', label: 'Description', required: true },
  { key: 'amount', label: 'Amount', required: true },
  { key: 'category', label: 'Category', required: false },
  { key: 'currency', label: 'Currency', required: false },
  { key: 'beneficiary', label: 'Beneficiary', required: false },
  { key: 'payor', label: 'Payor', required: false },
  { key: 'means_of_payment', label: 'Means of Payment', required: false },
  { key: 'exchange_rate', label: 'Exchange Rate', required: false },
  { key: 'notes', label: 'Notes', required: false },
  { key: 'type', label: 'Type', required: false },
  { key: 'amount_local', label: 'Amount Local', required: false },
] as const

// Header name variants for auto-detection.
export const HEADER_VARIANTS: Record<string, string[]> = {
  date: ['date', 'datum', 'trans date', 'transaction date'],
  description: ['description', 'desc', 'memo', 'note', 'narration', 'details'],
  amount: ['amount', 'sum', 'total', 'value', 'suma'],
  category: ['category', 'cat', 'kategoria'],
  currency: ['currency', 'waluta', 'curr'],
  beneficiary: ['beneficiary', 'beneficjent', 'recipient', 'payee'],
  payor: ['payor', 'payer', 'płatnik', 'from'],
  means_of_payment: ['payment', 'method', 'means', 'payment method'],
  exchange_rate: ['rate', 'exchange rate', 'kurs'],
  notes: ['notes', 'note', 'remark', 'comments'],
  type: ['type', 'typ', 'tx type', 'transaction type'],
  amount_local: [
    'amount local',
    'local amount',
    'amount pln',
    'amount in local currency',
    'local currency',
    'local curr',
    'amount (local)',
    'local value',
    'domestic amount',
  ],
} as const

/**
 * Map each field to the first header whose (lowercased) text contains one of the
 * field's variants. Returns { fieldKey → column index } for the fields that matched.
 */
export function autoDetectMapping(headers: string[]): Record<string, number> {
  const mapping: Record<string, number> = {}
  const lowerHeaders = headers.map((h) => h.toLowerCase())
  FIELD_NAMES.forEach((field) => {
    const variants = HEADER_VARIANTS[field.key]
    const idx = lowerHeaders.findIndex((h) => variants.some((v) => h.includes(v.toLowerCase())))
    if (idx !== -1) mapping[field.key] = idx
  })
  return mapping
}
