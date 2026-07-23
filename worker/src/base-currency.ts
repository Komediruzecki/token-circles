import { normalizeCurrencyCode } from './currency';
import * as db from './db';
import { HttpError } from './http';

async function configuredBaseCurrency(DB: D1Database, profileId: number): Promise<string | null> {
  const row = await db.first<{ value: string }>(
    DB,
    "SELECT value FROM settings WHERE profile_id = ? AND key = 'currency'",
    profileId
  );
  return row?.value ? normalizeCurrencyCode(row.value, 'EUR') : null;
}

async function persistBaseCurrency(
  DB: D1Database,
  profileId: number,
  currency: string,
  relabelAccounts: boolean
): Promise<void> {
  await db.run(
    DB,
    'INSERT OR REPLACE INTO settings (key, value, profile_id) VALUES (?, ?, ?)',
    'currency',
    currency,
    profileId
  );
  if (relabelAccounts) {
    await db.run(DB, 'UPDATE accounts SET currency = ? WHERE profile_id = ?', currency, profileId);
  }
}

/**
 * Resolve the persisted profile-wide unit for account balances. This can run in
 * read-only preview paths; pass persist=true only when the operation will commit.
 */
export async function resolveProfileBaseCurrency(
  DB: D1Database,
  profileId: number,
  requested: unknown,
  persist = false
): Promise<string> {
  const normalized = normalizeCurrencyCode(requested, 'EUR');
  const configured = await configuredBaseCurrency(DB, profileId);
  if (configured) {
    if (requested && normalized !== configured) {
      throw new HttpError(
        409,
        `Account balances use ${configured}. Change the base currency in Settings before adding financial data.`
      );
    }
    return configured;
  }

  if (persist) await persistBaseCurrency(DB, profileId, normalized, true);
  return normalized;
}

/**
 * Persist an explicit Settings choice. Once financial data exists, changing the
 * unit is rejected because historical amount_local values cannot be re-denominated
 * without a dedicated FX migration.
 */
export async function setProfileBaseCurrency(
  DB: D1Database,
  profileId: number,
  requested: unknown
): Promise<string> {
  const raw = typeof requested === 'string' ? requested.trim().toUpperCase() : '';
  if (!/^[A-Z]{3}$/.test(raw)) {
    throw new HttpError(422, 'Invalid currency code. Must be a three-letter ISO code.');
  }

  const configured = await configuredBaseCurrency(DB, profileId);
  if (configured === raw) return raw;
  if (configured) {
    const counts = await db.first<{ account_count: number; transaction_count: number }>(
      DB,
      `SELECT
         (SELECT COUNT(*) FROM accounts WHERE profile_id = ?) AS account_count,
         (SELECT COUNT(*) FROM transactions WHERE profile_id = ?) AS transaction_count`,
      profileId,
      profileId
    );
    if ((counts?.account_count || 0) > 0 || (counts?.transaction_count || 0) > 0) {
      throw new HttpError(
        409,
        `Base currency is locked to ${configured} after financial data is added.`
      );
    }
  }

  await persistBaseCurrency(DB, profileId, raw, true);
  return raw;
}
