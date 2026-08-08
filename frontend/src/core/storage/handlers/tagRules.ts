/**
 * Tag rules handlers — IndexedDB-backed implementations.
 *
 * Mirrors worker/src/routes/tags.ts (rules CRUD, preview, apply-to-existing, summaries).
 * Matching semantics come from shared/tagRules.ts, which both runtimes import, so a rule that
 * matches in the cloud matches identically in local-first mode.
 *
 * Scoping: every endpoint here uses the ACTIVE write profile (not the household selection), which
 * is what the Worker does — a tag rule writes data, so it must land in exactly one profile.
 */
import {
  normalizeTagRuleCriteria,
  TAG_RULE_SCAN_LIMIT,
  tagRuleScanNarrowing,
  transactionMatchesTagRule,
} from '../../../../../shared/tagRules'
import { getDB } from '../idb'
import { adapter, currentProfileRecord, getAmount, idParam, json, notFound, ok } from './helpers'
import type { TagRuleCriteria } from '../../../../../shared/tagRules'

interface TagRuleRecord {
  id: number
  profile_id: number
  tag_id: number
  name: string
  criteria: TagRuleCriteria
  auto_apply: boolean
  created_at: string
}

type Row = Record<string, any>

function parseRule(row: Row): TagRuleRecord {
  return {
    id: row.id as number,
    profile_id: row.profile_id as number,
    tag_id: row.tag_id as number,
    name: (row.name as string) ?? '',
    criteria: normalizeTagRuleCriteria(row.criteria),
    auto_apply: row.auto_apply !== false && row.auto_apply !== 0,
    created_at: (row.created_at as string) ?? '',
  }
}

/** All rules for the active profile, optionally narrowed to one tag. */
export async function loadTagRules(
  profileId: number,
  opts: { tagId?: number; autoApplyOnly?: boolean } = {}
): Promise<TagRuleRecord[]> {
  const db = await getDB()
  if (!db.objectStoreNames.contains('tagRules')) return []
  const rows = (await db.getAllFromIndex('tagRules', 'by_profile', profileId)) as Row[]
  return rows
    .map(parseRule)
    .filter((rule) => (opts.tagId === undefined ? true : rule.tag_id === opts.tagId))
    .filter((rule) => (opts.autoApplyOnly ? rule.auto_apply : true))
    .sort((a, b) => a.id - b.id)
}

export async function tagRulesList(): Promise<Response> {
  const pid = await adapter.getCurrentProfileId()
  return json(await loadTagRules(pid))
}

/** Validate + normalize a rule body. Returns null when the referenced tag isn't owned. */
async function readRuleBody(
  body: unknown,
  profileId: number,
  requireTag: boolean
): Promise<
  | { ok: true; tagId?: number; name: string; criteria: TagRuleCriteria; autoApply: boolean }
  | { ok: false; response: Response }
> {
  const b = (body && typeof body === 'object' ? body : {}) as Row
  const criteria = normalizeTagRuleCriteria(b.criteria)
  const name = typeof b.name === 'string' ? b.name.trim().slice(0, 120) : ''
  const autoApply = b.auto_apply !== false && b.auto_apply !== 0

  let tagId: number | undefined
  if (b.tag_id !== undefined || requireTag) {
    const parsed = Number(b.tag_id)
    if (!Number.isInteger(parsed) || parsed <= 0) {
      return { ok: false, response: json({ error: 'tag_id is required' }, 400) }
    }
    // Ownership check — a rule must never point at another profile's tag.
    if (!(await currentProfileRecord('tags', parsed, profileId))) {
      return { ok: false, response: notFound('Tag') }
    }
    tagId = parsed
  }
  return { ok: true, tagId, name, criteria, autoApply }
}

