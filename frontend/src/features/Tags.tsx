/**
 * Tags Page
 *
 * Tags are the cross-cutting dimension categories can't express: one "Company" tag can span
 * Food, Travel and Utilities, and one category can hold both tagged and untagged rows. This page
 * is where a tag is created, given a *rule* (a saved filter), applied backwards over existing
 * transactions, and read as a chart.
 *
 * Three panes:
 *  - the tag list, with per-tag income / expense / net for the focus period;
 *  - the selected tag's analytics — monthly income-vs-expense bars plus a category breakdown;
 *  - the selected tag's rules, each with a live preview ("would match N, N new") before any
 *    bulk write happens.
 */
import { createEffect, createMemo, createResource, createSignal, For, on, Show } from 'solid-js'
import {
  describeTagRuleCriteria,
  EMPTY_TAG_RULE_CRITERIA,
  isTagRuleCriteriaEmpty,
  normalizeTagRuleCriteria,
} from '../../../shared/tagRules'
import Chart from '../components/Chart'
import ConfirmButton from '../components/ConfirmButton'
import OrbitalDivider from '../components/OrbitalDivider'
import PeriodBar from '../components/PeriodBar'
import { api, formatCurrency, showToast } from '../core/api'
import { bumpTagsVersion, useAppState } from '../core/appStore'
import { CATEGORY_PALETTE } from '../core/brandPalette'
import { gatedSource } from '../core/pageVisibility'
import { usePeriod } from '../core/periodStore'
import { toRange } from '../utils/period'
import styles from './TagsPage.module.css'
import type { TagRuleCriteria } from '../../../shared/tagRules'
import type * as Models from '../types/models'

const TAG_COLORS = CATEGORY_PALETTE

const TEXT_MODES: { value: TagRuleCriteria['descriptionMode']; label: string }[] = [
  { value: 'contains', label: 'contains' },
  { value: 'equals', label: 'is exactly' },
  { value: 'starts_with', label: 'starts with' },
  { value: 'ends_with', label: 'ends with' },
]

const TX_TYPES: { value: Models.TransactionType; label: string }[] = [
  { value: 'income', label: 'Income' },
  { value: 'expense', label: 'Expense' },
  { value: 'transfer', label: 'Transfer' },
  { value: 'deduction', label: 'Deduction' },
]

interface RuleDraft {
  /** Existing rule id, or null while composing a new one. */
  id: number | null
  /** The tag this draft is for. Carried on the draft rather than read from the live selection so
   *  a rule can never be saved against whichever tag happens to be selected when you hit Save. */
  tagId: number
  name: string
  autoApply: boolean
  criteria: TagRuleCriteria
}

function newDraft(tagId: number): RuleDraft {
  return { id: null, tagId, name: '', autoApply: true, criteria: { ...EMPTY_TAG_RULE_CRITERIA } }
}

function monthLabel(month: string): string {
  const [year, m] = month.split('-')
  if (!year || !m) return month
  const date = new Date(Number(year), Number(m) - 1, 1)
  return date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
}

