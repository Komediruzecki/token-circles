/**
 * The local-first router's body checks: what a write must look like before a handler runs.
 *
 * A refused body answers 400 `{ error, fields }`, the Worker's answer (shared/refusal.ts): a plain
 * sentence per field for the form to show, and their summary for anything that cannot place them.
 * An entity with a shared schema (categories, transactions, accounts) runs exactly the Worker's
 * rules. The rest are still zod schemas until their own PR moves them
 * (docs/plans/2026-10-07-form-errors.md), and their issues are put into plain words here rather
 * than passed on in zod's.
 */
// Import the Zod JIT-disable config BEFORE this module's schema definitions:
// the JIT capability probe (a CSP unsafe-eval violation) fires at schema-
// DEFINITION time, so it must be configured first — and a module's imports
// always evaluate before its body, making this chunk-order-independent.
import './zodConfig'
import { z } from 'zod/v4'
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
import { refusalOf } from '../../../shared/refusal'
import { checkSettingsUpdate, checkStorageMode } from '../../../shared/settingsSchema'
import { checkTagCreate, defaultTagColor } from '../../../shared/tagSchema'
import { checkTransactionCreate } from '../../../shared/transactionSchema'
import { localMonth, localToday } from '../utils/period'
import { getLocalCurrency } from './api'
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

export const recurringCreateSchema = z.object({
  description: z.string().min(1),
  amount: z.number(),
  type: z.enum(['income', 'expense', 'transfer']),
  frequency: z.enum(['daily', 'weekly', 'monthly', 'yearly']),
  day_of_month: z.number().int().min(1).max(31).nullable().optional(),
  next_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  category_id: z.number().int().positive().nullable().optional(),
  notes: z.string().nullable().optional(),
})

export const recurringUpdateSchema = recurringCreateSchema.partial()

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

export const counterpartyCreateSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(['individual', 'business']).optional(),
  notes: z.string().optional(),
})

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
  'POST:/api/recurring': recurringCreateSchema,
  'PUT:/api/recurring': recurringUpdateSchema,
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
  'POST:/api/counterparties': counterpartyCreateSchema,
  'PUT:/api/counterparties': counterpartyCreateSchema.partial(),
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
 * One zod issue in plain words, for an entity whose schema has not moved to shared/ yet. The
 * label under the field gives it context, so the sentence only has to say what to do.
 */
function plainIssue(issue: z.core.$ZodIssue, key: string, given: unknown): string {
  const field = spoken(key) || 'details'
  const missing = given === undefined || given === null || given === ''
  // An id points at something the person picks from a list, whatever the number did wrong.
  if (/(_id|Id)$/.test(key) && issue.code !== 'custom') {
    return missing ? `Choose the ${field}.` : `Choose the ${field} from the list.`
  }
  switch (issue.code) {
    case 'invalid_type':
      return missing ? `Fill in the ${field}.` : `Enter a valid ${field}.`
    case 'too_small':
      if (issue.origin === 'string') return `Fill in the ${field}.`
      if (issue.origin === 'number' || issue.origin === 'int') {
        if (Number(issue.minimum) !== 0) return `Make the ${field} at least ${issue.minimum}.`
        return issue.inclusive
          ? `The ${field} can't be negative.`
          : `Make the ${field} more than zero.`
      }
      return `Check the ${field}.`
    case 'too_big':
      if (issue.origin === 'string') {
        return `Keep the ${field} to ${issue.maximum} characters or fewer.`
      }
      if (issue.origin === 'number' || issue.origin === 'int') {
        return `Make the ${field} ${issue.maximum} or less.`
      }
      return `Check the ${field}.`
    case 'invalid_value':
      return `Choose the ${field} from the list.`
    case 'invalid_format':
      return `Enter a valid ${field}.`
    case 'custom':
      // A refine's message is written for people where it is defined.
      return issue.message
    default:
      return `Check the ${field}.`
  }
}

/** A zod schema run as a check: the first plain sentence for each top-level field it refuses. */
function zodCheck(schema: z.ZodType, body: unknown): Checked<unknown> {
  const result = schema.safeParse(body)
  if (result.success) return { ok: true, value: result.data }
  const record = body !== null && typeof body === 'object' ? (body as Record<string, unknown>) : {}
  const fields: FieldErrors = {}
  for (const issue of result.error.issues) {
    const key = issue.path.length > 0 ? String(issue.path[0]) : ''
    // A refusal of the body as a whole has no field to stand under; the summary covers it.
    if (key === '' || fields[key] !== undefined) continue
    fields[key] = plainIssue(issue, key, record[key])
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
