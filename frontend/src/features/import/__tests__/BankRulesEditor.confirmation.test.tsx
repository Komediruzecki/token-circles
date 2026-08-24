/**
 * Saving rules confirms beside the button, not in the page-top banner.
 *
 * The rules editor sits far down a scrolling step — in onboarding especially — and the global
 * `resultMessage` banner renders above the fold. On a phone the confirmation appeared a full
 * screen away from the click and was never seen, which made "Save rules" look like it did
 * nothing. The editor now answers where the question was asked.
 */
import { createSignal } from 'solid-js'
import { createStore } from 'solid-js/store'
import { render } from 'solid-js/web'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BankRulesEditor } from '../BankRulesEditor'
import type { ImportFlow } from '../importFlow'

let host: HTMLDivElement
let dispose: (() => void) | undefined

function mountEditor() {
  const [showBankRules, setShowBankRules] = createSignal(true)
  const [ruleGroup, setRuleGroup] = createSignal('croatian')
  const [categoryRuleDraft, setCategoryRuleDraft] = createStore<
    Array<{ category: string; keywords: string }>
  >([])
  const [transferKeywordDraft, setTransferKeywordDraft] = createSignal('')
  const [counterpartDraft, setCounterpartDraft] = createStore<
    Array<{ from: string; to: string; keywords: string }>
  >([])
  const saveBankRules = vi.fn()
  const resetBankRules = vi.fn()

  // Only what the editor touches; the controller is 50 members of unrelated import state.
  const flow = {
    showBankRules,
    setShowBankRules,
    ruleGroup,
    setRuleGroup,
    categoryRuleDraft,
    setCategoryRuleDraft,
    transferKeywordDraft,
    setTransferKeywordDraft,
    counterpartDraft,
    setCounterpartDraft,
    saveBankRules,
    resetBankRules,
    loadBankRules: vi.fn(),
    loading: () => false,
    bankCategories: () => [],
    bankAccounts: () => [],
  } as unknown as ImportFlow

  host = document.createElement('div')
  document.body.appendChild(host)
  dispose = render(() => <BankRulesEditor flow={flow} />, host)
  return { saveBankRules, resetBankRules }
}

afterEach(() => {
  dispose?.()
  dispose = undefined
  host.remove()
  vi.useRealTimers()
})

describe('the Save rules confirmation', () => {
  it('appears beside the button and names what happened', () => {
    const { saveBankRules } = mountEditor()
    expect(host.querySelector('[data-test-id="bank-rules-confirmation"]')).toBeNull()

    host.querySelector<HTMLButtonElement>('[data-test-id="bank-rules-save"]')!.click()

    expect(saveBankRules).toHaveBeenCalledTimes(1)
    const note = host.querySelector('[data-test-id="bank-rules-confirmation"]')
    expect(note).not.toBeNull()
    expect(note!.textContent).toContain('Rules saved.')
    // In the same flex row as the button it confirms — not a distant banner.
    expect(note!.parentElement!.querySelector('[data-test-id="bank-rules-save"]')).not.toBeNull()
  })

  it('leaves on its own instead of hanging around', () => {
    vi.useFakeTimers()
    mountEditor()
    host.querySelector<HTMLButtonElement>('[data-test-id="bank-rules-save"]')!.click()
    expect(host.querySelector('[data-test-id="bank-rules-confirmation"]')).not.toBeNull()

    vi.advanceTimersByTime(4100)
    expect(host.querySelector('[data-test-id="bank-rules-confirmation"]')).toBeNull()
  })

  it('a save right after a reset keeps the newer message and the newer clock', () => {
    vi.useFakeTimers()
    mountEditor()
    const reset = [...host.querySelectorAll('button')].find(
      (b) => b.textContent === 'Reset to defaults'
    )!
    reset.click()
    vi.advanceTimersByTime(3000)
    host.querySelector<HTMLButtonElement>('[data-test-id="bank-rules-save"]')!.click()

    // The reset's 4s clock would have expired here; the save's has not.
    vi.advanceTimersByTime(2000)
    const note = host.querySelector('[data-test-id="bank-rules-confirmation"]')
    expect(note).not.toBeNull()
    expect(note!.textContent).toContain('Rules saved.')
  })
})
