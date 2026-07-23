export const CURRENCY_OPTIONS = [
  { code: 'USD', name: 'USD - US Dollar' },
  { code: 'EUR', name: 'EUR - Euro' },
  { code: 'GBP', name: 'GBP - British Pound' },
  { code: 'JPY', name: 'JPY - Japanese Yen' },
  { code: 'CAD', name: 'CAD - Canadian Dollar' },
  { code: 'AUD', name: 'AUD - Australian Dollar' },
  { code: 'CHF', name: 'CHF - Swiss Franc' },
  { code: 'CNY', name: 'CNY - Chinese Yuan' },
  { code: 'INR', name: 'INR - Indian Rupee' },
  { code: 'BRL', name: 'BRL - Brazilian Real' },
  { code: 'MXN', name: 'MXN - Mexican Peso' },
  { code: 'SGD', name: 'SGD - Singapore Dollar' },
  { code: 'HKD', name: 'HKD - Hong Kong Dollar' },
  { code: 'KRW', name: 'KRW - South Korean Won' },
  { code: 'SEK', name: 'SEK - Swedish Krona' },
  { code: 'NOK', name: 'NOK - Norwegian Krone' },
  { code: 'DKK', name: 'DKK - Danish Krone' },
  { code: 'NZD', name: 'NZD - New Zealand Dollar' },
  { code: 'ZAR', name: 'ZAR - South African Rand' },
  { code: 'PLN', name: 'PLN - Polish Zloty' },
  { code: 'CZK', name: 'CZK - Czech Koruna' },
] as const

export function normalizeCurrencyCode(value: unknown, fallback = 'EUR'): string {
  const code = typeof value === 'string' ? value.trim().toUpperCase() : ''
  if (/^[A-Z]{3}$/.test(code)) return code

  const fallbackCode = fallback.trim().toUpperCase()
  return /^[A-Z]{3}$/.test(fallbackCode) ? fallbackCode : 'EUR'
}
