export function normalizeCurrencyCode(value: unknown, fallback = 'EUR'): string {
  const code = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (/^[A-Z]{3}$/.test(code)) return code;

  const fallbackCode = fallback.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(fallbackCode) ? fallbackCode : 'EUR';
}
