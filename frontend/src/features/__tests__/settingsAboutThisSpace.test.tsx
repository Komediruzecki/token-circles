/**
 * Settings > General, About this space, against the real local-first router on fake-indexeddb:
 * the production build holds back setup's region and household questions with the benchmarks they
 * choose figures for (core/guidanceGate.ts); every other build asks them. The answers the circles
 * asked for are listed in every build, each changeable, and "Remove answer" clears one so its
 * circle asks again. Round invented values.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { setPage } from '../../core/appStore'
import { __resetDataVersionsForTest } from '../../core/dataVersions'
import { setSettingsTab } from '../../core/settingsStore'
import { getDB } from '../../core/storage/idb'

let host: HTMLDivElement
let dispose: (() => void) | undefined

beforeAll(async () => {
  await Promise.all([import('../Settings'), import('../../core/storage/localApiRouter')])
}, 120_000)

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('finance_storage_mode', 'serverless')
  localStorage.setItem('currentProfileId', '1')
  localStorage.setItem('selectedProfileIds', '[1]')
  localStorage.setItem('localCurrency', 'EUR')
  __resetDataVersionsForTest()
  const db = await getDB()
  for (const store of Array.from(db.objectStoreNames)) await db.clear(store)
  await db.add('profiles', { id: 1, name: 'Household', created_at: '2026-01-01T00:00:00.000Z' })
  await db.put('settings', { key: 'currency', value: 'EUR' })
  Element.prototype.scrollIntoView = () => {}
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  }))
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  host.remove()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

const card = () => host.querySelector('[data-test-id="settings-about-space"]')

async function openGeneral(): Promise<void> {
  // About this space loads while Settings is the page on screen (refetchOnActive).
  setPage('settings')
  setSettingsTab('general')
  const { default: Settings } = await import('../Settings')
  dispose = render(() => <Settings />, host)
  await vi.waitFor(() => {
    expect(host.querySelector('[data-test-id="settings-currency-select"]')).not.toBeNull()
  })
}

/** The answers record as the local-first router keeps it for profile 1. */
async function storedAnswers(): Promise<Record<string, unknown>> {
  const db = await getDB()
  const row = (await db.get('settings', 'guidance:1')) as { value?: unknown } | undefined
  return typeof row?.value === 'string' ? (JSON.parse(row.value) as Record<string, unknown>) : {}
}

async function storeAnswers(answers: Record<string, unknown>): Promise<void> {
  const db = await getDB()
  await db.put('settings', { key: 'guidance:1', value: JSON.stringify(answers) })
}

const answer = (name: string) => host.querySelector(`[data-test-id="settings-answer-${name}"]`)

it("holds back the space questions in the production build, and keeps the circles' answers", async () => {
  vi.stubEnv('MODE', 'production')
  await openGeneral()
  expect(card()).not.toBeNull()
  await vi.waitFor(() => {
    expect(host.querySelector('[data-test-id="settings-circle-answers-empty"]')?.textContent).toBe(
      'Nothing yet. A circle asks when an answer would change one of its checks.'
    )
  })
  expect(host.textContent).toContain('What your circles asked')
  expect(host.textContent).not.toContain('Where do you live?')
  expect(host.querySelector('[data-test-id="settings-space-region"]')).toBeNull()
})

it('lists each answer the circles asked for, with the support by name', async () => {
  vi.stubEnv('MODE', 'production')
  const db = await getDB()
  const income = { profile_id: 1, type: 'income', color: '#3b6fe0' }
  await db.add('categories', { ...income, id: 5, name: 'Family help' })
  await db.add('categories', { ...income, id: 6, name: 'Allowance' })
  await storeAnswers({
    carriesCardBalance: false,
    setsAsideYearly: true,
    supportCategoryIds: [5, 6],
    kindsAsked: true,
    savedElsewhere: { amount: 12000, currency: 'EUR' },
    enoughPerYear: { amount: 48000, currency: 'EUR' },
    freeMoney: { region: 'DE', answer: 'taken' },
    tenure: 'mortgage',
  })
  await openGeneral()
  await vi.waitFor(() => {
    expect(answer('card')).not.toBeNull()
  })
  expect(answer('card')?.textContent).toContain(
    'Do you carry a balance on a credit card or overdraft?'
  )
  const chosen = (name: string) =>
    [...(answer(name)?.querySelectorAll<HTMLInputElement>('input[type="radio"]') ?? [])]
      .filter((radio) => radio.checked)
      .map((radio) => radio.closest('label')?.textContent)
  expect(chosen('card')).toEqual(['No'])
  expect(chosen('yearly-bills')).toEqual(['Yes'])
  expect(host.querySelector('[data-test-id="settings-answer-support-value"]')?.textContent).toBe(
    'Family help and Allowance.'
  )
  expect(answer('essentials')?.textContent).toContain(
    'Each choice is kept with its category on Categories.'
  )
  expect(
    host.querySelector<HTMLInputElement>('[data-test-id="settings-answer-saved-elsewhere-amount"]')
      ?.value
  ).toBe('12000')
  expect(
    host.querySelector<HTMLInputElement>('[data-test-id="settings-answer-enough-amount"]')?.value
  ).toBe('48000')
  // Free money and how the household lives are held back with the benchmarks in production.
  expect(answer('free-money')).toBeNull()
  expect(answer('tenure')).toBeNull()
  expect(host.textContent).not.toContain('How do you live?')
})

