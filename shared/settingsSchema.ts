/**
 * The settings `PUT /api/settings` stores, as the Worker and the local-first router accept them.
 *
 * The route is a key/value store, and it stored any key with any value: the Worker as text
 * (`String(v)`, so an object became "[object Object]"), local-first as it came. That let a write
 * reach past the routes that own a key and check it. `retirement_settings` is the retirement plan,
 * which `PUT /api/retirement/settings` checks against the plan rules (shared/retirementPlanSchema.ts);
 * through here any value at all was stored as a plan. The two runtimes also checked different
 * things in different words: the Worker refused a lowercase currency code that local-first
 * accepted, and local-first answered a currency code that is not one with 409, as if it were the
 * lock on the base currency (docs/plans/2026-10-07-form-errors.md, slice 4b).
 *
 * The rules, the same in both runtimes:
 *
 * - The body is an object of setting names and values.
 * - A key another route owns is refused, in words that name that route: the retirement plan
 *   (`retirement_settings`, and local-first's `retirement_settings:<profile id>`), the email
 *   settings (`email_*`, `PUT /api/notifications/settings`), and what the app keeps for itself
 *   (`__backup_v3_extensions__`, `__cache__*`).
 * - The base currency, and the older `local_currency` and `primary_currency`, are three-letter
 *   currency codes, stored in capitals.
 * - `locale` is a language tag, `theme` light or dark, `language` one the app has, and
 *   `onboarding` completed or skipped.
 * - Every other value is text, a number, or true or false.
 *
 * Unknown keys are kept: the app has written several over the years, and an older client still
 * sends its own.
 */
import type { Checked, FieldErrors } from './refusal';

/** The words for each refusal. A form shows them under the field; a summary joins them. */
export const SETTINGS_MESSAGES = {
  settings: 'Send the settings as names and values, like {"currency": "EUR"}.',
  currency: 'Use a three-letter currency code, like EUR.',
  locale: 'Use a language tag, like en-US.',
  theme: 'Choose light or dark.',
  language: 'Choose en, de, fr or es.',
  onboarding: 'Use completed or skipped.',
  value: 'Send this setting as text, a number, or true or false.',
  retirementPlan: 'Save a retirement plan through PUT /api/retirement/settings, which checks it.',
  emailSettings: 'Save email settings through PUT /api/notifications/settings.',
  appOwned: 'The app keeps this setting itself. Leave it out.',
  mode: "Choose 'serverless' (this browser) or 'self-hosted' (the cloud).",
} as const;

/**
 * The refusal of a new base currency once the profile has accounts or transactions. Their amounts
 * are kept in the base currency, and changing it would relabel them without converting them.
 */
export function baseCurrencyLocked(configured: string): FieldErrors {
  return {
    currency: `The base currency stays ${configured} once you have accounts or transactions.`,
  };
}

/** The words for a key another route owns, or null when this route stores it. */
export function ownedSettingMessage(key: string): string | null {
  if (key === 'retirement_settings' || key.startsWith('retirement_settings:')) {
    return SETTINGS_MESSAGES.retirementPlan;
  }
  if (key.startsWith('email_')) return SETTINGS_MESSAGES.emailSettings;
  if (key === '__backup_v3_extensions__' || key.startsWith('__cache__')) {
    return SETTINGS_MESSAGES.appOwned;
  }
  return null;
}

const CURRENCY_KEYS = new Set(['currency', 'local_currency', 'primary_currency']);
const LOCALE_TAG = /^[a-z]{2,3}(?:-[A-Z]{2,3}(?:-[A-Z0-9]+)*)?$/i;
const THEMES: readonly string[] = ['light', 'dark'];
const LANGUAGES: readonly string[] = ['en', 'de', 'fr', 'es'];
const ONBOARDING: readonly string[] = ['completed', 'skipped'];

/** A currency code as stored: three letters in capitals, or null when it is not one. */
export function readCurrencyCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

function isOneOf(raw: unknown, allowed: readonly string[]): raw is string {
  return typeof raw === 'string' && allowed.includes(raw);
}

/** A value `PUT /api/settings` stores. */
export type SettingValue = string | number | boolean;

/** One setting, or why not. */
function readSetting(key: string, raw: unknown): { value: SettingValue } | { error: string } {
  const owned = ownedSettingMessage(key);
  if (owned) return { error: owned };
  if (CURRENCY_KEYS.has(key)) {
    const code = readCurrencyCode(raw);
    return code ? { value: code } : { error: SETTINGS_MESSAGES.currency };
  }
  if (key === 'locale') {
    return typeof raw === 'string' && LOCALE_TAG.test(raw)
      ? { value: raw }
      : { error: SETTINGS_MESSAGES.locale };
  }
  if (key === 'theme')
    return isOneOf(raw, THEMES) ? { value: raw } : { error: SETTINGS_MESSAGES.theme };
  if (key === 'language') {
    return isOneOf(raw, LANGUAGES) ? { value: raw } : { error: SETTINGS_MESSAGES.language };
  }
  if (key === 'onboarding') {
    return isOneOf(raw, ONBOARDING) ? { value: raw } : { error: SETTINGS_MESSAGES.onboarding };
  }
  if (typeof raw === 'string' || typeof raw === 'boolean') return { value: raw };
  if (typeof raw === 'number' && Number.isFinite(raw)) return { value: raw };
  return { error: SETTINGS_MESSAGES.value };
}

/** The settings of one `PUT /api/settings`, ready to store, or a message for each one refused. */
export function checkSettingsUpdate(body: unknown): Checked<Record<string, SettingValue>> {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, fields: { settings: SETTINGS_MESSAGES.settings } };
  }
  const value: Record<string, SettingValue> = {};
  const fields: FieldErrors = {};
  for (const [key, raw] of Object.entries(body as Record<string, unknown>)) {
    const read = readSetting(key, raw);
    if ('error' in read) fields[key] = read.error;
    else value[key] = read.value;
  }
  return Object.keys(fields).length > 0 ? { ok: false, fields } : { ok: true, value };
}

/** Where a person's data lives: this browser (local-first), or the cloud (the Worker). */
export const STORAGE_MODES = ['serverless', 'self-hosted'] as const;
export type StorageModeName = (typeof STORAGE_MODES)[number];

/**
 * The body of `POST /api/storage-mode`: the mode Settings is about to switch to. Neither runtime
 * switches anything when it is sent (the mode lives in the browser, and Settings sets it there
 * itself), so each acknowledges a mode there is such a thing as and refuses any other.
 */
export function checkStorageMode(body: unknown): Checked<{ mode: StorageModeName }> {
  const raw =
    body !== null && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>).mode
      : undefined;
  return isOneOf(raw, STORAGE_MODES)
    ? { ok: true, value: { mode: raw as StorageModeName } }
    : { ok: false, fields: { mode: SETTINGS_MESSAGES.mode } };
}
