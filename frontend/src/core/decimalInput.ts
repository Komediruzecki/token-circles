/**
 * Parse a user-entered decimal without changing the text while they type.
 *
 * Both comma and dot are accepted as the decimal separator. Thousands separators
 * are intentionally rejected because values such as "1,234" are ambiguous in an
 * account balance field.
 */
export function parseDecimalInput(value: string): number | null {
  const text = value.trim()
  const unsigned = text.startsWith('-') ? text.slice(1) : text
  if (!unsigned) return null

  const separatorCount = unsigned.match(/[.,]/g)?.length ?? 0
  if (separatorCount > 1) return null

  const separatorIndex = unsigned.search(/[.,]/)
  const whole = separatorIndex === -1 ? unsigned : unsigned.slice(0, separatorIndex)
  const fraction = separatorIndex === -1 ? '' : unsigned.slice(separatorIndex + 1)
  if (!whole && !fraction) return null
  if ((whole && !/^\d+$/.test(whole)) || (fraction && !/^\d+$/.test(fraction))) return null

  const parsed = Number(text.replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : null
}
