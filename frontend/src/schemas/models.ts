import { z } from 'zod'

export const ProfileSchema = z.object({
  id: z.number(),
  name: z.string(),
  created_at: z.string(),
})

export const CategorySchema = z.object({
  id: z.number(),
  name: z.string(),
  color: z.string(),
  icon: z.string(),
  // 'account' is used by the importer for Means-of-Payment / transfer-target rows; accept it so
  // the whole /categories list never fails validation on a single odd type.
  type: z.enum(['income', 'expense', 'transfer', 'account']),
  parent_id: z.number().nullable(),
  tax_deductible: z.boolean().or(z.number().transform((n) => !!n)),
  created_at: z.string(),
  profile_id: z.number(),
  parent_name: z.string().nullable().optional(),
})

export const AccountSchema = z.object({
  id: z.number(),
  name: z.string(),
  bank_name: z.string().optional().nullable(),
  type: z.enum(['giro', 'savings', 'ib', 'cash']),
  currency: z.string(),
  balance: z.number(),
  notes: z.string().optional().nullable(),
  profile_id: z.number(),
  starting_balance: z.number().optional().nullable(),
  starting_date: z.string().optional().nullable(),
})

export const TransactionSchema = z.object({
  id: z.number(),
  description: z.string(),
  amount: z.number(),
  date: z.string(),
  beneficiary: z.string(),
  payor: z.string(),
  category_id: z.number().nullable(),
  currency: z.string(),
  amount_local: z.number().nullable(),
  exchange_rate: z.number(),
  // Backend also supports 'deduction' (see backend validators); accept it so the
  // transactions list doesn't hard-fail zod parsing on such rows. Currency is a
  // free-form TEXT column (imports/restores can hold any code), hence z.string().
  type: z.enum(['income', 'expense', 'transfer', 'deduction']),
  notes: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  profile_id: z.number(),
  account_id: z.number().nullable().optional(),
  transfer_account_id: z.number().nullable().optional(),
  category_name: z.string().optional().nullable(),
  category_color: z.string().optional().nullable(),
  reconciled: z
    .boolean()
    .or(z.number().transform((n) => !!n))
    .optional(),
  means_of_payment: z.string().optional().nullable(),
  tags: z.array(z.object({ id: z.number(), name: z.string(), color: z.string() })).optional(),
  receipt_id: z.number().nullable().optional(),
  receipt_name: z.string().optional().nullable(),
})

export const BudgetSchema = z.object({
  id: z.number(),
  category_id: z.number(),
  amount: z.number(),
  period: z.enum(['monthly', 'weekly', 'yearly']),
  start_date: z.string(),
  end_date: z.string().nullable(),
  created_at: z.string(),
  profile_id: z.number(),
})

export const SavingsGoalSchema = z.object({
  id: z.number(),
  name: z.string(),
  target_amount: z.number(),
  current_amount: z.number(),
  deadline: z.string().nullable(),
  notes: z.string().optional().nullable(),
  created_at: z.string(),
  profile_id: z.number(),
})

export const LoanSchema = z.object({
  id: z.number(),
  name: z.string(),
  principal: z.number(),
  interest_rate: z.number(),
  start_date: z.string(),
  term_months: z.number(),
  created_at: z.string(),
  profile_id: z.number(),
})

export const BillSchema = z.object({
  id: z.number(),
  name: z.string(),
  amount: z.number(),
  due_date: z.string(),
  category_id: z.number().nullable(),
  recurring: z.boolean().or(z.number().transform((n) => !!n)),
  last_paid_date: z.string().nullable(),
  next_due_date: z.string().nullable(),
  profile_id: z.number(),
})

export const SettingsSchema = z.record(z.string(), z.unknown())

// Helper for generic fallback: z.any() but typecasted to generic
export const GenericSchema = z.any()
