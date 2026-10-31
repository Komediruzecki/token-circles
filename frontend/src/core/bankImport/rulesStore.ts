/**
 * Bank statement import — persisted, user-editable rules.
 *
 * Category keyword rules and transfer rules are seeded from the defaults and
 * persisted per profile in localStorage so the user's edits survive reloads.
 * Like `memory.ts`, this is deliberately the only rules code that touches
 * browser storage, keeping the engine (`categoryRules.ts` / `transferRules.ts`)
 * pure and testable.
 */
import { DEFAULT_RULE_GROUP_ID, rulesForGroup } from '../../../../shared/bankImport/categoryRules'
import { DEFAULT_TRANSFER_RULES } from '../../../../shared/bankImport/transferRules'
import { earlierBuiltInGroup, sameJson } from './earlierBuiltInRules'
import type { CategoryRuleSet, TransferRuleSet } from '../../../../shared/bankImport/types'

const CAT_KEY = 'bankImportCategoryRules'
const TRANSFER_KEY = 'bankImportTransferRules'
const GROUP_KEY = 'bankImportRuleGroup'

/**
 * The scope the rules are stored under: the active profile. A caller that keeps a copy of them
 * (the import flow's editable drafts) compares this with the scope it loaded that copy for.
 */
export function rulesScope(): string {
  return localStorage.getItem('currentProfileId') || '1'
}

function scoped(key: string): string {
  return `${key}:${rulesScope()}`
}

export function loadCategoryRules(): CategoryRuleSet {
  try {
    const raw = localStorage.getItem(scoped(CAT_KEY))
    // No user override yet → the selected mapping group's seed (Croatian / Worldwide).
    if (!raw) return rulesForGroup(loadRuleGroup())
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return rulesForGroup(loadRuleGroup())
    // A copy of a group's built-in rules that an earlier version stored was never edited: it
    // loads as that group's rules now (earlierBuiltInRules.ts).
    const group = earlierBuiltInGroup(parsed)
    return group ? rulesForGroup(group) : (parsed as CategoryRuleSet)
  } catch {
    return rulesForGroup(loadRuleGroup())
  }
}

export function saveCategoryRules(rules: CategoryRuleSet): void {
  try {
    // The group's built-in rules as they are are not an edit: no copy is kept, so the rules follow
    // the built-in ones when a later version changes them, as they do for anyone who never saved.
    if (sameJson(rules, rulesForGroup(loadRuleGroup()))) localStorage.removeItem(scoped(CAT_KEY))
    else localStorage.setItem(scoped(CAT_KEY), JSON.stringify(rules))
  } catch {
    /* ignore quota / disabled storage */
  }
}

/** The selected category-mapping group id (defaults to Croatian). */
export function loadRuleGroup(): string {
  try {
    return localStorage.getItem(scoped(GROUP_KEY)) || DEFAULT_RULE_GROUP_ID
  } catch {
    return DEFAULT_RULE_GROUP_ID
  }
}

export function saveRuleGroup(id: string): void {
  try {
    localStorage.setItem(scoped(GROUP_KEY), id)
  } catch {
    /* ignore quota / disabled storage */
  }
}

export function loadTransferRules(): TransferRuleSet {
  try {
    const raw = localStorage.getItem(scoped(TRANSFER_KEY))
    if (!raw) return DEFAULT_TRANSFER_RULES
    const parsed = JSON.parse(raw) as Partial<TransferRuleSet>
    if (parsed && typeof parsed === 'object') {
      return {
        ownAccounts: Array.isArray(parsed.ownAccounts) ? parsed.ownAccounts : [],
        keywords: Array.isArray(parsed.keywords)
          ? parsed.keywords
          : DEFAULT_TRANSFER_RULES.keywords,
        counterparts:
          parsed.counterparts && typeof parsed.counterparts === 'object' ? parsed.counterparts : {},
      }
    }
    return DEFAULT_TRANSFER_RULES
  } catch {
    return DEFAULT_TRANSFER_RULES
  }
}

export function saveTransferRules(rules: TransferRuleSet): void {
  try {
    localStorage.setItem(scoped(TRANSFER_KEY), JSON.stringify(rules))
  } catch {
    /* ignore quota / disabled storage */
  }
}

/** Restore both rule sets to their built-in defaults (removes the overrides). */
export function resetBankImportRules(): void {
  try {
    localStorage.removeItem(scoped(CAT_KEY))
    localStorage.removeItem(scoped(TRANSFER_KEY))
  } catch {
    /* ignore */
  }
}
