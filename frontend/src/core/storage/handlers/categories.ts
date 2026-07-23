/**
 * Categories handlers — IndexedDB-backed implementations
 */
import { getDB } from '../idb'
import {
  adapter,
  currentProfileOwns,
  currentProfileRecord,
  idParam,
  json,
  notFound,
  ok,
} from './helpers'
import { normalizeCategory } from './normalize'

export async function categoriesList(query: URLSearchParams): Promise<Response> {
  const type = query.get('type') as 'income' | 'expense' | undefined
  const cats = await adapter.listCategories(type)
  return json(cats.map(normalizeCategory))
}

export async function categoriesCreate(body: unknown): Promise<Response> {
  if (!body || typeof body !== 'object') return json({ error: 'Invalid category data' }, 400)
  const cat = body as Record<string, unknown>
  const name = ((cat.name as string) || '').trim()
  if (!name) return json({ error: 'Category name is required' }, 400)

  const pid = await adapter.getCurrentProfileId()
  cat.profile_id = pid
  if (!(await currentProfileOwns('categories', cat.parent_id ?? cat.parentId))) {
    return json({ error: 'Parent category does not belong to this profile' }, 400)
  }

  // Check for duplicate name within the same profile
  const db = await getDB()
  const existing = await db.getAllFromIndex('categories', 'by_profile', pid)
  if (existing.some((c) => (c.name as string).toLowerCase().trim() === name.toLowerCase())) {
    return json({ error: 'Category name already exists for this profile' }, 400)
  }

  const id = await adapter.createCategory(
    cat as unknown as Parameters<typeof adapter.createCategory>[0]
  )
  return json({ id, ...cat }, 201)
}

export async function categoriesGet(params: Record<string, string>): Promise<Response> {
  const cat = await currentProfileRecord('categories', idParam(params))
  if (!cat) return notFound('Category')
  return json(cat)
}

export async function categoriesUpdate(
  params: Record<string, string>,
  body: unknown
): Promise<Response> {
  if (!body || typeof body !== 'object') return json({ error: 'Invalid data' }, 400)
  const id = idParam(params)
  if (!(await currentProfileRecord('categories', id))) return notFound('Category')
  const patch = body as Record<string, unknown>
  if (
    ('parent_id' in patch || 'parentId' in patch) &&
    !(await currentProfileOwns('categories', patch.parent_id ?? patch.parentId))
  ) {
    return json({ error: 'Parent category does not belong to this profile' }, 400)
  }
  await adapter.updateCategory(id, patch)
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