export async function tagRulesCreate(body: unknown): Promise<Response> {
  const pid = await adapter.getCurrentProfileId()
  const parsed = await readRuleBody(body, pid, true)
  if (!parsed.ok) return parsed.response
  const db = await getDB()
  const record = {
    profile_id: pid,
    tag_id: parsed.tagId as number,
    name: parsed.name,
    criteria: parsed.criteria,
    auto_apply: parsed.autoApply,
    created_at: new Date().toISOString(),
  }
  const id = (await db.add('tagRules', record)) as number
  return json({ ...record, id }, 201)
}

export async function tagRulesUpdate(
  params: Record<string, string>,
  body: unknown
): Promise<Response> {
  const pid = await adapter.getCurrentProfileId()
  const existing = await currentProfileRecord('tagRules', idParam(params), pid)
  if (!existing) return notFound('Rule')
  const parsed = await readRuleBody(body, pid, false)
  if (!parsed.ok) return parsed.response
  const db = await getDB()
  const updated = {
    ...existing,
    name: parsed.name,
    criteria: parsed.criteria,
    auto_apply: parsed.autoApply,
    ...(parsed.tagId !== undefined ? { tag_id: parsed.tagId } : {}),
  }
  await db.put('tagRules', updated)
  // Match the Worker (PUT /api/tags/rules/:ruleId → { ok: true }) and the client type
  // (api.ts updateTagRule: Promise<{ ok: boolean }>), so a future result.ok check can't read
  // undefined in local mode only.
  return ok()
}

export async function tagRulesDelete(params: Record<string, string>): Promise<Response> {
  const pid = await adapter.getCurrentProfileId()
  const existing = await currentProfileRecord('tagRules', idParam(params), pid)
  if (!existing) return notFound('Rule')
  const db = await getDB()
  await db.delete('tagRules', idParam(params))
  return ok()
}

interface MatchResult {
  /** Rows matching at least one criteria set (within the scanned window). */
  matched: Row[]
  /** Rows examined — equals TAG_RULE_SCAN_LIMIT when the scan was truncated. */
  scanned: number
  /** True when the ledger exceeds the scan cap, so results may be incomplete. */
  truncated: boolean
}

/**
 * Every transaction in the active profile matching at least one criteria set.
 *
 * Mirrors the Worker's bounded scan (worker/src/tag-rules.ts) in both halves: narrow by the
 * structural conditions FIRST, then take the newest TAG_RULE_SCAN_LIMIT. Both halves matter — the
 * cap alone still let the two runtimes examine different windows, because the Worker's SQL WHERE
 * runs before its LIMIT. Get either wrong and, on a ledger past the cap, apply/preview tags a
 * different set of rows here than in the cloud.
 */
async function matchingTransactions(
  profileId: number,
  criteriaList: TagRuleCriteria[]
): Promise<MatchResult> {
  if (!criteriaList.length) return { matched: [], scanned: 0, truncated: false }
  const db = await getDB()
  const all = (await db.getAllFromIndex('transactions', 'by_profile', profileId)) as Row[]

  // Pre-filter by the same conditions the Worker pushes into SQL, using the shared definition so
  // the two can't drift. This runs BEFORE the cap, exactly like the Worker's WHERE ... LIMIT: a
  // date-bounded rule ("tag my 2023 company spend") must scan the 2023 window in both runtimes,
  // not the newest N rows overall — otherwise, on a ledger past the cap, the cloud would tag rows
  // the local runtime never looked at. Only a lone AND-rule narrows; several rules OR together.
  const narrowable = criteriaList.length === 1 ? tagRuleScanNarrowing(criteriaList[0]) : null
  const candidates = narrowable
    ? all.filter((row) => transactionMatchesTagRule(row, narrowable))
    : all

  // Sort newest-first (date DESC, id DESC) then cap — the same ORDER BY / LIMIT the Worker uses.
  const scan = candidates
    .slice()
    .sort((a, b) => {
      const da = String(a.date ?? '')
      const dbb = String(b.date ?? '')
      if (da !== dbb) return da < dbb ? 1 : -1
      return (Number(b.id) || 0) - (Number(a.id) || 0)
    })
    .slice(0, TAG_RULE_SCAN_LIMIT)
  const matched = scan.filter((row) =>
    criteriaList.some((criteria) => transactionMatchesTagRule(row, criteria))
  )
  return { matched, scanned: scan.length, truncated: scan.length >= TAG_RULE_SCAN_LIMIT }
}

