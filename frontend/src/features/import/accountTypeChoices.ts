/**
 * The types an import can make a new account as, as the Import page's chooser names them
 * (ImportMappingStep.tsx). Setup asks with the same choices for the accounts a YNAB Register file
 * names that start below zero (components/onboarding/FirstImport.tsx).
 */
export const IMPORT_ACCOUNT_TYPES = [
  { value: 'giro', label: 'Giro' },
  { value: 'savings', label: 'Savings' },
  { value: 'ib', label: 'Investment' },
  { value: 'cash', label: 'Cash' },
  { value: 'credit', label: 'Credit Card' },
] as const

export type ImportAccountType = (typeof IMPORT_ACCOUNT_TYPES)[number]['value']
