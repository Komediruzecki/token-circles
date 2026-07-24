export interface BillFormValues {
  name: string
  amount: string
  due_date: string
  category: string
  frequency: 'monthly' | 'weekly' | 'biweekly' | 'yearly'
  autopay: boolean
  type: 'bill' | 'subscription'
}

export interface BillMutationPayload {
  name: string
  amount: number
  dueDate: string
  category_id?: number
  frequency: BillFormValues['frequency']
  autopay: boolean
  type: BillFormValues['type']
}

export function buildBillMutationPayload(values: BillFormValues): BillMutationPayload {
  return {
    name: values.name,
    amount: Number.parseFloat(values.amount),
    dueDate: values.due_date,
    category_id: values.category ? Number.parseInt(values.category, 10) : undefined,
    frequency: values.frequency,
    autopay: values.autopay,
    type: values.type,
  }
}