/** Dry-run: how many existing transactions a criteria set would tag, plus a sample. */
export async function tagRulesPreview(body: unknown): Promise<Response> {
  const pid = await adapter.getCurrentProfileId()
  const b = (body && typeof body === 'object' ? body : {}) as Row
  const criteria = normalizeTagRuleCriteria(b.criteria)
  const { matched, scanned, truncated } = await matchingTransactions(pid, [criteria])

  const tagId = Number(b.tag_id)
  const hasTag = Number.isInteger(tagId) && tagId > 0
  const alreadyTagged = hasTag
    ? matched.filter((row) => ((row.tag_ids as number[]) ?? []).includes(tagId)).length
    : 0

  const sample = [...matched]
    .sort((a, b2) => String(b2.date ?? '').localeCompare(String(a.date ?? '')))
    .slice(0, 10)
    .map((row) => ({
      id: row.id,
      description: row.description,
      amount: row.amount,
      date: row.date,
      type: row.type,
    }))

  return json({
    matched: matched.length,
    already_tagged: alreadyTagged,
    new_matches: matched.length - alreadyTagged,
    scanned,
    truncated,
    sample,
  })
}

/** Attach `tagId` to each row, keeping the denormalized `tags` array in step with `tag_ids`. */
async function linkRowsToTag(rows: Row[], tagId: number, profileId: number): Promise<number> {
  if (!rows.length) return 0
  const db = await getDB()
  const tag = (await db.get('tags', tagId)) as Row | undefined
  if (!tag || tag.profile_id !== profileId) return 0
  let tagged = 0
  for (const row of rows) {
    const tagIds: number[] = Array.isArray(row.tag_ids) ? [...(row.tag_ids as number[])] : []
    if (tagIds.includes(tagId)) continue
    tagIds.push(tagId)
    const tags: Row[] = Array.isArray(row.tags) ? [...(row.tags as Row[])] : []
    tags.push({ id: tag.id, name: tag.name, color: tag.color })
    await db.put('transactions', { ...row, tag_ids: tagIds, tags })
    tagged++
  }
  return tagged
}

/** Detach `tagId` from each row, keeping the denormalized `tags` array in step with `tag_ids`. */
async function unlinkRowsFromTag(rows: Row[], tagId: number): Promise<number> {
  if (!rows.length) return 0
  const db = await getDB()
  let removed = 0
  for (const row of rows) {
    const tagIds: number[] = Array.isArray(row.tag_ids) ? (row.tag_ids as number[]) : []
    if (!tagIds.includes(tagId)) continue
    const nextIds = tagIds.filter((id) => id !== tagId)
    const tags: Row[] = Array.isArray(row.tags) ? (row.tags as Row[]) : []
    const nextTags = tags.filter((t) => t.id !== tagId)
    await db.put('transactions', { ...row, tag_ids: nextIds, tags: nextTags })
    removed++
  }
  return removed
}

/**
 * Apply a tag's rules to transactions that already exist. An explicit `criteria` in the body
 * applies an unsaved rule instead of the stored ones, so the page can offer "apply now" before
 * the rule is saved.
 */
export async function tagsApplyRules(
  params: Record<string, string>,
  body: unknown
): Promise<Response> {
  const pid = await adapter.getCurrentProfileId()
  const tagId = idParam(params)
  if (!(await currentProfileRecord('tags', tagId, pid))) return notFound('Tag')

  const b = (body && typeof body === 'object' ? body : {}) as Row
  const criteriaList =
    b.criteria !== undefined
      ? [normalizeTagRuleCriteria(b.criteria)]
      : (await loadTagRules(pid, { tagId })).map((rule) => rule.criteria)

  if (!criteriaList.length) {
    return json({ error: 'This tag has no rules to apply' }, 400)
  }

  const { matched, scanned, truncated } = await matchingTransactions(pid, criteriaList)
  const tagged = await linkRowsToTag(matched, tagId, pid)
  return json({ matched: matched.length, tagged, scanned, truncated })
}

