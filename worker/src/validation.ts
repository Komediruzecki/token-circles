import { z } from 'zod'
import { HttpError } from './http'

/**
 * Server-side validation for the money-mutating transaction routes.
 *
 * Deliberately NARROW: it validates only the fields that feed account-balance arithmetic
 * (amount, type, and the account/category ids) and leaves everything else (description, currency,
 * beneficiary, notes, dates, tags, …) untouched. We validate the request body but keep the handler
 * reading the original body, so accepted-input behaviour for legitimate clients is unchanged — this
 * is a reject-garbage gate, not a reshaping layer.
 *
 * Why not port the backend schema wholesale: the backend's `currency` enum lists only 6 codes while
 * the app supports 20, so porting it would reject valid transactions. Coercion (`z.coerce`) mirrors
 * the worker's existing `Number(amount)` leniency, so a stringified number still passes.
 */

const TX_TYPES = ['income', 'expense', 'transfer', 'deduction'] as const
const MAX_AMOUNT = 1_000_000_000_000 // 1e12 — far above any real personal-finance amount

// Finite, within range, at most 2 decimal places (mirrors backend transactionCreateSchema.amount).
const amountField = z.coerce
  .number()
  .refine((v) => Number.isFinite(v), { message: 'must be a finite number' })
  .refine((v) => Math.abs(v) <= MAX_AMOUNT, { message: 'is out of range' })
  .refine((v) => {
    const parts = Math.abs(v).toString().split('.')
    return parts.length === 1 || parts[1].length <= 2
  }, { message: 'must have at most 2 decimal places' })

const positiveAmount = z.coerce
  .number()
  .refine((v) => Number.isFinite(v) && v > 0, { message: 'must be a positive number' })

// A positive integer id, or explicit null, or omitted. Coerces "5" → 5; rejects "abc", 1.5, -1.
const idField = z.union([z.null(), z.coerce.number().int().positive()]).optional()

const transactionCreateSchema = z.object({
  amount: amountField,
  type: z.enum(TX_TYPES),
  account_id: idField,
  transfer_account_id: idField,
  category_id: idField,
  amount_local: z.union([z.null(), positiveAmount]).optional(),
  exchange_rate: positiveAmount.optional(),
})

const transactionUpdateSchema = z.object({
  amount: amountField.optional(),
  type: z.enum(TX_TYPES).optional(),
  account_id: idField,
  transfer_account_id: idField,
  category_id: idField,
  amount_local: z.union([z.null(), positiveAmount]).optional(),
  exchange_rate: positiveAmount.optional(),
})

function check(schema: z.ZodType, body: unknown): void {
  const result = schema.safeParse(body)
  if (!result.success) {
    const detail = result.error.issues
      .map((i) => `${i.path.join('.') || 'body'}: ${i.message}`)
      .join('; ')
    throw new HttpError(400, `Invalid transaction: ${detail}`)
  }
}

/** Throws HttpError(400) if the create body has an invalid amount, type, or account/category id. */
export function validateTransactionCreate(body: unknown): void {
  check(transactionCreateSchema, body)
}

/** Throws HttpError(400) if the update body has an invalid amount, type, or account/category id. */
export function validateTransactionUpdate(body: unknown): void {
  check(transactionUpdateSchema, body)
}
