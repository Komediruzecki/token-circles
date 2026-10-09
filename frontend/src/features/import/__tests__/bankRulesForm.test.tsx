/**
 * The Bank Imports rules editor on the form kit, with the real import flow in local-first mode: the
 * rules it saves are the ones the flow keeps in this browser (core/bankImport/rulesStore.ts).
 *
 * A rule half filled in, a category with no keyword or a signature with no account, used to be
 * dropped on save without a word, beside a "Rules saved." that said otherwise. Now the part that
 * is missing is marked, focus moves to it, and nothing is saved until it is filled in or removed
 * (core/bankImport/rulesCheck.ts). Recalculate on the preview step saves the same rules, so it
 * refuses the same way and runs nothing.
 */
import { createRoot } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { setPage } from '../../../core/appStore'
import { loadCategoryRules, loadTransferRules } from '../../../core/bankImport'
import { BANK_RULE_MESSAGES as M } from '../../../core/bankImport/rulesCheck'
import { __resetDataVersionsForTest } from '../../../core/dataVersions'
import { getDB } from '../../../core/storage/idb'
import type { ImportFlow } from '../importFlow'

let host: HTMLDivElement
let dispose: (() => void) | undefined

beforeAll(async () => {
  await Promise.all([
    import('../BankRulesEditor'),
    import('../importFlow'),
    import('../../../core/storage/localApiRouter'),
  ])
}, 120_000)

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('finance_storage_mode', 'serverless')
  localStorage.setItem('currentProfileId', '1')
  localStorage.setItem('selectedProfileIds', '[1]')
  __resetDataVersionsForTest()
  const db = await getDB()
  for (const store of Array.from(db.objectStoreNames)) await db.clear(store)
  await db.add('profiles', { id: 1, name: 'Household', created_at: '2026-01-01T00:00:00.000Z' })
  const add = (store: string, row: Record<string, unknown>) =>
    (db as unknown as { add(s: string, r: unknown): Promise<unknown> }).add(store, row)
  await add('accounts', {
    id: 5,
    profile_id: 1,
    name: 'Everyday',
    type: 'giro',
    currency: 'EUR',
    balance: 0,
  })
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  host.remove()
})

async function openEditor(onRecalculate?: () => void): Promise<ImportFlow> {
  setPage('import')
  const { BankRulesEditor } = await import('../BankRulesEditor')
  const { createImportFlow } = await import('../importFlow')
  let flow!: ImportFlow
  dispose = createRoot((disposeRoot) => {
    flow = createImportFlow({ initialTab: 'bank-imports' })
    flow.init()
    flow.setShowBankRules(true)
    const unmount = render(
      () => <BankRulesEditor flow={flow} onRecalculate={onRecalculate} />,
      host
    )
    return () => {
      unmount()
      disposeRoot()
    }
  })
  await vi.waitFor(() => {
    expect(host.querySelector('[data-test-id="bank-rules-form"]')).not.toBeNull()
    expect(flow.bankAccounts().map((a) => a.name)).toContain('Everyday')
  })
  return flow
}

const buttonNamed = (text: string) =>
  Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.trim() === text)!
const save = () => host.querySelector<HTMLButtonElement>('[data-test-id="bank-rules-save"]')!
const confirmation = () =>
  host.querySelector('[data-test-id="bank-rules-confirmation"]')?.textContent ?? null
const lastRow = (testId: string) => {
  const rows = host.querySelectorAll<HTMLElement>(`[data-test-id="${testId}"]`)
  return rows[rows.length - 1]!
}
const labelled = (row: HTMLElement, label: string) => {
  const found = Array.from(row.querySelectorAll('label')).find((l) => l.textContent === label)!
  return document.getElementById(found.htmlFor) as HTMLInputElement & HTMLSelectElement
}
const describedBy = (el: HTMLElement): string =>
  (el.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' | ')

function type(control: HTMLInputElement, text: string): void {
  control.value = text
  control.dispatchEvent(new InputEvent('input', { bubbles: true }))
}

function choose(control: HTMLSelectElement, value: string): void {
  control.value = value
  control.dispatchEvent(new Event('change', { bubbles: true }))
}

async function newRule(category: string, keywords: string): Promise<HTMLElement> {
  buttonNamed('Add category rule').click()
  await Promise.resolve()
  const row = lastRow('bank-rule-row')
  type(labelled(row, 'Category'), category)
  type(labelled(row, 'Keywords'), keywords)
  return row
}

const savedCategories = () => loadCategoryRules().map((rule) => rule.category)