/**
 * Bulk-tag an explicit set of transactions — the "Tag selected" action from the transactions page.
 * Additive: mode 'add' attaches this tag on top of a row's existing tags (idempotent), mode
 * 'remove' detaches only this tag. Scoped to the active profile: both the tag and every affected
 * row must belong to it, mirroring the Worker's ownership filter so a client-supplied id list can't
 * reach another profile's data.
 */
export async function tagsBulkTagTransactions(
  params: Record<string, string>,
  body: unknown
): Promise<Response> {
  const pid = await adapter.getCurrentProfileId()
  const tagId = idParam(params)
  if (!(await currentProfileRecord('tags', tagId, pid))) return notFound('Tag')

  const b = (body && typeof body === 'object' ? body : {}) as Row
  const mode = b.mode === 'remove' ? 'remove' : 'add'
  const rawIds: unknown[] = Array.isArray(b.transactionIds) ? b.transactionIds : []
  const requested = new Set(
    rawIds.map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0)
  )
  if (!requested.size) return json({ error: 'transactionIds must be a non-empty array' }, 400)
  if (requested.size > 1000) {
    return json({ error: 'Cannot tag more than 1000 transactions at once' }, 400)
  }

  const db = await getDB()
  const owned = ((await db.getAllFromIndex('transactions', 'by_profile', pid)) as Row[]).filter(
    (row) => requested.has(Number(row.id))
  )

  if (mode === 'remove') {
    const removed = await unlinkRowsFromTag(owned, tagId)
    return json({ ok: true, mode, matched: owned.length, removed })
  }
  const added = await linkRowsToTag(owned, tagId, pid)
  return json({ ok: true, mode, matched: owned.length, added })
}

/**
 * Tag every auto-apply rule onto a just-created transaction. Fail-soft by design: the
 * transaction is already stored, so a tagging problem must never surface as a create failure.
 * Returns the tags that were attached so the caller can echo them in its response.
 */
export async function autoApplyTagRules(
  transactionId: number,
  profileId: number
): Promise<{ id: number; name: string; color: string }[]> {
  try {
    const rules = await loadTagRules(profileId, { autoApplyOnly: true })
    if (!rules.length) return []
    const db = await getDB()
    const row = (await db.get('transactions', transactionId)) as Row | undefined
    if (!row || row.profile_id !== profileId) return []
    const tagIds = new Set<number>()
    for (const rule of rules) {
      if (transactionMatchesTagRule(row, rule.criteria)) tagIds.add(rule.tag_id)
    }
    for (const tagId of tagIds) {
      // Re-read between links so each write builds on the previous one's tag_ids.
      const current = (await db.get('transactions', transactionId)) as Row | undefined
      if (current) await linkRowsToTag([current], tagId, profileId)
    }
    const final = (await db.get('transactions', transactionId)) as Row | undefined
    return (final?.tags as { id: number; name: string; color: string }[]) ?? []
  } catch {
    // Best effort — the transaction itself is already saved and correct.
    return []
  }
}

// ── Summaries ────────────────────────────────────────────────────────────────

interface TypeTotals {
  income: number
  expense: number
  transfer: number
  deduction: number
  count: number
}

const emptyTotals = (): TypeTotals => ({
  income: 0,
  expense: 0,
  transfer: 0,
  deduction: 0,
  count: 0,
})

function addTotals(totals: TypeTotals, row: Row): void {
  const type = String(row.type)
  const value = getAmount(row)
  if (type === 'income' || type === 'expense' || type === 'transfer' || type === 'deduction') {
    totals[type] += value
  }
  totals.count += 1
}

