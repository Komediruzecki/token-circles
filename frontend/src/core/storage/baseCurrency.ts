import { getLocalCurrency } from '../api'
import { normalizeCurrencyCode } from '../currencies'
import { getDB } from './idb'

export class BaseCurrencyConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BaseCurrencyConflictError'
  }
}

async function configuredBaseCurrency(): Promise<string | null> {
  const db = await getDB()
  const row = await db.get('settings', 'currency')
  if (!row?.value) return null
  return normalizeCurrencyCode(row.value, getLocalCurrency())
}

async function persistBaseCurrency(currency: string, relabelAccounts: boolean): Promise<void> {
  const db = await getDB()
  await db.put('settings', { key: 'currency', value: currency })
  await db.put('settings', { key: 'primary_currency', value: currency })
  if (!relabelAccounts) return
  const accounts = await db.getAll('accounts')
  for (const account of accounts) {
    account.currency = currency
    await db.put('accounts', account)
  }
}

/**
 * Resolve the single unit used by account balances. The browser's historical
 * localCurrency setting is authoritative while the persisted setting is first
 * established.
 */
export async function ensureBaseCurrency(requested?: unknown, persist = true): Promise<string> {
  const normalized = normalizeCurrencyCode(requested, getLocalCurrency())
  const configured = await configuredBaseCurrency()
  if (configured) {
    if (requested && normalized !== configured) {
      throw new BaseCurrencyConflictError(
        `Account balances use ${configured}. Change the base currency in Settings before adding financial data.`
      )
    }
    return configured
  }

  if (persist) await persistBaseCurrency(normalized, true)
  return normalized
}

/**
 * Explicit Settings change. The first persisted choice adopts legacy balances as-is;
 * later changes are blocked once any financial rows exist because historical
 * amount_local values cannot be safely re-denominated without an FX migration.
 */
export async function setBaseCurrency(requested: unknown): Promise<string> {
  const raw = typeof requested === 'string' ? requested.trim().toUpperCase() : ''
  if (!/^[A-Z]{3}$/.test(raw)) {
    throw new BaseCurrencyConflictError('Enter a valid three-letter currency code.')
  }
  const currency = raw

  const configured = await configuredBaseCurrency()
  if (configured === currency) return currency

  const db = await getDB()
  if (configured) {
    const [accounts, transactions] = await Promise.all([
      db.count('accounts'),
      db.count('transactions'),
    ])
    if (accounts > 0 || transactions > 0) {
      throw new BaseCurrencyConflictError(
        `Base currency is locked to ${configured} after financial data is added.`
      )
    }
  }

  await persistBaseCurrency(currency, true)
  return currency
}
