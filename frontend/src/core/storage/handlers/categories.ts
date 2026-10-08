/**
 * Categories handlers — IndexedDB-backed implementations
 */
import {
  CATEGORY_MESSAGES,
  categoryNameTaken,
  checkCategoryCreate,
  checkCategoryEdit,
  clashingCategoryName,
  renamesCategory,
} from '../../../../../shared/categorySchema'
import { getDB } from '../idb'
import {
  adapter,
  currentProfileOwns,
  currentProfileRecord,
  idParam,
  json,
  notFound,
  ok,
  refuse,
} from './helpers'
import { normalizeCategory } from './normalize'

export async function categoriesList(query: URLSearchParams): Promise<Response> {
  const type = query.get('type') as 'income' | 'expense' | undefined
  const cats = await adapter.listCategories(type)
  return json(cats.map(normalizeCategory))
}

export async function categoriesCreate(body: unknown): Promise<Response> {
  // The Worker's rules and words (shared/categorySchema.ts). The router has already run this
  // check on the way in; a direct call (tests, other handlers) gets the same answer.
  const checked = checkCategoryCreate(body)
  if (!checked.ok) return refuse(checked.fields)
  const input = checked.value

  const pid = await adapter.getCurrentProfileId()
  // A parent from another profile is refused at that field, as the Worker refuses it.
  if (!(await currentProfileOwns('categories', input.parent_id))) {
    return refuse({ parent_id: CATEGORY_MESSAGES.parent })
  }

  const db = await getDB()
  const existing = await db.getAllFromIndex('categories', 'by_profile', pid)
  const clash = clashingCategoryName(existing as { id: unknown; name: unknown }[], input.name)
  if (clash !== null) return refuse(categoryNameTaken(clash))

  // The row the Worker stores, not the body as it came: the check filled in every default, so no
  // row can miss a field CategorySchema needs on the next typed read.
  const row = { ...input, created_at: new Date().toISOString(), profile_id: pid }
  const id = await adapter.createCategory(
    row as unknown as Parameters<typeof adapter.createCategory>[0]
  )
  return json({ id, ...row }, 201)
}

export async function categoriesGet(params: Record<string, string>): Promise<Response> {
  const cat = await currentProfileRecord('categories', idParam(params))
  if (!cat) return notFound('Category')
  return json(normalizeCategory(cat))
}

export async function categoriesUpdate(
  params: Record<string, string>,
  body: unknown
): Promise<Response> {
  const id = idParam(params)
  const current = await currentProfileRecord('categories', id)
  if (!current) return notFound('Category')
  // Only the category fields the body changes, checked as the Worker checks them. A field it
  // leaves out keeps its value, and so does one it sends back unchanged: that one is not checked
  // either, so a row saved under older rules (a 3-digit color, a long name) can still be edited.
  // Keys that are not category fields are not written into the row.
  const checked = checkCategoryEdit(body, current)
  if (!checked.ok) {
    // The router logs this for every body its checks refuse, and the release suite fails a
    // local-first run that shows one (tests/release/release-fixtures.ts). An edit is checked here,
    // against the stored row, so it is said here.
    console.error('[categoriesUpdate] Validation failed', { id, body, fields: checked.fields })
    return refuse(checked.fields)
  }
  const patch = checked.value
  if (patch.parent_id !== undefined && !(await currentProfileOwns('categories', patch.parent_id))) {
    return refuse({ parent_id: CATEGORY_MESSAGES.parent })
  }
  // A rename may not land on another category's name. A name the edit leaves alone, or changes
  // in case only, is not checked.
  if (patch.name !== undefined && renamesCategory(current.name, patch.name)) {
    const db = await getDB()
    const others = await db.getAllFromIndex('categories', 'by_profile', current.profile_id)
    const clash = clashingCategoryName(others as { id: unknown; name: unknown }[], patch.name, id)
    if (clash !== null) return refuse(categoryNameTaken(clash))
  }
  if (Object.keys(patch).length > 0) {
    await adapter.updateCategory(id, patch as Parameters<typeof adapter.updateCategory>[1])
  }
  return ok()
}

export async function categoriesDelete(params: Record<string, string>): Promise<Response> {
  const id = idParam(params)
  if (!(await currentProfileRecord('categories', id))) return notFound('Category')
  await adapter.deleteCategory(id)
  return ok()
}