it("lists the answers when the categories can't be read, the support as a count", async () => {
  vi.stubEnv('MODE', 'production')
  const db = await getDB()
  // No colour: the categories read fails its check.
  await db.add('categories', { id: 5, profile_id: 1, name: 'Family help', type: 'income' })
  await storeAnswers({ supportCategoryIds: [5, 6], carriesCardBalance: true })
  await openGeneral()
  await vi.waitFor(() => {
    expect(host.querySelector('[data-test-id="settings-answer-support-value"]')?.textContent).toBe(
      '2 income categories.'
    )
  })
  expect(answer('card')).not.toBeNull()
})

it('changes an answer here, and removes one so its circle asks again', async () => {
  vi.stubEnv('MODE', 'production')
  await storeAnswers({ carriesCardBalance: false, setsAsideYearly: true })
  await openGeneral()
  await vi.waitFor(() => {
    expect(answer('card')).not.toBeNull()
  })
  const yes = [...answer('card')!.querySelectorAll('label')].find(
    (label) => label.textContent === 'Yes'
  )!
  yes.querySelector('input')!.click()
  await vi.waitFor(async () => {
    expect((await storedAnswers()).carriesCardBalance).toBe(true)
  })

  host
    .querySelector<HTMLButtonElement>('[data-test-id="settings-answer-yearly-bills-remove"]')!
    .click()
  await vi.waitFor(async () => {
    expect(await storedAnswers()).toEqual({ carriesCardBalance: true })
  })
  await vi.waitFor(() => {
    expect(answer('yearly-bills')).toBeNull()
  })
})

it('asks where you live and who the space covers in every other build', async () => {
  vi.stubEnv('MODE', 'dev')
  await storeAnswers({ freeMoney: { region: 'DE', answer: 'not-sure' } })
  await openGeneral()
  expect(card()).not.toBeNull()
  await vi.waitFor(() => {
    expect(host.querySelector('[data-test-id="settings-space-region"]')).not.toBeNull()
  })
  expect(host.querySelector('[data-test-id="settings-space-household"]')).not.toBeNull()
  // The free-money answer, with its question for the region it was asked for.
  await vi.waitFor(() => {
    expect(answer('free-money')?.textContent).toContain('Entgeltumwandlung')
  })
})

it('lists how the household lives in every other build, to change or remove', async () => {
  vi.stubEnv('MODE', 'dev')
  await storeAnswers({ region: 'UK', tenure: 'rentSocial' })
  await openGeneral()
  await vi.waitFor(() => {
    expect(answer('tenure')).not.toBeNull()
  })
  const chips = () => [...answer('tenure')!.querySelectorAll('label')]
  // The UK's figures tell social renters apart, so its choices do too.
  expect(chips().map((label) => label.textContent)).toEqual([
    'Rent privately',
    'Rent social housing',
    'Own with a mortgage',
    'Own outright',
    'Live with family',
  ])
  expect(chips().find((label) => label.querySelector('input')!.checked)?.textContent).toBe(
    'Rent social housing'
  )
  chips()
    .find((label) => label.textContent === 'Own outright')!
    .querySelector('input')!
    .click()
  await vi.waitFor(async () => {
    expect((await storedAnswers()).tenure).toBe('outright')
  })
  host.querySelector<HTMLButtonElement>('[data-test-id="settings-answer-tenure-remove"]')!.click()
  await vi.waitFor(async () => {
    expect(await storedAnswers()).toEqual({ region: 'UK' })
  })
  await vi.waitFor(() => {
    expect(answer('tenure')).toBeNull()
  })
})
