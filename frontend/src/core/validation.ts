/**
 * The local-first router's body checks: what a write must look like before a handler runs.
 *
 * A refused body answers 400 `{ error, fields }`, the Worker's answer (shared/refusal.ts): a plain
 * sentence per field for the form to show, and their summary for anything that cannot place them.
 * Every entity this router checks runs exactly the Worker's rules, from its shared schema
 * (docs/plans/2026-10-07-form-errors.md). None is a zod schema any more; one put in the map would
 * still be answered in plain words, not zod's (zodCheck).
 */
// The Zod JIT-disable config, first (core/zodConfig.ts). This module defines no zod schema now,
// but a schema put back in the map below would be defined here, and the JIT capability probe (a
// CSP unsafe-eval violation) fires at schema-definition time.
import './zodConfig'
import { checkAccountCreate } from '../../../shared/accountSchema'
import { checkBillCreate } from '../../../shared/billSchema'
import { checkBudgetCreate } from '../../../shared/budgetSchema'
import {
  checkApplyMappings,
  checkAutoMap,
  checkCategoryMapping,
} from '../../../shared/categoryMappingSchema'
import { checkCategoryCreate } from '../../../shared/categorySchema'
import { checkGoalCreate } from '../../../shared/goalSchema'
import { checkHoldingCreate } from '../../../shared/holdingSchema'
import { checkHousingCreate } from '../../../shared/housingSchema'
import { checkImportSourceCreate, checkSheetFetch } from '../../../shared/importSourceSchema'
import { checkLoanCreate } from '../../../shared/loanSchema'
import { checkProfileCreate } from '../../../shared/profileSchema'
import { checkRecurringCreate } from '../../../shared/recurringSchema'
import { refusalOf } from '../../../shared/refusal'
import { checkSettingsUpdate, checkStorageMode } from '../../../shared/settingsSchema'
import { checkTagCreate, defaultTagColor } from '../../../shared/tagSchema'
import { checkTransactionCreate } from '../../../shared/transactionSchema'
import { localMonth, localToday } from '../utils/period'
import { getLocalCurrency } from './api'
import type { z } from 'zod/v4'
import type { HousingDefaults } from '../../../shared/housingSchema'
import type { Checked, FieldErrors } from '../../../shared/refusal'
import type { TransactionDefaults } from '../../../shared/transactionSchema'

// ── Transaction ────────────────────────────────────────────────────────────────
// Not a zod schema: shared/transactionSchema.ts, which the Worker route runs too.

/**
 * What a blank date or currency means in a local-first body: today on this device's calendar,
 * and the currency the app keeps its balances in.
 */
export function localTransactionDefaults(): TransactionDefaults {
  return { today: localToday(), currency: getLocalCurrency() }
}

// ── Category ───────────────────────────────────────────────────────────────────
// Not a zod schema: shared/categorySchema.ts, which the Worker route runs too.

// ── Account ────────────────────────────────────────────────────────────────────
// Not a zod schema: shared/accountSchema.ts, which the Worker route runs too.

// ── Budget ─────────────────────────────────────────────────────────────────────
// Not a zod schema: shared/budgetSchema.ts, which the Worker route runs too.

// ── Bill ───────────────────────────────────────────────────────────────────────
// Not a zod schema: shared/billSchema.ts, which the Worker route runs too.

// ── Loan ───────────────────────────────────────────────────────────────────────
// Not a zod schema: shared/loanSchema.ts, which the Worker route runs too.

// ── Savings Goal ───────────────────────────────────────────────────────────────
// Not a zod schema: shared/goalSchema.ts, which the Worker route runs too.

// ── Recurring Transaction ──────────────────────────────────────────────────────
// Not a zod schema: shared/recurringSchema.ts, which the Worker route runs too.

// ── Tag ────────────────────────────────────────────────────────────────────────
// Not a zod schema: shared/tagSchema.ts, which the Worker route runs too.

// ── Portfolio Holding ──────────────────────────────────────────────────────────
// Not a zod schema: shared/holdingSchema.ts, which the Worker route runs too.

// ── Settings ───────────────────────────────────────────────────────────────────
// Not a zod schema: shared/settingsSchema.ts, which the Worker route runs too.

// ── Profile ────────────────────────────────────────────────────────────────────
// Not a zod schema: shared/profileSchema.ts, which the Worker route runs too.

// ── Housing ────────────────────────────────────────────────────────────────────
// Not a zod schema: shared/housingSchema.ts, which the Worker route runs too. The zod schema
// that was here was registered under /api/housings, a path nothing calls, and described a
// purchase the Housing form does not send.

/** What a blank due month means in a local-first body: this month on this device's calendar. */
export function localHousingDefaults(): HousingDefaults {
  return { month: Number(localMonth().slice(5, 7)) }
}

// ── Counterparty ───────────────────────────────────────────────────────────────
// No check: local-first serves only GET /api/counterparties, and the router answers any other
// method 405 before a body is checked. The zod schema that was here was reached by nothing.

