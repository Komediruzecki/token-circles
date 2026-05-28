/**
 * Runtime validation schemas using Zod
 * Validates API request bodies before passing to handlers.
 */
import { z } from 'zod/v4'

// ── Transaction ────────────────────────────────────────────────────────────────

export const transactionCreateSchema = z.object({
  type: z.enum(['income', 'expense', 'transfer']),
  amount: z.number().positive(),
  description: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  category_id: z.number().int().positive().nullable(),
  currency: z.enum(['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY']).optional(),
  amount_local: z.number().nullable().optional(),
  exchange_rate: z.number().optional(),
  notes: z.string().optional(),
  beneficiary: z.string().optional(),
  payor: z.string().optional(),
  account_id: z.number().int().positive().nullable().optional(),
})

export const transactionUpdateSchema = transactionCreateSchema.partial()

// ── Category ───────────────────────────────────────────────────────────────────

export const categoryCreateSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(['income', 'expense']),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  icon: z.string().optional(),
  tax_deductible: z.boolean().optional(),
})

export const categoryUpdateSchema = categoryCreateSchema.partial()

// ── Account ────────────────────────────────────────────────────────────────────

export const accountCreateSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(['giro', 'savings', 'ib', 'cash']),
  currency: z.enum(['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY']).optional(),
  balance: z.number().optional(),
  bank_name: z.string().optional(),
  notes: z.string().optional(),
})

export const accountUpdateSchema = accountCreateSchema.partial()

// ── Budget ─────────────────────────────────────────────────────────────────────

export const budgetCreateSchema = z.object({
  category_id: z.number().int().positive(),
  amount: z.number().nonnegative(),
  period: z.enum(['monthly', 'weekly', 'yearly']),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
})

export const budgetUpdateSchema = budgetCreateSchema.partial()

// ── Bill ───────────────────────────────────────────────────────────────────────

export const billCreateSchema = z.object({
  name: z.string().min(1).max(100),
  amount: z.number().nonnegative(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  category_id: z.number().int().positive().nullable().optional(),
  recurring: z.boolean().optional(),
  frequency: z.enum(['monthly', 'weekly', 'biweekly']).optional(),
  autopay: z.boolean().optional(),
  type: z.enum(['bill', 'subscription']).optional(),
})

export const billUpdateSchema = billCreateSchema.partial()

// ── Loan ───────────────────────────────────────────────────────────────────────

export const loanCreateSchema = z.object({
  name: z.string().min(1).max(100),
  principal: z.number().positive(),
  interest_rate: z.number().nonnegative(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  term_months: z.number().int().positive(),
})

export const loanUpdateSchema = loanCreateSchema.partial()

// ── Savings Goal ───────────────────────────────────────────────────────────────

export const goalCreateSchema = z.object({
  name: z.string().min(1).max(100),
  target_amount: z.number().positive(),
  current_amount: z.number().nonnegative().optional(),
  deadline: z.string().nullable().optional(),
  notes: z.string().optional(),
})

export const goalUpdateSchema = goalCreateSchema.partial()

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
    local_currency: z.enum(['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY']).optional(),
    theme: z.enum(['light', 'dark']).optional(),
    primary_currency: z.enum(['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY']).optional(),
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

const schemaMap: Record<string, z.ZodType> = {
  'POST:/api/transactions': transactionCreateSchema,
  'PUT:/api/transactions': transactionUpdateSchema,
  'POST:/api/categories': categoryCreateSchema,
  'PUT:/api/categories': categoryUpdateSchema,
  'POST:/api/accounts': accountCreateSchema,
  'PUT:/api/accounts': accountUpdateSchema,
  'POST:/api/budgets': budgetCreateSchema,
  'PUT:/api/budgets': budgetUpdateSchema,
  'POST:/api/bills': billCreateSchema,
  'PUT:/api/bills': billUpdateSchema,
  'POST:/api/loans': loanCreateSchema,
  'PUT:/api/loans': loanUpdateSchema,
  'POST:/api/savings-goals': goalCreateSchema,
  'PUT:/api/savings-goals': goalUpdateSchema,
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

/**
 * Validates request body against the schema for the given method+path.
 * Returns null if validation passes, or a 400 Response with field-level errors.
 * Strips numeric path segments progressively to match parametrized routes.
 */
export function validateBody(method: string, path: string, body: unknown): Response | null {
  // Try exact match first, then progressively strip trailing numeric segments
  let candidate = path
  for (let i = 0; i < 3; i++) {
    const schema = schemaMap[`${method}:${candidate}`]
    if (schema) {
      const result = schema.safeParse(body)
      if (result.success) return null

      const issues: z.core.$ZodIssue[] = 'error' in result ? result.error.issues : []
      const errors = issues.map((issue) => ({
        field: issue.path.join('.') || '(root)',
        message: issue.message,
      }))

      return new Response(JSON.stringify({ error: 'Validation failed', details: errors }), {
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
