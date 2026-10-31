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
import {
  DEFAULT_CATEGORY_RULES,
  loadCategoryRules,
  loadRuleGroup,
  loadTransferRules,
  rulesForGroup,
} from '../../../core/bankImport'
import croatian671 from '../../../core/bankImport/__tests__/fixtures/built-in-rules-croatian-671.json'
import croatian5173 from '../../../core/bankImport/__tests__/fixtures/built-in-rules-croatian-v5.17.3.json'
import worldwide5173 from '../../../core/bankImport/__tests__/fixtures/built-in-rules-worldwide-v5.17.3.json'
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

describe('the names a built-in rule gave before', () => {
  /** The editor row of the rule that has `keyword`. */
  const ruleRow = (keyword: string) =>
    Array.from(host.querySelectorAll<HTMLElement>('[data-test-id="bank-rule-row"]')).find((row) =>
      labelled(row, 'Keywords').value.split(', ').includes(keyword)
    )!
  const savedRule = (keyword: string) =>
    loadCategoryRules().find((rule) => rule.keywords.includes(keyword))
  const saved = async () => {
    save().click()
    await vi.waitFor(() => {
      expect(confirmation()).toContain('Rules saved.')
    })
  }

  it('are saved with the rules, so saving them unchanged files every row where it went', async () => {
    await openEditor()
    await saved()

    expect(savedRule('petrol')).toMatchObject({
      category: 'Transportation',
      formerly: ['Car (Gas)'],
    })
    expect(savedRule('parking')).toMatchObject({
      category: 'Transportation',
      formerly: ['Transport'],
    })
    expect(loadCategoryRules()).toEqual(DEFAULT_CATEGORY_RULES)
  })

  it('go when the rule is given another category', async () => {
    const flow = await openEditor()
    expect(flow.categoryRuleDraft.find((r) => r.keywords.includes('petrol'))?.formerly).toEqual([
      'Car (Gas)',
    ])
    type(labelled(ruleRow('petrol'), 'Category'), 'Car')
    await saved()

    // The person named where these rows go: no space gets them under Car (Gas) now.
    expect(savedRule('petrol')?.category).toBe('Car')
    expect(savedRule('petrol')?.formerly).toBeUndefined()
    expect(savedRule('parking')?.formerly).toEqual(['Transport'])
  })

  it('stay when the category is typed over and typed back before the save', async () => {
    await openEditor()
    type(labelled(ruleRow('petrol'), 'Category'), 'Transportationx')
    type(labelled(ruleRow('petrol'), 'Category'), 'Transportation')
    await saved()

    // The category saved is the one the rule had: fuel still goes to a space's Car (Gas).
    expect(savedRule('petrol')?.formerly).toEqual(['Car (Gas)'])
    expect(loadCategoryRules()).toEqual(DEFAULT_CATEGORY_RULES)
  })

  it('stay when the category comes back in another case or with spaces around it', async () => {
    await openEditor()
    type(labelled(ruleRow('petrol'), 'Category'), ' transportation ')
    await saved()

    expect(savedRule('petrol')).toMatchObject({
      category: 'transportation',
      formerly: ['Car (Gas)'],
    })
  })

  it('leave unchanged rules equal to the defaults, so switching the mapping asks nothing', async () => {
    await openEditor()
    await saved()
    const asked = vi.spyOn(window, 'confirm').mockReturnValue(false)
    try {
      const mapping = host.querySelector('option[value="worldwide"]')!
        .parentElement as HTMLSelectElement
      choose(mapping, 'worldwide')

      expect(asked).not.toHaveBeenCalled()
      expect(loadRuleGroup()).toBe('worldwide')
    } finally {
      asked.mockRestore()
    }
  })
})

describe('rules stored as an earlier version of the built-in ones', () => {
  // Until now a mapping switch stored a full copy of the group's built-in rules; the fixtures are
  // those rules as git has them at each version (core/bankImport/__tests__/fixtures).
  const mapping = () =>
    host.querySelector('option[value="worldwide"]')!.parentElement as HTMLSelectElement
  const storeRules = (rules: unknown, group: string) => {
    localStorage.setItem('bankImportRuleGroup:1', group)
    localStorage.setItem('bankImportCategoryRules:1', JSON.stringify(rules))
  }

  it.each([
    ['Croatian, 5.17.3', croatian5173, 'croatian', 'worldwide'],
    ['Croatian, main after #671', croatian671, 'croatian', 'worldwide'],
    ['Worldwide, 5.17.3', worldwide5173, 'worldwide', 'croatian'],
  ])(
    'show as the rules now, and switching the mapping asks nothing: %s',
    async (_version, copy, group, other) => {
      storeRules(copy, group)
      const flow = await openEditor()
      expect(flow.categoryRuleDraft.map((rule) => rule.category)).toEqual(
        rulesForGroup(group).map((rule) => rule.category)
      )
      const asked = vi.spyOn(window, 'confirm').mockReturnValue(false)
      try {
        choose(mapping(), other)

        expect(asked).not.toHaveBeenCalled()
        expect(loadRuleGroup()).toBe(other)
      } finally {
        asked.mockRestore()
      }
    }
  )

  it('still ask before a switch once they were edited', async () => {
    const edited = structuredClone(croatian5173)
    edited[0].keywords.push('test market')
    storeRules(edited, 'croatian')
    await openEditor()
    const asked = vi.spyOn(window, 'confirm').mockReturnValue(false)
    try {
      choose(mapping(), 'worldwide')

      expect(asked).toHaveBeenCalledOnce()
      expect(loadRuleGroup()).toBe('croatian')
      expect(loadCategoryRules()).toEqual(edited)
    } finally {
      asked.mockRestore()
    }
  })
})