export async function categoriesAutoMap(body: unknown): Promise<Response> {
  try {
    const db = await getDB()
    const pid = await adapter.getCurrentProfileId()
    const data = body as Record<string, unknown>
    const transactionIds = data.transaction_ids as number[] | undefined

    const categories = await db.getAllFromIndex('categories', 'by_profile', pid)
    const catMap = new Map<string, Record<string, unknown>>()
    for (const c of categories as Record<string, unknown>[]) {
      catMap.set((c.name as string).toLowerCase(), c)
    }

    const mappingPatterns: { pattern: string; categoryId: number }[] = []
    try {
      const rawMappings = await db.getAll('categoryMappings')
      for (const m of rawMappings as Record<string, unknown>[]) {
        if (m.profile_id === pid) {
          mappingPatterns.push({
            pattern: (m.pattern as string).toLowerCase(),
            categoryId: m.category_id as number,
          })
        }
      }
    } catch {
      // categoryMappings store may not exist yet
    }

    let txns: Record<string, unknown>[]
    if (transactionIds && transactionIds.length > 0) {
      txns = []
      for (const id of transactionIds) {
        const t = await db.get('transactions', id)
        if (t && t.profile_id === pid) txns.push(t)
      }
    } else {
      const all = await db.getAllFromIndex('transactions', 'by_profile', pid)
      txns = (all as Record<string, unknown>[]).filter((t) => !t.category_id || t.category_id === 0)
    }

    let mapped = 0
    for (const tx of txns) {
      const toStr = (v: unknown) => (typeof v === 'string' ? v : '')
      const searchText =
        `${toStr(tx.description)} ${toStr(tx.beneficiary)} ${toStr(tx.payor)}`.toLowerCase()
      const normalized = searchText.replace(/[^a-z0-9]/g, '')

      let bestCategoryId: number | null = null
      for (const mp of mappingPatterns) {
        if (normalized.includes(mp.pattern.replace(/[^a-z0-9]/g, ''))) {
          bestCategoryId = mp.categoryId
          break
        }
      }

      if (bestCategoryId === null) {
        const incomeKeywords = [
          'salary',
          'wage',
          'income',
          'revenue',
          'refund',
          'dividend',
          'interest',
          'bonus',
          'freelance',
          'deposit',
          'paycheck',
        ]
        const accountKeywords = [
          'revolut',
          'rev',
          'n26',
          'wise',
          'paypal',
          'pbz',
          'current',
          'giro',
          'savings',
          'wallet',
          'transfer',
          'wire',
        ]
        const expenseKeywords = [
          'groceries',
          'restaurant',
          'rent',
          'utility',
          'insurance',
          'health',
          'transport',
          'shopping',
          'entertainment',
          'subscription',
          'phone',
          'internet',
          'electric',
          'water',
          'gas',
          'gym',
          'travel',
          'education',
          'medical',
          'dental',
          'pharmacy',
          'clothing',
          'charity',
          'gift',
          'tax',
          'fee',
          'bank fee',
          'maintenance',
          'repair',
          'fuel',
          'parking',
          'toll',
          'hotel',
          'flight',
          'coffee',
          'food',
          'drink',
        ]

        for (const kw of incomeKeywords) {
          if (normalized.includes(kw)) {
            bestCategoryId = (catMap.get('income') || catMap.get('salary'))?.id as number
            break
          }
        }
        if (bestCategoryId === null) {
          for (const kw of accountKeywords) {
            if (normalized.includes(kw)) {
              bestCategoryId = (catMap.get('transfer') || catMap.get('account transfer'))
                ?.id as number
              break
            }
          }
        }
        if (bestCategoryId === null) {
          for (const kw of expenseKeywords) {
            if (normalized.includes(kw)) {
              bestCategoryId = catMap.get('other')?.id as number
              break
            }
          }
        }
      }

      if (bestCategoryId !== null) {
        await db.put('transactions', { ...tx, category_id: bestCategoryId })
        mapped++
      }
    }

    return json({ ok: true, mapped })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
}

export async function categoriesApplyMappings(body: unknown): Promise<Response> {
  try {
    const db = await getDB()
    const pid = await adapter.getCurrentProfileId()
    const data = body as Record<string, unknown>
    const mappingIds = data.mapping_ids as number[] | undefined
    const applyTo = (data.apply_to || 'uncategorized') as string

    const patterns: { pattern: string; categoryId: number }[] = []
    if (mappingIds && mappingIds.length > 0) {
      try {
        const allMappings = await db.getAll('categoryMappings')
        for (const m of allMappings as Record<string, unknown>[]) {
          if (m.profile_id === pid && mappingIds.includes(m.id as number)) {
            patterns.push({
              pattern: (m.pattern as string).toLowerCase(),
              categoryId: m.category_id as number,
            })
          }
        }
      } catch {
        /* store may not exist */
      }
    }

    const allTxns = await db.getAllFromIndex('transactions', 'by_profile', pid)
    const targets = (allTxns as Record<string, unknown>[]).filter((t) => {
      if (applyTo === 'all') return true
      return !t.category_id || t.category_id === 0
    })

    let applied = 0
    for (const tx of targets) {
      const toStr = (v: unknown) => (typeof v === 'string' ? v : '')
      const searchText =
        `${toStr(tx.description)} ${toStr(tx.beneficiary)} ${toStr(tx.payor)}`.toLowerCase()
      const normalized = searchText.replace(/[^a-z0-9]/g, '')
      for (const mp of patterns) {
        if (normalized.includes(mp.pattern.replace(/[^a-z0-9]/g, ''))) {
          await db.put('transactions', { ...tx, category_id: mp.categoryId })
          applied++
          break
        }
      }
    }

    return json({ ok: true, applied })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
}
