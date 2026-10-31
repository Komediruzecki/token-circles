/**
 * What a Bank Imports rule needs before the editor saves it.
 *
 * The rules live in this browser only (rulesStore.ts), so this is the one check there is: no
 * runtime sees them. A rule that was half filled in, a category with no keyword or a signature
 * with no account, used to be dropped on save without a word, beside a "Rules saved." that said
 * otherwise. Now it is marked at the part that is missing, and nothing is saved until it is filled
 * in or removed. A row left wholly empty is still dropped: it says nothing to keep.
 */
import type { FieldErrors } from '../../../../shared/refusal'

/** A category rule as the editor holds it: the keywords as the person typed them. */
export interface CategoryRuleDraft {
  category: string
  keywords: string
  /**
   * The names the rule gave before its category (CategoryRule.formerly), not shown. Kept so that
   * saving a built-in rule unchanged still files a space's rows where they went; dropped when the
   * rule is saved with another category, because then the person has said where its rows go.
   */
  formerly?: string[]
  /** The category the rule was loaded with, beside `formerly`: see `savedFormerNames`. */
  loadedCategory?: string
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/**
 * The former names a rule is saved with: its `formerly`, while its category is still the one it
 * was loaded with (trimmed, case-blind), and none once it differs. Decided on save, not as the
 * person types: a category typed over and typed back is the rule as it was.
 */
export function savedFormerNames(rule: CategoryRuleDraft): string[] | undefined {
  const { formerly, loadedCategory } = rule
  if (!formerly || formerly.length === 0 || loadedCategory === undefined) return undefined
  return sameName(rule.category, loadedCategory) ? [...formerly] : undefined
}

/** A transfer counterpart as the editor holds it: a signature and the account it stands for. */
export interface CounterpartDraft {
  signature: string
  account: string
}

export const BANK_RULE_MESSAGES = {
  category: 'Name the category these keywords file into, or remove the rule.',
  keywords: 'Add a keyword to match, like "konzum", or remove the rule.',
  account: 'Choose the account this signature stands for, or remove it.',
  signature: "Add the text that marks this account, like a card's last 4 digits, or remove it.",
} as const

/** The keywords a person typed, as the rule keeps them: comma-separated, trimmed, none empty. */
export function keywordsOf(text: string): string[] {
  return text
    .split(',')
    .map((keyword) => keyword.trim())
    .filter(Boolean)
}

/** Each rule's missing part, as `categoryRules.<i>.<field>` or `counterparts.<i>.<field>`. */
export function checkBankRuleDrafts(drafts: {
  categoryRules: readonly CategoryRuleDraft[]
  counterparts: readonly CounterpartDraft[]
}): FieldErrors {
  const fields: FieldErrors = {}
  drafts.categoryRules.forEach((rule, index) => {
    const named = rule.category.trim() !== ''
    const matched = keywordsOf(rule.keywords).length > 0
    if (named === matched) return
    if (named) fields[`categoryRules.${index}.keywords`] = BANK_RULE_MESSAGES.keywords
    else fields[`categoryRules.${index}.category`] = BANK_RULE_MESSAGES.category
  })
  drafts.counterparts.forEach((counterpart, index) => {
    const signed = counterpart.signature.trim() !== ''
    const chosen = counterpart.account !== ''
    if (signed === chosen) return
    if (signed) fields[`counterparts.${index}.account`] = BANK_RULE_MESSAGES.account
    else fields[`counterparts.${index}.signature`] = BANK_RULE_MESSAGES.signature
  })
  return fields
}
