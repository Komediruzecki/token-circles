export interface BillFormValues {
  name: string
  amount: string
  due_date: string
  /** The category's id, or blank for none. */
  category: string
  frequency: 'monthly' | 'weekly' | 'biweekly' | 'yearly'
  autopay: boolean
  type: 'bill' | 'subscription'
}

export interface BillMutationPayload {
  name: string
  amount: number
  dueDate: string
  /** Null takes the category off: blank in the dialog is no category. */
  category_id: number | null
  frequency: BillFormValues['frequency']
  autopay: boolean
  type: BillFormValues['type']
}

export function buildBillMutationPayload(values: BillFormValues): BillMutationPayload {
  return {
    name: values.name,
    amount: Number.parseFloat(values.amount),
    dueDate: values.due_date,
    category_id: values.category ? Number.parseInt(values.category, 10) : null,
    frequency: values.frequency,
    autopay: values.autopay,
    type: values.type,
  }
}