// ── Route-to-schema mapping ────────────────────────────────────────────────────

/** A shared schema's own check, or a zod schema whose issues are put into words below. */
type BodyRule = z.ZodType | ((body: unknown) => Checked<unknown>)

const schemaMap: Record<string, BodyRule> = {
  'POST:/api/transactions': (body) => checkTransactionCreate(body, localTransactionDefaults()),
  // No PUT entry for transactions, categories or accounts: an edit is checked by its handler
  // against the stored row, since a value the row already holds is never refused
  // (checkTransactionEdit, checkCategoryEdit and checkAccountEdit in shared/).
  'POST:/api/categories': checkCategoryCreate,
  'POST:/api/categories/mappings': checkCategoryMapping,
  'POST:/api/categories/apply-mappings': checkApplyMappings,
  'POST:/api/categories/auto-map': checkAutoMap,
  'POST:/api/accounts': checkAccountCreate,
  // No PUT entry for budgets, bills, loans or savings goals either: their handlers check an edit
  // against the stored row (checkBudgetEdit, checkBillEdit, checkLoanEdit and checkGoalEdit in
  // shared/).
  'POST:/api/budgets': (body) => checkBudgetCreate(body, { monthStart: `${localMonth()}-01` }),
  'POST:/api/bills': checkBillCreate,
  'POST:/api/loans': checkLoanCreate,
  'POST:/api/savings-goals': (body) => checkGoalCreate(body, { today: localToday() }),
  // An edit is checked by its handler against the stored rule (checkRecurringEdit).
  'POST:/api/recurring': checkRecurringCreate,
  // A new tag's colour, when it has none, depends on the profile's tags: its handler fills it in.
  // An edit is checked by its handler against the stored tag (checkTagEdit).
  'POST:/api/tags': (body) => checkTagCreate(body, defaultTagColor(0)),
  // An edit is checked by its handler against the stored holding (checkHoldingEdit).
  'POST:/api/portfolio/holdings': checkHoldingCreate,
  'PUT:/api/settings': checkSettingsUpdate,
  'POST:/api/storage-mode': checkStorageMode,
  'POST:/api/settings/set-storage': checkStorageMode,
  // A rename is checked by its handler against the stored name (checkProfileRename).
  'POST:/api/profiles': checkProfileCreate,
  // An edit of a source is checked by its handler against the stored kind (checkImportSourceEdit).
  'POST:/api/import-sources': checkImportSourceCreate,
  'POST:/api/import/googlesheet': checkSheetFetch,
  // An edit is checked by its handler against the stored row (checkHousingEdit).
  'POST:/api/housing': (body) => checkHousingCreate(body, localHousingDefaults()),
}

/** A body field as a person says it: `category_id` is "category", `dueDate` is "due date". */
function spoken(field: string): string {
  return field
    .replace(/(_id|Id)$/, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .toLowerCase()
    .trim()
}

/**
 * One zod issue in plain words, never zod's own ("Too small: expected string to have >=1
 * characters"). The label under the field gives it context. A refine's message is written for
 * people where it is defined, so it is passed on.
 */
function plainIssue(issue: z.core.$ZodIssue, key: string): string {
  if (issue.code === 'custom') return issue.message
  return `Check the ${spoken(key) || 'details'}.`
}

/**
 * A zod schema run as a check: one plain sentence for each top-level field it refuses. No schema
 * in the map is a zod one now; exported so its test keeps the words plain for the next.
 */
export function zodCheck(schema: z.ZodType, body: unknown): Checked<unknown> {
  const result = schema.safeParse(body)
  if (result.success) return { ok: true, value: result.data }
  const fields: FieldErrors = {}
  for (const issue of result.error.issues) {
    const key = issue.path.length > 0 ? String(issue.path[0]) : ''
    // A refusal of the body as a whole has no field to stand under; the summary covers it.
    if (key === '' || fields[key] !== undefined) continue
    fields[key] = plainIssue(issue, key)
  }
  return { ok: false, fields }
}

/**
 * Checks a request body against the rule for its method and path. Returns null when it passes,
 * or the 400 refusal to answer with: `{ error, fields }`, as the Worker answers.
 * Strips numeric path segments progressively to match parametrized routes.
 */
export function validateBody(method: string, path: string, body: unknown): Response | null {
  // Try exact match first, then progressively strip trailing numeric segments
  let candidate = path
  for (let i = 0; i < 3; i++) {
    const rule = schemaMap[`${method}:${candidate}`]
    if (rule) {
      const checked = typeof rule === 'function' ? rule(body) : zodCheck(rule, body)
      if (checked.ok) return null
      return new Response(JSON.stringify(refusalOf(checked.fields)), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    const stripped = candidate.replace(/\/\d+$/, '')
    if (stripped === candidate) break
    candidate = stripped
  }
  return null
}
