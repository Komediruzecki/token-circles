/**
 * Zod validation schemas for Finance Manager API.
 * Each schema exports schemas for create, update, and query operations.
 */

const { z } = require('zod');

// ---- SHARED HELPERS ----

const currencyEnum = z.enum(['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY']);
const transactionTypeEnum = z.enum(['income', 'expense', 'transfer', 'deduction']);
const accountTypeEnum = z.enum(['giro', 'savings', 'ib', 'cash']);
const budgetPeriodEnum = z.enum(['monthly', 'weekly', 'yearly']);
const frequencyEnum = z.enum(['daily', 'weekly', 'monthly', 'yearly']);

const positiveFloat = z.number().positive().finite();
const nonNegativeFloat = z.number().min(0).finite();
const trimmedString = z.string().trim();
const nonEmptyString = trimmedString.min(1);
const isoDateString = trimmedString.regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD format');
const validId = z.number().int().positive().finite();

// ---- TRANSACTIONS ----

const transactionCreateSchema = z.object({
  description: nonEmptyString.max(500),
  amount: z.number().finite().refine(val => {
    const parts = Math.abs(val).toString().split('.');
    return parts.length === 1 || parts[1].length <= 2;
  }, { message: "Amount must have at most 2 decimal places" }),
  date: isoDateString.optional(),
  type: transactionTypeEnum,
  category_id: validId.nullable().optional(),
  account_id: validId.nullable().optional(),
  transfer_account_id: validId.nullable().optional(),
  currency: currencyEnum.optional().default('USD'),
  amount_local: positiveFloat.nullable().optional(),
  exchange_rate: positiveFloat.optional().default(1),
  beneficiary: trimmedString.max(200).optional().default(''),
  payor: trimmedString.max(200).optional().default(''),
  notes: trimmedString.max(2000).optional().default(''),
  reconciled: z.boolean().optional().default(false),
  means_of_payment: trimmedString.max(100).optional().default(''),
  tags: z
    .array(z.object({ id: validId, name: nonEmptyString, color: trimmedString }))
    .optional()
    .default([]),
});

const transactionUpdateSchema = z.object({
  description: nonEmptyString.max(500).optional(),
  amount: z.number().finite().refine(val => {
    const parts = Math.abs(val).toString().split('.');
    return parts.length === 1 || parts[1].length <= 2;
  }, { message: "Amount must have at most 2 decimal places" }).optional(),
  date: isoDateString.optional(),
  type: transactionTypeEnum.optional(),
  category_id: validId.nullable().optional(),
  account_id: validId.nullable().optional(),
  transfer_account_id: validId.nullable().optional(),
  currency: currencyEnum.optional(),
  amount_local: positiveFloat.nullable().optional(),
  exchange_rate: positiveFloat.optional(),
  beneficiary: trimmedString.max(200).optional(),
  payor: trimmedString.max(200).optional(),
  notes: trimmedString.max(2000).optional(),
  reconciled: z.boolean().optional(),
  means_of_payment: trimmedString.max(100).optional(),
});

const transactionQuerySchema = z.object({
  page: z
    .string()
    .regex(/^\d+$/, 'Page must be a positive integer')
    .optional()
    .default('1'),
  perPage: z
    .string()
    .regex(/^\d+$/)
    .optional()
    .default('50'),
  limit: z
    .string()
    .regex(/^\d+$/)
    .optional(),
  offset: z
    .string()
    .regex(/^\d+$/)
    .optional(),
  sort: trimmedString.optional(),
  order: z.enum(['asc', 'desc']).optional().default('desc'),
  type: transactionTypeEnum.optional(),
  category_id: z
    .string()
    .regex(/^\d+$/)
    .optional(),
  category_ids: trimmedString.optional(),
  search: trimmedString.max(200).optional(),
  reconciled: z
    .string()
    .regex(/^(true|false|0|1|all)$/i)
    .optional(),
  tag_ids: trimmedString.optional(),
  startDate: isoDateString.optional(),
  endDate: isoDateString.optional(),
});

const bulkDeleteSchema = z.object({
  ids: z.array(validId).min(1).max(1000),
});

const bulkUpdateCategorySchema = z.object({
  ids: z.array(validId).min(1).max(1000),
  category_id: validId.nullable(),
});

