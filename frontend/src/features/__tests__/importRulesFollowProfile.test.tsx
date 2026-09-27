/**
 * The bank-import rules editor shows the active profile's rules, and Save writes them there.
 *
 * The rules are stored per profile (core/bankImport/rulesStore.ts), and the import flow copies
 * them into editable drafts once — in the Import page's onMount, or when the onboarding wizard
 * first reaches its import step. Both outlive a profile switch: the page stays mounted (#317), and
 * the wizard is mounted for the whole session and can be relaunched from Settings. So the editor
 * kept showing the previous profile's rules, and Save wrote them under the new profile's key.
 *
 * A quick-add bumps profileVersion as well (App.tsx, audit F-05), so reloading the drafts on every
 * bump would throw away unsaved rule edits each time a transaction is added. The drafts reload
 * only when the profile they were loaded for is no longer the active one.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { bumpProfileVersion, setCurrentProfile, setPage } from '../../core/appStore'
import { skipOnboarding, startOnboarding } from '../../core/onboardingStore'
import type { Profile } from '../../types/models'

/** No server data is needed: the rules live in localStorage. Lists come back empty. */
function serve(init?: RequestInit): Response {
  const body = (init?.method ?? 'GET').toUpperCase() === 'GET' ? [] : { ok: true }
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

vi.mock('../../core/apiFetch', () => ({
  apiFetch: async (_url: string, init?: RequestInit) => serve(init),
}))

/** What each profile has saved: different on every field the editor shows. */
const STORED = {
  '1': {
    categoryRules: [{ category: 'Groceries', keywords: ['market', 'bakery'] }],
    transferRules: { ownAccounts: [], keywords: ['top-up'], counterparts: { '1111': 'Savings' } },
  },
  '2': {
    categoryRules: [{ category: 'Fuel', keywords: ['petrol'] }],
    transferRules: { ownAccounts: [], keywords: ['broker'], counterparts: { '2222': 'Brokerage' } },
  },
}

/** The same rules as the editor shows them. */
const DRAFTS = {
  '1': {
    categories: ['Groceries'],
    keywords: ['market, bakery'],
    transferKeywords: 'top-up',
    counterparts: ['1111'],
  },
  '2': {
    categories: ['Fuel'],
    keywords: ['petrol'],
    transferKeywords: 'broker',
    counterparts: ['2222'],
  },
}

const stored = (key: string): unknown => JSON.parse(localStorage.getItem(key) ?? 'null')

const profile = (id: number): Profile => ({ id, name: `Profile ${id}` }) as Profile

/**
 * A profile switch as the rules see it: the id the rules store keys on, then the app-wide notice.
 * The sidebar also sets currentProfile; the notice alone has to be enough.
 */
function switchProfile(id: '1' | '2') {
  localStorage.setItem('currentProfileId', id)
  bumpProfileVersion()
}

const values = (placeholder: string) =>
  [...document.querySelectorAll<HTMLInputElement>(`input[placeholder="${placeholder}"]`)].map(
    (i) => i.value
  )
const transferKeywordsInput = () =>
  document.querySelector<HTMLInputElement>('input[placeholder^="Transfer keywords"]')
const drafts = () => ({
  categories: values('Category (pick or type)'),
  keywords: values('keyword1, keyword2, ...'),
  transferKeywords: transferKeywordsInput()?.value,
  counterparts: values('Signature (e.g. 1111)'),
})
/** The Mapping select: the one whose options are the rule groups. */
const ruleGroupSelect = () =>
  document.querySelector<HTMLOptionElement>('option[value="worldwide"]')
    ?.parentElement as HTMLSelectElement | null

function type(input: HTMLInputElement, value: string) {
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

const byTestId = (id: string) => document.querySelector<HTMLElement>(`[data-test-id="${id}"]`)

let host: HTMLDivElement
let dispose: (() => void) | undefined

const flush = () => new Promise((r) => setTimeout(r, 0))
const settle = async () => {
  for (let i = 0; i < 4; i++) await flush()
}

// Loading the page and the wizard (the import flow, the bank adapters) is the slow part of a
// mount. Done once up front, so a loaded machine cannot push the first test past its timeout.
beforeAll(async () => {
  await import('../Import')
  await import('../../components/onboarding/OnboardingWizard')
}, 120_000)

beforeEach(() => {
  localStorage.clear()
  for (const id of ['1', '2'] as const) {
    localStorage.setItem(`bankImportCategoryRules:${id}`, JSON.stringify(STORED[id].categoryRules))
    localStorage.setItem(`bankImportTransferRules:${id}`, JSON.stringify(STORED[id].transferRules))
  }
  localStorage.setItem('bankImportRuleGroup:2', 'worldwide')
  localStorage.setItem('currentProfileId', '1')
  setCurrentProfile(profile(1))
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  host?.remove()
  skipOnboarding()
  setCurrentProfile(null)
  localStorage.clear()
})

async function openRulesEditor() {
  if (transferKeywordsInput()) return
  byTestId('bank-rules-toggle')!.click()
  await settle()
}

describe('the Import page', () => {
  async function mountImport() {
    setPage('import')
    const { default: Import } = await import('../Import')
    dispose = render(() => <Import />, host)
    await settle()
    byTestId('import-tab-bank-imports')!.click()
    await settle()
    await openRulesEditor()
  }

  it('shows the new profile’s stored rules after a profile switch', async () => {
    await mountImport()
    expect(drafts()).toEqual(DRAFTS['1'])

    switchProfile('2')
    await settle()

    expect(drafts()).toEqual(DRAFTS['2'])
  })

  it('writes only the new profile’s rules when Save is pressed after a switch', async () => {
    await mountImport()
    switchProfile('2')
    await settle()

    byTestId('bank-rules-save')!.click()

    expect(stored('bankImportCategoryRules:2')).toEqual(STORED['2'].categoryRules)
    expect(stored('bankImportTransferRules:2')).toEqual(STORED['2'].transferRules)
    expect(stored('bankImportCategoryRules:1')).toEqual(STORED['1'].categoryRules)
    expect(stored('bankImportTransferRules:1')).toEqual(STORED['1'].transferRules)
  })

  it('shows the new profile’s mapping group after a profile switch', async () => {
    await mountImport()
    expect(ruleGroupSelect()!.value).toBe('croatian')

    switchProfile('2')
    await settle()

    expect(ruleGroupSelect()!.value).toBe('worldwide')
  })

  it('keeps unsaved rule edits when a quick-add bumps profileVersion on the same profile', async () => {
    await mountImport()
    type(document.querySelector('input[placeholder="keyword1, keyword2, ..."]')!, 'market, deli')
    type(transferKeywordsInput()!, 'top-up, savings')

    // What the quick-add bar's onSave does after adding a transaction (App.tsx).
    bumpProfileVersion()
    await settle()

    expect(drafts().keywords).toEqual(['market, deli'])
    expect(drafts().transferKeywords).toBe('top-up, savings')
  })

  it('shows a created profile’s rules, though creating one does not bump profileVersion', async () => {
    await mountImport()

    // Creating a profile (ProfileModal) makes it the active one: the storage adapter writes its id
    // and App's loadProfiles selects it. Nothing bumps profileVersion on that path.
    localStorage.setItem('currentProfileId', '2')
    setCurrentProfile(profile(2))
    await settle()

    expect(drafts()).toEqual(DRAFTS['2'])
  })
})

describe('the onboarding wizard', () => {
  it('shows the active profile’s rules when relaunched after a profile switch', async () => {
    startOnboarding('import')
    const { OnboardingWizard } = await import('../../components/onboarding/OnboardingWizard')
    dispose = render(() => <OnboardingWizard />, host)
    await settle()
    await openRulesEditor()
    expect(drafts()).toEqual(DRAFTS['1'])

    skipOnboarding()
    await settle()
    switchProfile('2')
    await settle()
    startOnboarding('import')
    await settle()
    await openRulesEditor()

    expect(drafts()).toEqual(DRAFTS['2'])
  })

  it('keeps unsaved rule edits when the import step is re-entered on the same profile', async () => {
    startOnboarding('import')
    const { OnboardingWizard } = await import('../../components/onboarding/OnboardingWizard')
    dispose = render(() => <OnboardingWizard />, host)
    await settle()
    await openRulesEditor()
    type(transferKeywordsInput()!, 'top-up, savings')

    skipOnboarding()
    await settle()
    startOnboarding('import')
    await settle()
    await openRulesEditor()

    expect(drafts().transferKeywords).toBe('top-up, savings')
  })
})
