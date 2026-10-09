/**
 * shared/settingsSchema.ts: what `PUT /api/settings` and `POST /api/storage-mode` accept, in both
 * runtimes. Every rule and every message.
 */
import { describe, expect, it } from 'vitest'
import {
  baseCurrencyLocked,
  checkSettingsUpdate,
  checkStorageMode,
  ownedSettingMessage,
  readCurrencyCode,
  SETTINGS_MESSAGES as M,
} from '../../../../shared/settingsSchema'

const refused = (body: unknown) => {
  const checked = checkSettingsUpdate(body)
  return checked.ok ? null : checked.fields
}

describe('the settings a write stores', () => {
  it('keeps what the app sends: the base currency, the onboarding state, the badges', () => {
    const badges = JSON.stringify({ v: 1, unlocks: [], dismissedAdvice: [] })
    expect(
      checkSettingsUpdate({
        currency: 'USD',
        onboarding: 'completed',
        achievements: badges,
        'achievements:3': '',
      })
    ).toEqual({
      ok: true,
      value: {
        currency: 'USD',
        onboarding: 'completed',
        achievements: badges,
        'achievements:3': '',
      },
    })
    expect(checkSettingsUpdate({})).toEqual({ ok: true, value: {} })
  })

  it('keeps a key it does not know, as text, a number, or true or false', () => {
    expect(checkSettingsUpdate({ sidebar: 'wide', columns: 3, compact: false })).toEqual({
      ok: true,
      value: { sidebar: 'wide', columns: 3, compact: false },
    })
  })

  it('refuses a value that is not text, a number, or true or false', () => {
    expect(
      refused({ preferences: { theme: 'dark' }, list: [1], nothing: null, endless: Infinity })
    ).toEqual({ preferences: M.value, list: M.value, nothing: M.value, endless: M.value })
  })

  it('refuses a body that is not names and values', () => {
    for (const body of [null, 'currency=EUR', ['EUR'], 7]) {
      expect(refused(body)).toEqual({ settings: M.settings })
    }
  })
})

describe('a key another route owns', () => {
  it("refuses the retirement plan, in both runtimes' keys, naming its route", () => {
    expect(refused({ retirement_settings: '{"retirementAge":30}' })).toEqual({
      retirement_settings: M.retirementPlan,
    })
    expect(refused({ 'retirement_settings:2': '{}' })).toEqual({
      'retirement_settings:2': M.retirementPlan,
    })
    expect(M.retirementPlan).toContain('PUT /api/retirement/settings')
  })

  it('refuses the email settings, naming their route', () => {
    expect(refused({ email_notifications: 'false', email_budget_alerts: 'true' })).toEqual({
      email_notifications: M.emailSettings,
      email_budget_alerts: M.emailSettings,
    })
    expect(M.emailSettings).toContain('PUT /api/notifications/settings')
  })

  it('refuses what the app keeps for itself', () => {
    expect(refused({ __backup_v3_extensions__: '{}', __cache__exchange_rates: '{}' })).toEqual({
      __backup_v3_extensions__: M.appOwned,
      __cache__exchange_rates: M.appOwned,
    })
  })

  it('stores the rest, and refuses an owned key beside them all the same', () => {
    expect(ownedSettingMessage('currency')).toBeNull()
    expect(ownedSettingMessage('achievements:2')).toBeNull()
    expect(ownedSettingMessage('retirement')).toBeNull()
    expect(refused({ currency: 'EUR', retirement_settings: '{}' })).toEqual({
      retirement_settings: M.retirementPlan,
    })
  })
})

describe('the base currency', () => {
  it('takes a three-letter code in any case, and stores it in capitals', () => {
    expect(checkSettingsUpdate({ currency: ' usd ' })).toEqual({
      ok: true,
      value: { currency: 'USD' },
    })
    expect(readCurrencyCode('gbp')).toBe('GBP')
  })

  it('refuses anything else, the older currency keys too', () => {
    for (const currency of ['', 'EURO', 'E1R', 42, null]) {
      expect(refused({ currency })).toEqual({ currency: M.currency })
    }
    expect(refused({ local_currency: 'dollars', primary_currency: '' })).toEqual({
      local_currency: M.currency,
      primary_currency: M.currency,
    })
  })

  it('says why a locked base currency stays, naming it', () => {
    expect(baseCurrencyLocked('EUR')).toEqual({
      currency: 'The base currency stays EUR once you have accounts or transactions.',
    })
  })
})

describe('the other named settings', () => {
  it('takes a language tag for the locale', () => {
    expect(checkSettingsUpdate({ locale: 'en-US' })).toEqual({
      ok: true,
      value: { locale: 'en-US' },
    })
    expect(checkSettingsUpdate({ locale: 'de' }).ok).toBe(true)
    expect(refused({ locale: 'english please' })).toEqual({ locale: M.locale })
  })

  it('takes light or dark for the theme', () => {
    expect(checkSettingsUpdate({ theme: 'dark' }).ok).toBe(true)
    expect(refused({ theme: 'blue' })).toEqual({ theme: M.theme })
  })

  it('takes a language the app has', () => {
    expect(checkSettingsUpdate({ language: 'fr' }).ok).toBe(true)
    expect(refused({ language: 'xx' })).toEqual({ language: M.language })
  })

  it('takes completed or skipped for the onboarding state', () => {
    expect(checkSettingsUpdate({ onboarding: 'skipped' }).ok).toBe(true)
    expect(refused({ onboarding: 'maybe later' })).toEqual({ onboarding: M.onboarding })
  })
})

describe('the storage mode', () => {
  it('takes either mode there is', () => {
    expect(checkStorageMode({ mode: 'serverless' })).toEqual({
      ok: true,
      value: { mode: 'serverless' },
    })
    expect(checkStorageMode({ mode: 'self-hosted' })).toEqual({
      ok: true,
      value: { mode: 'self-hosted' },
    })
  })

  it('refuses any other, or none, at the mode', () => {
    for (const body of [{ mode: 'cloud' }, { mode: 'SERVERLESS' }, {}, null, 'serverless']) {
      expect(checkStorageMode(body)).toEqual({ ok: false, fields: { mode: M.mode } })
    }
  })
})
