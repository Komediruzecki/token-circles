/**
 * Shared column-mapping config for imports — the target fields, their header-name variants, the
 * auto-detection that maps a header row onto field indices, and the by-header persistence helpers.
 *
 * Lives in shared/ so BOTH runtimes use the same definitions instead of drifting hand-copies:
 * the frontend (Import page, Connected Sources) and the Cloudflare Worker (daily cron sheet sync,
 * email-in). Pure JS — no frontend or Worker APIs — so it imports cleanly on either side.
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
] as const;

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
} as const;

/**
 * Map each field to the first header whose (lowercased) text contains one of the field's
 * variants. Returns { fieldKey → column index } for the fields that matched.
 */
export function autoDetectMapping(headers: string[]): Record<string, number> {
  const mapping: Record<string, number> = {};
  const lowerHeaders = headers.map((h) => h.toLowerCase());
  FIELD_NAMES.forEach((field) => {
    const variants = HEADER_VARIANTS[field.key];
    const idx = lowerHeaders.findIndex((h) => variants.some((v) => h.includes(v.toLowerCase())));
    if (idx !== -1) mapping[field.key] = idx;
  });
  return mapping;
}

/**
 * Persist a live column mapping (`{ field → column index }`) as `{ field → header name }`, so a
 * saved import source survives the sheet owner reordering columns — indices are re-resolved at
 * fetch time via {@link resolveHeaderMapping}. Out-of-range indices are dropped.
 */
export function mappingToHeaderNames(
  mapping: Record<string, number>,
  headers: string[]
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [field, idx] of Object.entries(mapping)) {
    if (typeof idx === 'number' && idx >= 0 && idx < headers.length) out[field] = headers[idx];
  }
  return out;
}

/**
 * Resolve a saved `{ field → header name }` mapping back to `{ field → column index }` against a
 * freshly fetched header row. Exact match first, then a case-insensitive fallback; a header that
 * is no longer present is dropped (that field falls back to auto-detect / stays unmapped).
 */
export function resolveHeaderMapping(
  headerMapping: Record<string, string>,
  headers: string[]
): Record<string, number> {
  const out: Record<string, number> = {};
  const lower = headers.map((h) => String(h).toLowerCase());
  for (const [field, name] of Object.entries(headerMapping || {})) {
    if (typeof name !== 'string') continue;
    let idx = headers.indexOf(name);
    if (idx === -1) idx = lower.indexOf(name.toLowerCase());
    if (idx !== -1) out[field] = idx;
  }
  return out;
}
