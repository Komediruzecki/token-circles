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
}

/**
 * Validates request body against the schema for the given method+path.
 * Returns null if validation passes, or a 400 Response with field-level errors.
 */
export function validateBody(method: string, path: string, body: unknown): Response | null {
  // Only validate if we have a schema for this route + method
  const routeKey = `${method}:${path}`
  const idLessKey = `${method}:${path.replace(/\/\d+$/, '')}`
  const schema = schemaMap[routeKey] || schemaMap[idLessKey]
  if (!schema) return null

  const result = schema.safeParse(body)
  if (result.success) return null

  const errors = (result as any).error.issues.map((issue: any) => ({
    field: issue.path.join('.') || '(root)',
    message: issue.message,
  }))

  return new Response(JSON.stringify({ error: 'Validation failed', details: errors }), {
    status: 400,
    headers: { 'Content-Type': 'application/json' },
  })
}