const bulkReconcileSchema = z.object({
  ids: z.array(validId).min(1).max(1000),
  reconciled: z.boolean(),
});

// ---- AUTH ----

const loginSchema = z.object({
  username: nonEmptyString.max(100),
  password: z.string().min(1),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z
    .string()
    .min(12, 'Password must be at least 12 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/\d/, 'Password must contain at least one number')
    .regex(/[^A-Za-z0-9]/, 'Password must contain at least one special character'),
});

// ---- CATEGORIES ----

const categoryCreateSchema = z.object({
  name: nonEmptyString.max(100),
  type: transactionTypeEnum,
  color: trimmedString.regex(/^#[0-9A-Fa-f]{6}$/, 'Must be a hex color like #FF0000'),
  icon: trimmedString.max(50).optional().default('default-icon'),
  parent_id: validId.nullable().optional(),
  tax_deductible: z.boolean().optional().default(false),
});

const categoryUpdateSchema = z.object({
  name: nonEmptyString.max(100).optional(),
  type: transactionTypeEnum.optional(),
  color: trimmedString
    .regex(/^#[0-9A-Fa-f]{6}$/, 'Must be a hex color like #FF0000')
    .optional(),
  icon: trimmedString.max(50).optional(),
  parent_id: validId.nullable().optional(),
  tax_deductible: z.boolean().optional(),
});

// ---- ACCOUNTS ----

const accountCreateSchema = z.object({
  name: nonEmptyString.max(200),
  bank_name: trimmedString.max(200).optional().default(''),
  type: accountTypeEnum.optional().default('giro'),
  currency: currencyEnum.optional().default('USD'),
  balance: nonNegativeFloat.optional().default(0),
  notes: trimmedString.max(1000).optional().default(''),
  starting_balance: z.number().optional(),
  starting_date: isoDateString.nullable().optional(),
});

const accountUpdateSchema = z.object({
  name: nonEmptyString.max(200).optional(),
  bank_name: trimmedString.max(200).optional(),
  type: accountTypeEnum.optional(),
  currency: currencyEnum.optional(),
  balance: z.number().optional(),
  notes: trimmedString.max(1000).optional(),
  starting_balance: z.number().nullable().optional(),
  starting_date: isoDateString.nullable().optional(),
});

// ---- BUDGETS ----

const budgetCreateSchema = z.object({
  category_id: validId,
  amount: positiveFloat,
  period: budgetPeriodEnum.optional().default('monthly'),
  start_date: isoDateString,
  end_date: isoDateString.nullable().optional(),
});

const budgetUpdateSchema = z.object({
  amount: positiveFloat.optional(),
  period: budgetPeriodEnum.optional(),
  start_date: isoDateString.optional(),
  end_date: isoDateString.nullable().optional(),
});

// ---- SAVINGS GOALS ----

const savingsGoalCreateSchema = z.object({
  name: nonEmptyString.max(200),
  target_amount: positiveFloat,
  current_amount: nonNegativeFloat.optional().default(0),
  deadline: isoDateString.nullable().optional(),
  notes: trimmedString.max(1000).optional().default(''),
});

const savingsGoalUpdateSchema = z.object({
  name: nonEmptyString.max(200).optional(),
  target_amount: positiveFloat.optional(),
  current_amount: nonNegativeFloat.optional(),
  deadline: isoDateString.nullable().optional(),
  notes: trimmedString.max(1000).optional(),
});

// ---- LOANS ----

const loanCreateSchema = z.object({
  name: nonEmptyString.max(200),
  principal: positiveFloat,
  interest_rate: nonNegativeFloat,
  start_date: isoDateString,
  term_months: validId,
  rate_periods: z
    .array(
      z.object({
        rate: nonNegativeFloat,
        start_month: validId,
        end_month: validId.nullable().optional(),
      })
    )
    .optional()
    .default([]),
});

const loanUpdateSchema = z.object({
  name: nonEmptyString.max(200).optional(),
  principal: positiveFloat.optional(),
  interest_rate: nonNegativeFloat.optional(),
  start_date: isoDateString.optional(),
  term_months: validId.optional(),
});

const loanPrepaymentSchema = z.object({
  month: validId,
  amount: positiveFloat,
  note: trimmedString.max(500).optional().default(''),
});

// ---- BILLS ----

const billCreateSchema = z.object({
  name: nonEmptyString.max(200),
  amount: positiveFloat,
  due_date: isoDateString,
  category_id: validId.nullable().optional(),
  recurring: z.boolean().optional().default(false),
  next_due_date: isoDateString.nullable().optional(),
});

const billUpdateSchema = z.object({
  name: nonEmptyString.max(200).optional(),
  amount: positiveFloat.optional(),
  due_date: isoDateString.optional(),
  category_id: validId.nullable().optional(),
  recurring: z.boolean().optional(),
  last_paid_date: isoDateString.nullable().optional(),
  next_due_date: isoDateString.nullable().optional(),
});

// ---- RECURRING TRANSACTIONS ----

const recurringCreateSchema = z.object({
  description: nonEmptyString.max(500),
  amount: positiveFloat,
  type: transactionTypeEnum,
  frequency: frequencyEnum,
  next_date: isoDateString.nullable().optional(),
  category_id: validId.nullable().optional(),
  day_of_month: z.number().int().min(1).max(31).nullable().optional(),
  notes: trimmedString.max(1000).optional().default(''),
});

const recurringUpdateSchema = z.object({
  description: nonEmptyString.max(500).optional(),
  amount: positiveFloat.optional(),
  type: transactionTypeEnum.optional(),
  frequency: frequencyEnum.optional(),
  next_date: isoDateString.nullable().optional(),
  category_id: validId.nullable().optional(),
  day_of_month: z.number().int().min(1).max(31).nullable().optional(),
  notes: trimmedString.max(1000).optional(),
});

// ---- TAGS ----

const tagCreateSchema = z.object({
  name: nonEmptyString.max(100),
  color: trimmedString.regex(/^#[0-9A-Fa-f]{6}$/, 'Must be a hex color like #FF0000').optional().default('#6B7280'),
});

const tagUpdateSchema = z.object({
  name: nonEmptyString.max(100).optional(),
  color: trimmedString.regex(/^#[0-9A-Fa-f]{6}$/).optional(),
});

// ---- SETTINGS ----

const notificationSettingsSchema = z.object({
  email: z.string().email().max(200).optional().default(''),
  emailNotifications: z.boolean().optional().default(false),
  budgetAlerts: z.boolean().optional().default(false),
  billsReminders: z.boolean().optional().default(false),
  spendingReport: z.boolean().optional().default(false),
});

const profileCreateSchema = z.object({
  name: nonEmptyString.max(200),
});

const profileRenameSchema = z.object({
  name: nonEmptyString.max(200),
});

// ---- IMPORT ----

const importConfigSchema = z.object({
  fileId: nonEmptyString,
  sheetName: trimmedString.optional().default(''),
  mappings: z.record(z.string()),
  skipRows: z.number().int().min(0).optional().default(0),
  currency: currencyEnum.optional().default('USD'),
  account_id: validId.nullable().optional(),
});

module.exports = {
  // Transactions
  transactionCreateSchema,
  transactionUpdateSchema,
  transactionQuerySchema,
  bulkDeleteSchema,
  bulkUpdateCategorySchema,
  bulkReconcileSchema,
  // Auth
  loginSchema,
  changePasswordSchema,
  // Categories
  categoryCreateSchema,
  categoryUpdateSchema,
  // Accounts
  accountCreateSchema,
  accountUpdateSchema,
  // Budgets
  budgetCreateSchema,
  budgetUpdateSchema,
  // Savings Goals
  savingsGoalCreateSchema,
  savingsGoalUpdateSchema,
  // Loans
  loanCreateSchema,
  loanUpdateSchema,
  loanPrepaymentSchema,
  // Bills
  billCreateSchema,
  billUpdateSchema,
  // Recurring
  recurringCreateSchema,
  recurringUpdateSchema,
  // Tags
  tagCreateSchema,
  tagUpdateSchema,
  // Settings
  notificationSettingsSchema,
  // Profiles
  profileCreateSchema,
  profileRenameSchema,
  // Import
  importConfigSchema,
  // Shared
  validId,
};