export default function Tags() {
  const state = useAppState()
  const { period } = usePeriod()

  const range = createMemo(() => toRange(period()))

  const [selectedTagId, setSelectedTagId] = createSignal<number | null>(null)
  const [draft, setDraft] = createSignal<RuleDraft | null>(null)
  const [preview, setPreview] = createSignal<Models.TagRulePreview | null>(null)
  const [previewing, setPreviewing] = createSignal(false)
  const [applying, setApplying] = createSignal(false)
  const [showTagForm, setShowTagForm] = createSignal(false)
  const [editingTag, setEditingTag] = createSignal<Models.TagSummary | null>(null)
  const [tagName, setTagName] = createSignal('')
  const [tagColor, setTagColor] = createSignal(TAG_COLORS[0])

  // Overview: tags + their totals for the focus period, refetched on profile/period change.
  //
  // The fetcher never rejects. Its callers are fire-and-forget (`refreshOverview()` after a
  // save/delete), and a rejecting refetch there surfaces as an "Uncaught (in promise)" with no
  // user-visible explanation at all. Instead the tag list — the one call the page cannot work
  // without — records its failure, and the page renders a retry banner.
  const [overview, { refetch: refetchOverview }] = createResource(
    gatedSource('tags', () => `${state.profileVersion}|${range().from}|${range().to}`),
    async () => {
      const [summary, rules, categories, accounts] = await Promise.all([
        api
          .getTagsSummary({ startDate: range().from, endDate: range().to })
          .catch(() => null as Models.TagSummary[] | null),
        api.getTagRules().catch(() => [] as Models.TagRule[]),
        api.getCategories().catch(() => [] as Models.Category[]),
        api.getAccounts().catch(() => [] as Models.Account[]),
      ])
      return { summary: summary ?? [], failed: summary === null, rules, categories, accounts }
    }
  )

  /** True when the tag list itself could not be loaded (network, auth, or a server error). */
  const loadFailed = () => overview.latest?.failed === true

  /** Refetch without letting a rejection escape as an unhandled promise rejection. */
  const refreshOverview = () => void Promise.resolve(refetchOverview()).catch(() => {})

  const tags = () => overview.latest?.summary ?? []
  const rules = () => overview.latest?.rules ?? []
  // Rule criteria apply against the ACTIVE profile only, so the editor's category/account chips
  // must show just that profile's rows — getCategories/getAccounts fetch at household scope, and
  // offering another profile's (often same-named) category would build a condition that silently
  // matches nothing.
  const categories = () => {
    const pid = state.currentProfile?.id
    const all = overview.latest?.categories ?? []
    return pid === undefined ? all : all.filter((c) => c.profile_id === pid)
  }
  const accounts = () => {
    const pid = state.currentProfile?.id
    const all = overview.latest?.accounts ?? []
    return pid === undefined ? all : all.filter((a) => a.profile_id === pid)
  }
  const loading = () => overview.loading && !overview.latest

  // With a single tag there is nothing to choose between, and leaving it unselected hides the
  // rules behind a click nobody knows to make. So select it for the user — but only when the LIST
  // becomes a single tag, never as a standing "if nothing is selected, select it" invariant.
  //
  // As an invariant it re-ran on every selection change and fought the user twice over. Clicking
  // the selected card to deselect it re-selected the tag immediately. Worse, deleting your only
  // tag clears the selection while `tags()` still holds the stale list — so it re-selected the tag
  // that had just been deleted, and the detail resource asked the API for the summary of a tag
  // that no longer existed ("Tag not found"). `on(tags, …)` reads the selection untracked, so
  // neither of those can happen.
  createEffect(
    on(tags, (all, prev) => {
      const becameLone = all.length === 1 && (prev === undefined || prev.length !== 1)
      if (becameLone && selectedTagId() === null) setSelectedTagId(all[0]!.id)
    })
  )

  const selectedTag = createMemo(() => tags().find((t) => t.id === selectedTagId()) ?? null)
  const selectedRules = createMemo(() => rules().filter((rule) => rule.tag_id === selectedTagId()))

  // Detail: monthly series + category breakdown for the selected tag.
  const [detail, { refetch: refetchDetail }] = createResource(
    () => {
      const id = selectedTagId()
      return id === null ? null : { id, from: range().from, to: range().to }
    },
    (key) => api.getTagSummary(key.id, { startDate: key.from, endDate: key.to })
  )

  /** As refreshOverview, for the selected tag's detail panel. Declared after its resource so it
   *  can't be called from setup code before `refetchDetail` is initialised. */
  const refreshDetail = () => void Promise.resolve(refetchDetail()).catch(() => {})

  // Close an open rule draft when the user switches to a different tag — the tag cards stay
  // clickable, and a draft left open across a switch reads as belonging to the tag now on screen.
  // (What gets SAVED was never at risk: save/preview/apply act on the draft's own tagId.)
  //
  // Only a draft for a different tag is dropped, so "Add rule" on an unselected card can select
  // the tag and open its editor in one click. That works today either way — Solid flushes this
  // effect between startNewRule's two setters — but the guard is what makes it true by intent
  // rather than by setter ordering, which a later `batch()` would quietly reverse.
  createEffect(
    on(
      selectedTagId,
      (id) => {
        if (draft()?.tagId === id) return
        setDraft(null)
        setPreview(null)
      },
      { defer: true }
    )
  )

  const totals = createMemo(() => {
    let income = 0
    let expense = 0
    let count = 0
    for (const tag of tags()) {
      income += tag.income
      expense += tag.expense
      count += tag.count
    }
    return { income, expense, count, net: income - expense }
  })

  // ── Tag CRUD ───────────────────────────────────────────────────────────────

  /** Close the tag form and leave no half-open state behind. `showTagForm` drives the create
   *  form at the top of the page and `editingTag` drives the in-card edit form, so clearing only
   *  one of them left the card's form open after a save — the toast said "Tag updated" while the
   *  editor still covered the name it had just changed. */
  const closeTagForm = () => {
    setShowTagForm(false)
    setEditingTag(null)
  }

  const openNewTag = () => {
    setEditingTag(null)
    setTagName('')
    setTagColor(TAG_COLORS[tags().length % TAG_COLORS.length])
    setShowTagForm(true)
  }

  const openEditTag = (tag: Models.TagSummary) => {
    setEditingTag(tag)
    setTagName(tag.name)
    setTagColor(tag.color || TAG_COLORS[0])
    setShowTagForm(true)
  }

  const saveTag = async (e: Event) => {
    e.preventDefault()
    const name = tagName().trim()
    if (!name) return
    try {
      const existing = editingTag()
      if (existing) {
        await api.updateTag(existing.id, name, tagColor())
        showToast('Tag updated', 'success')
      } else {
        const created = await api.createTag(name, tagColor())
        showToast('Tag created', 'success')
        if (created?.id) setSelectedTagId(created.id)
      }
      closeTagForm()
      // The Transactions page keeps its own tag list for the filter bar and bulk-tag modal.
      bumpTagsVersion()
      refreshOverview()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not save tag', 'error')
    }
  }

  const deleteTag = async (tag: Models.TagSummary) => {
    try {
      await api.deleteTag(tag.id)
      showToast(`Tag "${tag.name}" deleted`, 'success')
      if (selectedTagId() === tag.id) setSelectedTagId(null)
      bumpTagsVersion()
      refreshOverview()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not delete tag', 'error')
    }
  }

  // ── Rule editing ───────────────────────────────────────────────────────────

  /** Open an empty rule editor for a tag, selecting it first if it isn't already. Every caller
   *  names the tag, so the editor can never open against a stale or absent selection. */
  const startNewRule = (tagId: number) => {
    setSelectedTagId(tagId)
    setPreview(null)
    setDraft(newDraft(tagId))
  }

  const startEditRule = (rule: Models.TagRule) => {
    setPreview(null)
    setDraft({
      id: rule.id,
      tagId: rule.tag_id,
      name: rule.name,
      autoApply: rule.auto_apply,
      criteria: normalizeTagRuleCriteria(rule.criteria),
    })
  }

  const patchCriteria = (patch: Partial<TagRuleCriteria>) => {
    const current = draft()
    if (!current) return
    setDraft({ ...current, criteria: { ...current.criteria, ...patch } })
    // Any edit invalidates the previous dry-run.
    setPreview(null)
  }

  const toggleInList = (list: number[], id: number): number[] =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id]

  const runPreview = async () => {
    const current = draft()
    const tagId = current?.tagId ?? null
    if (!current || tagId === null) return
    const criteria = current.criteria
    setPreviewing(true)
    try {
      const result = await api.previewTagRule({ tag_id: tagId, criteria })
      // patchCriteria replaces the criteria object on every edit, so a changed reference means the
      // user edited the rule mid-request — drop this now-stale dry-run instead of flashing it.
      if (draft()?.criteria === criteria) setPreview(result)
    } catch (err) {
      if (draft()?.criteria === criteria) {
        showToast(err instanceof Error ? err.message : 'Preview failed', 'error')
      }
    } finally {
      setPreviewing(false)
    }
  }

  const saveRule = async () => {
    const current = draft()
    const tagId = current?.tagId ?? null
    if (!current || tagId === null) return
    if (isTagRuleCriteriaEmpty(current.criteria)) {
      showToast('Add at least one condition before saving', 'warning')
      return
    }
    try {
      const payload = {
        name: current.name.trim(),
        criteria: current.criteria,
        auto_apply: current.autoApply,
      }
      if (current.id === null) {
        await api.createTagRule({ tag_id: tagId, ...payload })
        showToast('Rule created', 'success')
      } else {
        await api.updateTagRule(current.id, { tag_id: tagId, ...payload })
        showToast('Rule updated', 'success')
      }
      setDraft(null)
      setPreview(null)
      refreshOverview()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not save rule', 'error')
    }
  }

  const deleteRule = async (rule: Models.TagRule) => {
    try {
      await api.deleteTagRule(rule.id)
      showToast('Rule deleted', 'success')
      if (draft()?.id === rule.id) setDraft(null)
      refreshOverview()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not delete rule', 'error')
    }
  }

  /** Tag existing transactions. Uses the draft criteria when one is open, else the saved rules. */
  const applyRules = async (useDraft: boolean) => {
    const current = draft()
    const tagId = useDraft ? (current?.tagId ?? null) : selectedTagId()
    if (tagId === null) return
    if (useDraft && (!current || isTagRuleCriteriaEmpty(current.criteria))) {
      showToast('Add at least one condition first', 'warning')
      return
    }
    setApplying(true)
    try {
      const result = await api.applyTagRules(tagId, useDraft ? current?.criteria : undefined)
      showToast(
        result.tagged > 0
          ? `Tagged ${result.tagged} transaction${result.tagged === 1 ? '' : 's'} (${result.matched} matched)`
          : `No new transactions to tag (${result.matched} already matched)`,
        result.tagged > 0 ? 'success' : 'info'
      )
      if (result.truncated) {
        showToast('Only the most recent 20,000 transactions were scanned', 'warning')
      }
      // Refetch the detail panel too: applying tags N transactions but changes none of the
      // detail resource's keys, so its chart + category breakdown would otherwise keep showing the
      // pre-apply (often empty) state — exactly the view the user applied the rule to populate.
      refreshOverview()
      refreshDetail()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not apply rules', 'error')
    } finally {
      setApplying(false)
    }
  }

  /**
   * Open the transactions list filtered to this tag.
   *
   * The list opens on the global focus period, and a tag with nothing in the current month would
   * land the user on an empty table — which reads as "the filter is broken", not "this month was
   * quiet". When the summary says there is nothing to see in this period, ask for all time and let
   * the list explain why it widened.
   */
  const viewTaggedTransactions = (tag: Models.TagSummary) => {
    const widen = tag.count === 0 ? '&period=all' : ''
    window.location.hash = `#transactions?tag=${tag.id}${widen}`
  }

  // ── Chart data ─────────────────────────────────────────────────────────────

  const chartData = createMemo(() => {
    const months = detail.latest?.monthly ?? []
    return {
      labels: months.map((m) => monthLabel(m.month)),
      datasets: [
        {
          label: 'Income',
          data: months.map((m) => m.income),
          backgroundColor: 'rgba(89, 210, 162, 0.55)',
          borderColor: 'rgba(89, 210, 162, 1)',
          borderWidth: 1,
        },
        {
          label: 'Expenses',
          data: months.map((m) => m.expense),
          backgroundColor: 'rgba(224, 112, 138, 0.55)',
          borderColor: 'rgba(224, 112, 138, 1)',
          borderWidth: 1,
        },
        {
          label: 'Transfers',
          data: months.map((m) => m.transfer),
          backgroundColor: 'rgba(110, 155, 255, 0.45)',
          borderColor: 'rgba(110, 155, 255, 1)',
          borderWidth: 1,
        },
      ],
    }
  })

  const hasChartData = createMemo(() => (detail.latest?.monthly.length ?? 0) > 0)

  /** A tag card's normal contents — split out so the card can host the edit form in its place. */
  const tagCardBody = (tag: Models.TagSummary) => (
    <>
      <button
        class={styles.tagCardMain}
        type="button"
        onClick={() => setSelectedTagId(selectedTagId() === tag.id ? null : tag.id)}
      >
        <span class={styles.tagHeader}>
          <span class={styles.tagDot} style={{ background: tag.color }} />
          <span class={styles.tagName}>{tag.name}</span>
          <Show when={tag.rule_count > 0}>
            <span class={styles.rulePill}>
              {tag.rule_count} rule{tag.rule_count === 1 ? '' : 's'}
            </span>
          </Show>
          <Show when={tag.count === 0}>
            {/* Zero here means "nothing in the focus period", not "nothing ever".
                          Without saying so the card reads as a broken tag. */}
            <span class={styles.quietPill}>none this period</span>
          </Show>
        </span>
        <span class={styles.tagStats}>
          <span class={styles.stat}>
            <span class={styles.statLabel}>In</span>
            <span class={`${styles.statValue} ${styles.positive}`}>
              {formatCurrency(tag.income)}
            </span>
          </span>
          <span class={styles.stat}>
            <span class={styles.statLabel}>Out</span>
            <span class={`${styles.statValue} ${styles.negative}`}>
              {formatCurrency(tag.expense)}
            </span>
          </span>
          <span class={styles.stat}>
            <span class={styles.statLabel}>Net</span>
            <span class={`${styles.statValue} ${tag.net >= 0 ? styles.positive : styles.negative}`}>
              {formatCurrency(tag.net)}
            </span>
          </span>
          <span class={styles.stat}>
            <span class={styles.statLabel}>Txs</span>
            <span class={styles.statValue}>{tag.count}</span>
          </span>
        </span>
      </button>
      <div class={styles.tagCardActions}>
        {/* The rule count used to be a pill inside the card's main button — it looked
                      like a badge, so nobody clicked it, and editing a rule meant discovering
                      that the whole card selects. This is the affordance. */}
        <button
          class={styles.rulesButton}
          type="button"
          data-test-id={`tag-rules-${tag.id}`}
          onClick={() => {
            // With rules, this is "go read them". With none, "Add rule" has to actually add one:
            // it used to only select and scroll, landing you on "No rules yet for this tag" and a
            // second Add rule button — which, on a tag you had just created and were already
            // looking at, was indistinguishable from the button doing nothing.
            if (tag.rule_count > 0) setSelectedTagId(tag.id)
            else startNewRule(tag.id)
            queueMicrotask(() => {
              document
                .getElementById('tags-sec-rules')
                ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            })
          }}
        >
          {tag.rule_count > 0
            ? `${tag.rule_count} rule${tag.rule_count === 1 ? '' : 's'}`
            : 'Add rule'}
          <span aria-hidden="true">→</span>
        </button>
        <button
          class={styles.ghostButton}
          type="button"
          onClick={() => {
            viewTaggedTransactions(tag)
          }}
        >
          View
        </button>
        <button
          class={styles.ghostButton}
          type="button"
          onClick={() => {
            openEditTag(tag)
          }}
        >
          Edit
        </button>
        <ConfirmButton
          class={styles.dangerButton}
          label="Delete"
          message={`Delete tag "${tag.name}"? It will be removed from ${tag.count} transaction(s); the transactions themselves are kept.`}
          onConfirm={() => void deleteTag(tag)}
        />
      </div>
    </>
  )

  /** The name + colour form, rendered either at the top (creating) or inside a card (editing). */
  const tagForm = () => (
    <form class={styles.tagForm} onSubmit={(e) => void saveTag(e)}>
      <div class={styles.tagFormRow}>
        <input
          class={styles.input}
          type="text"
          placeholder="Tag name (e.g. Company, Trip to Rome)"
          value={tagName()}
          onInput={(e) => setTagName(e.currentTarget.value)}
          // Focus explicitly on mount rather than with the `autofocus` attribute: the browser
          // refuses autofocus when something already holds focus (the button that opened this
          // form) and logs a console warning every time.
          ref={(el) => {
            queueMicrotask(() => {
              el.focus()
            })
          }}
          data-test-id="tag-name-input"
        />
        <div class={styles.swatches}>
          <For each={TAG_COLORS}>
            {(color) => (
              <button
                type="button"
                class={`${styles.swatch} ${tagColor() === color ? styles.swatchActive : ''}`}
                style={{ background: color }}
                aria-label={`Use color ${color}`}
                onClick={() => setTagColor(color)}
              />
            )}
          </For>
        </div>
        <button class={styles.primaryButton} type="submit">
          {editingTag() ? 'Save' : 'Create'}
        </button>
        <button class={styles.ghostButton} type="button" onClick={closeTagForm}>
          Cancel
        </button>
      </div>
    </form>
  )

  return (
    <div class={`${styles.page} page page-tags page-enter`}>
      <div class={styles.pageHeader}>
        <div>
          <h2 data-tour="tags-header">Tags</h2>
          <p>
            Cross-cutting labels with saved filters — tag a company, a project or a trip across any
            number of categories, then chart it.
          </p>
        </div>
        <button class={styles.primaryButton} onClick={openNewTag} type="button">
          + New tag
        </button>
      </div>

      <PeriodBar showPills />

      {/* Creating a tag shows the form here, next to the button that opened it. EDITING renders
          the same form inside the card being edited (see the grid below) — it used to appear up
          here too, detached from the tag it was changing and above every other card. */}
      <Show when={showTagForm() && !editingTag()}>{tagForm()}</Show>

      <div class={styles.summaryRow}>
        <div class={styles.summaryCard}>
          <div class={styles.summaryLabel}>Tags</div>
          <div class={styles.summaryValue}>{tags().length}</div>
        </div>
        <div class={styles.summaryCard}>
          <div class={styles.summaryLabel}>Tagged income</div>
          <div class={`${styles.summaryValue} ${styles.positive}`}>
            {formatCurrency(totals().income)}
          </div>
        </div>
        <div class={styles.summaryCard}>
          <div class={styles.summaryLabel}>Tagged expenses</div>
          <div class={`${styles.summaryValue} ${styles.negative}`}>
            {formatCurrency(totals().expense)}
          </div>
        </div>
        <div class={styles.summaryCard}>
          <div class={styles.summaryLabel}>Tagged transactions</div>
          <div class={styles.summaryValue}>{totals().count}</div>
        </div>
      </div>

      <OrbitalDivider id="tags-sec-list" label="Your tags" meta={`${tags().length} tags`} />

      {/* A failed load used to be indistinguishable from having no tags. Say which it is, and
          offer the retry, instead of rendering a confident "No tags yet". */}
      <Show when={loadFailed()}>
        <div class={styles.loadError} data-test-id="tags-load-error">
          <span>Couldn’t load your tags — the server returned an error.</span>
          <button class={styles.secondaryButton} type="button" onClick={refreshOverview}>
            Retry
          </button>
        </div>
      </Show>

      <Show when={!loading()} fallback={<div class={styles.loadingState}>Loading tags…</div>}>
        <Show
          when={tags().length > 0}
          fallback={
            <div class={styles.emptyState}>
              <p>No tags yet</p>
              <p>
                Create a tag, give it a rule (for example “account is Business” or “description
                contains AWS”), then apply it to every transaction you already have.
              </p>
            </div>
          }
        >
          <div class={styles.tagGrid}>
            <For each={tags()}>
              {(tag) => (
                <div
                  class={`${styles.tagCard} ${selectedTagId() === tag.id ? styles.tagCardActive : ''}`}
                  data-test-id={`tag-card-${tag.id}`}
                >
                  <Show when={editingTag()?.id === tag.id} fallback={<>{tagCardBody(tag)}</>}>
                    {/* Edit in place. The form used to open above the whole grid, so on a page
                        with several tags you were editing one thing while looking at another. */}
                    <div class={styles.tagCardEditing}>{tagForm()}</div>
                  </Show>
                </div>
              )}
            </For>
          </div>
        </Show>
      </Show>

      <Show when={selectedTag()}>
        {(tag) => (
          <>
            <div class={styles.detailGrid}>
              <div class={styles.chartCard}>
                <h3 class={styles.cardTitle}>Monthly flow</h3>
                <Show
                  when={hasChartData()}
                  fallback={
                    <div class={styles.emptyState}>
                      <p>Nothing tagged in this period yet</p>
                      <p>Add a rule below and apply it to your existing transactions.</p>
                    </div>
                  }
                >
                  <div class={styles.chartBox}>
                    <Chart
                      type="bar"
                      data={chartData()}
                      options={{
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                          legend: { position: 'top', labels: { usePointStyle: true, padding: 14 } },
                        },
                        scales: { y: { beginAtZero: true } },
                      }}
                      height={280}
                    />
                  </div>
                </Show>
              </div>

              <div class={styles.breakdownCard}>
                <h3 class={styles.cardTitle}>By category</h3>
                <Show
                  when={(detail.latest?.categories.length ?? 0) > 0}
                  fallback={<p class={styles.muted}>No tagged transactions in this period.</p>}
                >
                  <ul class={styles.breakdownList}>
                    <For each={detail.latest?.categories ?? []}>
                      {(row) => (
                        <li class={styles.breakdownRow}>
                          <span class={styles.tagDot} style={{ background: row.color }} />
                          <span class={styles.breakdownName}>{row.name}</span>
                          <span class={styles.breakdownType}>{row.type}</span>
                          <span
                            class={`${styles.breakdownTotal} ${row.type === 'income' ? styles.positive : styles.negative}`}
                          >
                            {formatCurrency(row.total)}
                          </span>
                          <span class={styles.breakdownCount}>{row.count}</span>
                        </li>
                      )}
                    </For>
                  </ul>
                </Show>
              </div>
            </div>

            <OrbitalDivider
              id="tags-sec-rules"
              label="Rules"
              meta={`${selectedRules().length} rule${selectedRules().length === 1 ? '' : 's'}`}
            />

            <div class={styles.rulesCard}>
              <h3 class={styles.rulesCardTitle}>
                <span class={styles.tagTitleDot} style={{ '--tag-color': tag().color }} />
                Rules for {tag().name}
              </h3>
              <p class={styles.muted}>
                A rule is a saved filter. Apply it to tag every matching transaction you already
                have, and leave auto-apply on to tag matching ones you add later.
              </p>
              <Show when={selectedRules().length > 1}>
                {/* Rules are OR'd (transactionMatchesAnyTagRule). Nothing said so, which made
                    "match this AND either of those" look impossible rather than like two rules. */}
                <p class={styles.muted}>
                  A transaction gets this tag if it matches <strong>any</strong> rule below — so a
                  condition that must always hold goes in every rule.
                </p>
              </Show>

              <Show
                when={selectedRules().length > 0}
                fallback={<p class={styles.muted}>No rules yet for this tag.</p>}
              >
                <ul class={styles.ruleList}>
                  <For each={selectedRules()}>
                    {(rule) => (
                      <li class={styles.ruleRow}>
                        <div class={styles.ruleInfo}>
                          <span class={styles.ruleName}>{rule.name || 'Untitled rule'}</span>
                          <span class={styles.ruleDesc}>
                            {describeTagRuleCriteria(normalizeTagRuleCriteria(rule.criteria))}
                          </span>
                        </div>
                        <Show when={rule.auto_apply}>
                          <span class={styles.autoPill}>auto</span>
                        </Show>
                        <button
                          class={styles.ghostButton}
                          type="button"
                          onClick={() => {
                            startEditRule(rule)
                          }}
                        >
                          Edit
                        </button>
                        <ConfirmButton
                          class={styles.dangerButton}
                          label="Delete"
                          message="Delete this rule? Transactions it already tagged keep the tag."
                          onConfirm={() => void deleteRule(rule)}
                        />
                      </li>
                    )}
                  </For>
                </ul>
              </Show>

              <div class={styles.ruleActions}>
                <Show when={!draft()}>
                  <button
                    class={styles.primaryButton}
                    type="button"
                    onClick={() => {
                      startNewRule(tag().id)
                    }}
                  >
                    + Add rule
                  </button>
                </Show>
                <Show when={selectedRules().length > 0 && !draft()}>
                  <button
                    class={styles.secondaryButton}
                    type="button"
                    disabled={applying()}
                    onClick={() => void applyRules(false)}
                  >
                    {applying() ? 'Applying…' : 'Apply all rules to existing transactions'}
                  </button>
                </Show>
              </div>

              <Show when={draft()}>
                {(current) => (
                  <div class={styles.ruleEditor} data-test-id="tag-rule-editor">
                    <section class={styles.editorSection}>
                      <h4 class={styles.editorSectionTitle}>Name this rule</h4>
                      <div class={styles.editorRow}>
                        <label class={styles.field}>
                          <span class={styles.fieldLabel}>Rule name</span>
                          <input
                            class={styles.input}
                            type="text"
                            placeholder="e.g. Business card spend"
                            value={current().name}
                            onInput={(e) => {
                              const d = draft()
                              if (d) setDraft({ ...d, name: e.currentTarget.value })
                            }}
                          />
                        </label>
                        <label class={styles.field}>
                          <span class={styles.fieldLabel}>Match</span>
                          <select
                            class={styles.select}
                            value={current().criteria.match}
                            onChange={(e) => {
                              patchCriteria({
                                match: e.currentTarget.value as TagRuleCriteria['match'],
                              })
                            }}
                          >
                            <option value="all">All conditions (AND)</option>
                            <option value="any">Any condition (OR)</option>
                          </select>
                        </label>
                        <label class={styles.checkboxField}>
                          <input
                            type="checkbox"
                            checked={current().autoApply}
                            onChange={(e) => {
                              const d = draft()
                              if (d) setDraft({ ...d, autoApply: e.currentTarget.checked })
                            }}
                          />
                          <span>Auto-apply to new transactions</span>
                        </label>
                      </div>
                    </section>

                    <section class={styles.editorSection}>
                      <h4 class={styles.editorSectionTitle}>Match on text</h4>
                      <div class={styles.editorRow}>
                        <label class={styles.field}>
                          <span class={styles.fieldLabel}>Description</span>
                          <div class={styles.inlineGroup}>
                            <select
                              class={styles.selectSmall}
                              value={current().criteria.descriptionMode}
                              onChange={(e) => {
                                patchCriteria({
                                  descriptionMode: e.currentTarget
                                    .value as TagRuleCriteria['descriptionMode'],
                                })
                              }}
                            >
                              <For each={TEXT_MODES}>
                                {(mode) => <option value={mode.value}>{mode.label}</option>}
                              </For>
                            </select>
                            <input
                              class={styles.input}
                              type="text"
                              placeholder="any text"
                              value={current().criteria.description}
                              onInput={(e) => {
                                patchCriteria({ description: e.currentTarget.value })
                              }}
                            />
                          </div>
                        </label>

                        <label class={styles.field}>
                          <span class={styles.fieldLabel}>Counterparty (beneficiary or payor)</span>
                          <div class={styles.inlineGroup}>
                            <select
                              class={styles.selectSmall}
                              value={current().criteria.counterpartyMode}
                              onChange={(e) => {
                                patchCriteria({
                                  counterpartyMode: e.currentTarget
                                    .value as TagRuleCriteria['counterpartyMode'],
                                })
                              }}
                            >
                              <For each={TEXT_MODES}>
                                {(mode) => <option value={mode.value}>{mode.label}</option>}
                              </For>
                            </select>
                            <input
                              class={styles.input}
                              type="text"
                              placeholder="any name"
                              value={current().criteria.counterparty}
                              onInput={(e) => {
                                patchCriteria({ counterparty: e.currentTarget.value })
                              }}
                            />
                          </div>
                        </label>
                      </div>
                    </section>

                    <section class={styles.editorSection}>
                      <h4 class={styles.editorSectionTitle}>
                        Notes, payment method, amount and date
                      </h4>
                      <div class={styles.editorRow}>
                        <label class={styles.field}>
                          <span class={styles.fieldLabel}>Notes contain</span>
                          <input
                            class={styles.input}
                            type="text"
                            placeholder="any text"
                            value={current().criteria.notes}
                            onInput={(e) => {
                              patchCriteria({ notes: e.currentTarget.value })
                            }}
                          />
                        </label>
                        <label class={styles.field}>
                          <span class={styles.fieldLabel}>Payment method contains</span>
                          <input
                            class={styles.input}
                            type="text"
                            placeholder="e.g. card, SEPA"
                            value={current().criteria.meansOfPayment}
                            onInput={(e) => {
                              patchCriteria({ meansOfPayment: e.currentTarget.value })
                            }}
                          />
                        </label>
                        <label class={styles.field}>
                          <span class={styles.fieldLabel}>Amount between</span>
                          <div class={styles.inlineGroup}>
                            <input
                              class={styles.input}
                              type="number"
                              step="0.01"
                              placeholder="min"
                              value={current().criteria.amountMin ?? ''}
                              onInput={(e) => {
                                patchCriteria({
                                  amountMin:
                                    e.currentTarget.value === ''
                                      ? null
                                      : Number(e.currentTarget.value),
                                })
                              }}
                            />
                            <input
                              class={styles.input}
                              type="number"
                              step="0.01"
                              placeholder="max"
                              value={current().criteria.amountMax ?? ''}
                              onInput={(e) => {
                                patchCriteria({
                                  amountMax:
                                    e.currentTarget.value === ''
                                      ? null
                                      : Number(e.currentTarget.value),
                                })
                              }}
                            />
                          </div>
                        </label>
                        <label class={styles.field}>
                          <span class={styles.fieldLabel}>Date between</span>
                          <div class={styles.inlineGroup}>
                            <input
                              class={styles.input}
                              type="date"
                              value={current().criteria.dateFrom ?? ''}
                              onInput={(e) => {
                                patchCriteria({ dateFrom: e.currentTarget.value || null })
                              }}
                            />
                            <input
                              class={styles.input}
                              type="date"
                              value={current().criteria.dateTo ?? ''}
                              onInput={(e) => {
                                patchCriteria({ dateTo: e.currentTarget.value || null })
                              }}
                            />
                          </div>
                        </label>
                      </div>
                    </section>

                    <section class={styles.editorSection}>
                      <h4 class={styles.editorSectionTitle}>Narrow by type, category or account</h4>
                      <div class={styles.field}>
                        <span class={styles.fieldLabel}>Transaction types</span>
                        <div class={styles.chipRow}>
                          <For each={TX_TYPES}>
                            {(type) => (
                              <button
                                type="button"
                                class={`${styles.chip} ${current().criteria.types.includes(type.value) ? styles.chipActive : ''}`}
                                onClick={() => {
                                  patchCriteria({
                                    types: current().criteria.types.includes(type.value)
                                      ? current().criteria.types.filter((t) => t !== type.value)
                                      : [...current().criteria.types, type.value],
                                  })
                                }}
                              >
                                {type.label}
                              </button>
                            )}
                          </For>
                        </div>
                      </div>

                      <div class={styles.field}>
                        <span class={styles.fieldLabel}>Categories</span>
                        <div class={styles.chipRow}>
                          <For each={categories()}>
                            {(cat) => (
                              <button
                                type="button"
                                class={`${styles.chip} ${current().criteria.categoryIds.includes(cat.id) ? styles.chipActive : ''}`}
                                onClick={() => {
                                  patchCriteria({
                                    categoryIds: toggleInList(
                                      current().criteria.categoryIds,
                                      cat.id
                                    ),
                                  })
                                }}
                              >
                                <span class={styles.chipDot} style={{ background: cat.color }} />
                                {cat.name}
                              </button>
                            )}
                          </For>
                        </div>
                      </div>

                      <div class={styles.field}>
                        <span class={styles.fieldLabel}>Accounts</span>
                        <div class={styles.chipRow}>
                          <For each={accounts()}>
                            {(acct) => (
                              <button
                                type="button"
                                class={`${styles.chip} ${current().criteria.accountIds.includes(acct.id) ? styles.chipActive : ''}`}
                                onClick={() => {
                                  patchCriteria({
                                    accountIds: toggleInList(
                                      current().criteria.accountIds,
                                      acct.id
                                    ),
                                  })
                                }}
                              >
                                {acct.name}
                              </button>
                            )}
                          </For>
                        </div>
                      </div>
                    </section>

                    <p class={styles.ruleSummary}>{describeTagRuleCriteria(current().criteria)}</p>

                    <Show when={preview()}>
                      {(result) => (
                        <div class={styles.previewBox} data-test-id="tag-rule-preview">
                          <strong>
                            {result().matched} matching transaction
                            {result().matched === 1 ? '' : 's'} — {result().new_matches} would be
                            newly tagged
                          </strong>
                          <Show when={result().truncated}>
                            <span class={styles.warning}>
                              Only the most recent {result().scanned.toLocaleString()} transactions
                              were scanned.
                            </span>
                          </Show>

                          {/* Under AND a single unsatisfied condition zeroes the whole result, and
                              nothing on screen says which one — most often a category or account
                              chip left selected from an earlier edit. Break the count down per
                              condition so the culprit is the row reading 0. */}
                          <Show
                            when={
                              result().matched === 0 &&
                              current().criteria.match === 'all' &&
                              (result().conditions?.length ?? 0) > 1
                            }
                          >
                            <div class={styles.conditionBreakdown} data-test-id="tag-rule-why">
                              <span class={styles.conditionHint}>
                                Every condition must match (AND). On its own, each matched:
                              </span>
                              <ul class={styles.conditionList}>
                                <For each={result().conditions}>
                                  {(condition) => (
                                    <li
                                      class={
                                        condition.matched === 0 ? styles.conditionZero : undefined
                                      }
                                    >
                                      <span class={styles.conditionLabel}>{condition.label}</span>
                                      <span class={styles.conditionCount}>
                                        {condition.matched}
                                        {condition.matched === 0 ? ' ← blocks the rule' : ''}
                                      </span>
                                    </li>
                                  )}
                                </For>
                              </ul>
                            </div>
                          </Show>

                          <Show when={result().sample.length > 0}>
                            <ul class={styles.sampleList}>
                              <For each={result().sample}>
                                {(row) => (
                                  <li>
                                    <span class={styles.sampleDate}>{row.date}</span>
                                    <span class={styles.sampleDesc}>{row.description}</span>
                                    <span class={styles.sampleAmount}>
                                      {formatCurrency(row.amount)}
                                    </span>
                                  </li>
                                )}
                              </For>
                            </ul>
                          </Show>
                        </div>
                      )}
                    </Show>

                    <div class={styles.editorActions}>
                      <button
                        class={styles.secondaryButton}
                        type="button"
                        disabled={previewing()}
                        onClick={() => void runPreview()}
                      >
                        {previewing() ? 'Checking…' : 'Preview matches'}
                      </button>
                      <button
                        class={styles.secondaryButton}
                        type="button"
                        disabled={applying()}
                        onClick={() => void applyRules(true)}
                      >
                        {applying() ? 'Applying…' : 'Apply to existing transactions'}
                      </button>
                      <button
                        class={styles.primaryButton}
                        type="button"
                        onClick={() => void saveRule()}
                      >
                        {current().id === null ? 'Save rule' : 'Update rule'}
                      </button>
                      <button
                        class={styles.ghostButton}
                        type="button"
                        onClick={() => {
                          setDraft(null)
                          setPreview(null)
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </Show>
            </div>
          </>
        )}
      </Show>
    </div>
  )
}
