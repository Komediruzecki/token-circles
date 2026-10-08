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
import { checkCategoryCreate } from '../../../shared/categorySchema'
import { checkGoalCreate } from '../../../shared/goalSchema'
import { checkLoanCreate } from '../../../shared/loanSchema'
import { refusalOf } from '../../../shared/refusal'
import { checkTransactionCreate } from '../../../shared/transactionSchema'
import { localMonth, localToday } from '../utils/period'
import { getLocalCurrency } from './api'
import type { Checked, FieldErrors } from '../../../shared/refusal'
import type { TransactionDefaults } from '../../../shared/transactionSchema'

const currencyCodeSchema = z.string().regex(/^[A-Z]{3}$/)

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

export const tagCreateSchema = z.object({
  name: z.string().min(1).max(50),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
})

export const tagUpdateSchema = tagCreateSchema.partial()

// ── Portfolio Holding ──────────────────────────────────────────────────────────

export const portfolioHoldingCreateSchema = z.object({
  ticker: z.string().min(1).max(10),
  shares: z.number().positive(),
  purchase_price: z.number().positive(),
  purchase_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().optional(),
})

// ── Settings ───────────────────────────────────────────────────────────────────

export const settingsUpdateSchema = z
  .object({
    local_currency: currencyCodeSchema.optional(),
    theme: z.enum(['light', 'dark']).optional(),
    primary_currency: currencyCodeSchema.optional(),
    language: z.enum(['en', 'de', 'fr', 'es']).optional(),
  })
  .loose()

// ── Profile ────────────────────────────────────────────────────────────────────

export const profileCreateSchema = z.object({
  name: z.string().min(1).max(100),
})

export const profileUpdateSchema = profileCreateSchema.partial()

// ── Housing ────────────────────────────────────────────────────────────────────

export const housingCreateSchema = z.object({
  name: z.string().min(1).max(100),
  purchase_price: z.number().positive(),
  monthly_rent: z.number().nonnegative().optional(),
  down_payment: z.number().nonnegative().optional(),
  interest_rate: z.number().nonnegative().optional(),
  loan_term_years: z.number().int().positive().optional(),
  property_tax_rate: z.number().nonnegative().optional(),
  maintenance_rate: z.number().nonnegative().optional(),
  appreciation_rate: z.number().nonnegative().optional(),
  inflation_rate: z.number().nonnegative().optional(),
})

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
  'POST:/api/tags': tagCreateSchema,
  'PUT:/api/tags': tagUpdateSchema,
  'POST:/api/portfolio/holdings': portfolioHoldingCreateSchema,
  'PUT:/api/portfolio/holdings': portfolioHoldingCreateSchema,
  'PUT:/api/settings': settingsUpdateSchema,
  'POST:/api/profiles': profileCreateSchema,
  'PUT:/api/profiles': profileUpdateSchema,
  'PATCH:/api/profiles': profileUpdateSchema,
  'POST:/api/housings': housingCreateSchema,
  'PUT:/api/housings': housingCreateSchema.partial(),
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