describe('a category rule half filled in', () => {
  it('is marked at its missing keyword, focused, and nothing is saved', async () => {
    await openEditor()
    const before = loadCategoryRules()
    const row = await newRule('Pets', ' , ')
    save().click()

    const keywords = labelled(row, 'Keywords')
    await vi.waitFor(() => {
      expect(keywords.getAttribute('aria-invalid')).toBe('true')
    })
    expect(describedBy(keywords)).toContain(M.keywords)
    expect(document.activeElement).toBe(keywords)
    expect(loadCategoryRules()).toEqual(before)
    expect(confirmation()).toBeNull()
  })

  it('is marked at its missing category', async () => {
    await openEditor()
    const row = await newRule('', 'vet, petshop')
    save().click()

    const category = labelled(row, 'Category')
    await vi.waitFor(() => {
      expect(category.getAttribute('aria-invalid')).toBe('true')
    })
    expect(describedBy(category)).toContain(M.category)
    expect(savedCategories()).not.toContain('')
  })

  it('loses its mark as the missing part is filled in, and then saves', async () => {
    await openEditor()
    const row = await newRule('Pets', '')
    save().click()
    const keywords = labelled(row, 'Keywords')
    await vi.waitFor(() => {
      expect(keywords.getAttribute('aria-invalid')).toBe('true')
    })

    type(keywords, 'vet, petshop')
    expect(keywords.getAttribute('aria-invalid')).toBeNull()
    save().click()
    await vi.waitFor(() => {
      expect(confirmation()).toContain('Rules saved.')
    })
    expect(loadCategoryRules()).toContainEqual({ category: 'Pets', keywords: ['vet', 'petshop'] })
  })
})

describe('a counterpart half filled in', () => {
  it('is marked at its missing account, or its missing signature', async () => {
    await openEditor()
    const before = loadTransferRules()
    buttonNamed('Add counterpart').click()
    await Promise.resolve()
    const signed = lastRow('bank-counterpart-row')
    type(labelled(signed, 'Signature'), '1111')
    buttonNamed('Add counterpart').click()
    await Promise.resolve()
    const chosen = lastRow('bank-counterpart-row')
    choose(labelled(chosen, 'Account'), 'Everyday')
    save().click()

    await vi.waitFor(() => {
      expect(labelled(signed, 'Account').getAttribute('aria-invalid')).toBe('true')
    })
    expect(describedBy(labelled(signed, 'Account'))).toContain(M.account)
    expect(describedBy(labelled(chosen, 'Signature'))).toContain(M.signature)
    expect(document.activeElement).toBe(labelled(signed, 'Account'))
    expect(loadTransferRules()).toEqual(before)
  })

  it('is saved whole', async () => {
    await openEditor()
    buttonNamed('Add counterpart').click()
    await Promise.resolve()
    const row = lastRow('bank-counterpart-row')
    type(labelled(row, 'Signature'), '1111')
    choose(labelled(row, 'Account'), 'Everyday')
    save().click()
    await vi.waitFor(() => {
      expect(confirmation()).toContain('Rules saved.')
    })
    expect(loadTransferRules().counterparts).toMatchObject({ '1111': 'Everyday' })
  })
})

describe('the rules as a whole', () => {
  it('drops a rule left wholly empty without a word, as before', async () => {
    await openEditor()
    const before = loadCategoryRules()
    await newRule('', '')
    save().click()
    await vi.waitFor(() => {
      expect(confirmation()).toContain('Rules saved.')
    })
    expect(loadCategoryRules()).toEqual(before)
  })

  it('confirms a save that writes the keywords out its own way, and shows them as kept', async () => {
    await openEditor()
    const row = await newRule('Pets', 'vet,petshop ,')
    save().click()
    await vi.waitFor(() => {
      expect(confirmation()).toContain('Rules saved.')
    })
    expect(labelled(lastRow('bank-rule-row'), 'Keywords').value).toBe('vet, petshop')
    expect(row.isConnected).toBe(true)
  })

  it("keeps an edit in the flow's drafts, for the preview step's editor", async () => {
    const flow = await openEditor()
    await newRule('Pets', 'vet')
    expect(flow.categoryRuleDraft.at(-1)).toEqual({ category: 'Pets', keywords: 'vet' })
  })

  it('starts over, marks and all, on Reset to defaults', async () => {
    await openEditor()
    const rows = host.querySelectorAll('[data-test-id="bank-rule-row"]').length
    const row = await newRule('Pets', '')
    save().click()
    await vi.waitFor(() => {
      expect(labelled(row, 'Keywords').getAttribute('aria-invalid')).toBe('true')
    })

    buttonNamed('Reset to defaults').click()
    await vi.waitFor(() => {
      expect(host.querySelectorAll('[data-test-id="bank-rule-row"]')).toHaveLength(rows)
    })
    expect(host.querySelector('[aria-invalid="true"]')).toBeNull()
  })
})

describe('Recalculate preview', () => {
  it('refuses a rule half filled in and runs nothing, then runs on the saved rules', async () => {
    const onRecalculate = vi.fn()
    await openEditor(onRecalculate)
    const row = await newRule('Pets', '')
    buttonNamed('Recalculate preview').click()
    await vi.waitFor(() => {
      expect(labelled(row, 'Keywords').getAttribute('aria-invalid')).toBe('true')
    })
    expect(onRecalculate).not.toHaveBeenCalled()

    type(labelled(row, 'Keywords'), 'vet')
    buttonNamed('Recalculate preview').click()
    await vi.waitFor(() => {
      expect(onRecalculate).toHaveBeenCalledTimes(1)
    })
    expect(savedCategories()).toContain('Pets')
    // It recalculates instead of confirming a save.
    expect(confirmation()).toBeNull()
  })
})
