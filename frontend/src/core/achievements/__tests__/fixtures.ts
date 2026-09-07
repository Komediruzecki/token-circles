import type { EvaluateInput } from '../evaluate'

type Tx = EvaluateInput['transactions'][number]

let seq = 0
export function tx(date: string, over: Partial<Tx> = {}): Tx {
  seq++
  return { date, type: 'expense', amount: 10 + seq, category_id: 1, ...over }
}

/** `n` expenses spread over a month, categorised, day 3 onwards. */
export function month(m: string, n = 3, over: Partial<Tx> = {}): Tx[] {
  return Array.from({ length: n }, (_, i) => tx(`${m}-${String(3 + i).padStart(2, '0')}`, over))
}

/** `count` tracked months ending at `endMonth` (inclusive), each with `n` expenses. */
export function trackedRun(endMonth: string, count: number, n = 3): Tx[] {
  const [y, mo] = endMonth.split('-').map(Number)
  const out: Tx[] = []
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, mo - 1 - i, 1))
    out.push(...month(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`, n))
  }
  return out
}

export function input(over: Partial<EvaluateInput> = {}): EvaluateInput {
  return {
    transactions: [],
    budgets: [],
    goals: [],
    importLogs: [],
    loans: [],
    selfHosted: false,
    today: '2026-09-07',
    ...over,
  }
}

/** The advice engine takes the evaluator's input plus names and dismissals. */
export function adviceInput(over: Record<string, unknown> = {}) {
  return {
    ...input(),
    categories: [
      { id: 1, name: 'Food' },
      { id: 2, name: 'Transport' },
    ],
    bills: [],
    dismissed: [] as string[],
    ...over,
  } as never
}