/** Restrict rows to the requested date window (both bounds inclusive, ISO dates). */
function withinWindow(row: Row, startDate: string | null, endDate: string | null): boolean {
  const date = String(row.date ?? '').slice(0, 10)
  if (startDate && date < startDate) return false
  if (endDate && date > endDate) return false
  return true
}

async function windowedTaggedRows(
  profileId: number,
  query: URLSearchParams
): Promise<{ rows: Row[]; tags: Row[] }> {
  const db = await getDB()
  const startDate = query.get('startDate')
  const endDate = query.get('endDate')
  const rows = (
    (await db.getAllFromIndex('transactions', 'by_profile', profileId)) as Row[]
  ).filter((row) => withinWindow(row, startDate, endDate))
  const tags = (await db.getAllFromIndex('tags', 'by_profile', profileId)) as Row[]
  return { rows, tags }
}

/** Per-tag totals for the whole tag list — powers the Tags page overview. */
export async function tagsSummary(query: URLSearchParams): Promise<Response> {
  const pid = await adapter.getCurrentProfileId()
  const { rows, tags } = await windowedTaggedRows(pid, query)
  const rules = await loadTagRules(pid)

  const byTag = new Map<number, TypeTotals>()
  for (const row of rows) {
    for (const tagId of (row.tag_ids as number[]) ?? []) {
      const totals = byTag.get(tagId) ?? emptyTotals()
      addTotals(totals, row)
      byTag.set(tagId, totals)
    }
  }
  const ruleCounts = new Map<number, number>()
  for (const rule of rules) ruleCounts.set(rule.tag_id, (ruleCounts.get(rule.tag_id) ?? 0) + 1)

  const result = tags
    .slice()
    .sort((a, b) => String(a.name).localeCompare(String(b.name)))
    .map((tag) => {
      const totals = byTag.get(tag.id as number) ?? emptyTotals()
      return {
        id: tag.id,
        name: tag.name,
        color: tag.color,
        ...totals,
        net: totals.income - totals.expense,
        rule_count: ruleCounts.get(tag.id as number) ?? 0,
      }
    })
  return json(result)
}

/** Detail view for one tag: totals, monthly series, and a category breakdown. */
export async function tagSummary(
  params: Record<string, string>,
  query: URLSearchParams
): Promise<Response> {
  const pid = await adapter.getCurrentProfileId()
  const tagId = idParam(params)
  const tag = await currentProfileRecord('tags', tagId, pid)
  if (!tag) return notFound('Tag')

  const { rows } = await windowedTaggedRows(pid, query)
  const tagged = rows.filter((row) => ((row.tag_ids as number[]) ?? []).includes(tagId))

  const db = await getDB()
  const cats = (await db.getAllFromIndex('categories', 'by_profile', pid)) as Row[]
  const catMap = new Map(cats.map((c) => [c.id as number, c]))

  const totals = emptyTotals()
  const months = new Map<string, TypeTotals>()
  const categories = new Map<string, Row>()
  for (const row of tagged) {
    addTotals(totals, row)

    const month = String(row.date ?? '').slice(0, 7)
    const bucket = months.get(month) ?? emptyTotals()
    addTotals(bucket, row)
    months.set(month, bucket)

    const categoryId = typeof row.category_id === 'number' ? row.category_id : null
    const cat = categoryId !== null ? catMap.get(categoryId) : undefined
    const key = `${categoryId ?? 'none'}:${String(row.type)}`
    const entry = categories.get(key) ?? {
      category_id: categoryId,
      name: cat?.name ?? 'Uncategorized',
      color: cat?.color ?? '#6b7280',
      type: String(row.type),
      total: 0,
      count: 0,
    }
    entry.total += getAmount(row)
    entry.count += 1
    categories.set(key, entry)
  }

  return json({
    tag: { id: tag.id, name: tag.name, color: tag.color },
    totals: { ...totals, net: totals.income - totals.expense },
    monthly: [...months.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, values]) => ({ month, ...values })),
    categories: [...categories.values()].sort((a, b) => (b.total as number) - (a.total as number)),
  })
}
