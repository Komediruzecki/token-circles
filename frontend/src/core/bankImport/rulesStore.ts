/**
 * Bank statement import — persisted, user-editable rules.
 *
 * Category keyword rules and transfer rules are seeded from the defaults and
 * persisted per profile in localStorage so the user's edits survive reloads.
 * Like `memory.ts`, this is deliberately the only rules code that touches
 * browser storage, keeping the engine (`categoryRules.ts` / `transferRules.ts`)
 * pure and testable.
 */
import { DEFAULT_RULE_GROUP_ID, rulesForGroup } from './categoryRules'
import { DEFAULT_TRANSFER_RULES } from './transferRules'
import type { CategoryRuleSet, TransferRuleSet } from './types'

const CAT_KEY = 'bankImportCategoryRules'
const TRANSFER_KEY = 'bankImportTransferRules'
const GROUP_KEY = 'bankImportRuleGroup'

function scoped(key: string): string {
  const profile = localStorage.getItem('currentProfileId') || '1'
  return `${key}:${profile}`
}

export function loadCategoryRules(): CategoryRuleSet {
  try {
    const raw = localStorage.getItem(scoped(CAT_KEY))
    // No user override yet → the selected mapping group's seed (Croatian / Worldwide).
    if (!raw) return rulesForGroup(loadRuleGroup())
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as CategoryRuleSet) : rulesForGroup(loadRuleGroup())
  } catch {
    return rulesForGroup(loadRuleGroup())
  }
}

export function saveCategoryRules(rules: CategoryRuleSet): void {
  try {
    localStorage.setItem(scoped(CAT_KEY), JSON.stringify(rules))
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
