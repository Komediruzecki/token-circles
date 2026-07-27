/**
 * Connected Sources — saved, re-runnable import origins on the Import page. v1 covers a saved
 * Google-Sheet link with two actions per row:
 *   • Auto sync    — headless fetch → apply the saved (by-header) mapping → import only new rows
 *                    (execute-side dedup skips anything already imported, so it's safe to re-run).
 *   • Fetch & preview — fetch → open the existing ImportPreviewStep in a modal to confirm/skip.
 *
 * It owns one hidden import flow (createImportFlow) and drives it; nothing is rebuilt — mapping,
 * preview, dedup and the execute path are the same code the Import page uses.
 */
import { createSignal, For, onMount, Show } from 'solid-js'
import { showConfirm } from '../../core/confirmStore'
import { autoDetectMapping, mappingToHeaderNames } from '../../core/importMapping'
import {
  createImportSource,
  deleteImportSource,
  listImportSources,
  parseSheetUrl,
  updateImportSource,
} from '../../core/importSources'
import { getStorageMode } from '../../core/storage/storageFactory'
import { addToast } from '../../core/toastStore'
import importStyles from '../Import.module.css'
import styles from './ConnectedSources.module.css'
import { createImportFlow } from './importFlow'
import { ImportPreviewModal } from './ImportPreviewModal'
import type { ImportSource } from '../../core/importSources'

export function ConnectedSources() {
  const [sources, setSources] = createSignal<ImportSource[]>([])
  const [showAdd, setShowAdd] = createSignal(false)
  const [newUrl, setNewUrl] = createSignal('')
  const [newLabel, setNewLabel] = createSignal('')
  const [adding, setAdding] = createSignal(false)
  const [busy, setBusy] = createSignal<{ id: number; action: 'sync' | 'preview' } | null>(null)
  const [previewOpen, setPreviewOpen] = createSignal(false)
  const [activeSource, setActiveSource] = createSignal<ImportSource | null>(null)
  // The daily auto-sync runs on the Worker cron, so only offer it in self-hosted / cloud mode.
  const canSchedule = getStorageMode() !== 'serverless'

  // A hidden flow this section drives. autoResetAfterImport off so we control the modal lifecycle.
  const flow = createImportFlow({
    autoResetAfterImport: false,
    onImported: (summary) => {
      const src = activeSource()
      if (src) {
        const now = new Date().toISOString()
        void updateImportSource(src.id, { last_synced_at: now })
        setSources((list) => list.map((s) => (s.id === src.id ? { ...s, last_synced_at: now } : s)))
      }
      setPreviewOpen(false)
      const text =
        summary.imported > 0
          ? `${summary.imported} imported${summary.duplicatesSkipped ? ` · ${summary.duplicatesSkipped} skipped` : ''}`
          : summary.duplicatesSkipped
            ? `Nothing new — ${summary.duplicatesSkipped} already imported`
            : 'Nothing new to import'
      addToast(text, summary.imported > 0 ? 'success' : 'info')
    },
  })

  onMount(() => void refresh())

  async function refresh() {
    setSources(await listImportSources())
  }

  function prime(src: ImportSource) {
    flow.resetForm()
    flow.setActiveImportTab('google-sheets')
    flow.setSheetUrl(src.config?.url ?? '')
    flow.setSelectedSheet(src.config?.sheetName ?? '')
  }

  async function autoSync(src: ImportSource) {
    if (busy()) return
    setBusy({ id: src.id, action: 'sync' })
    setActiveSource(src)
    prime(src)
    const ok = await flow.fetchGoogleSheet({ navigate: false })
    if (!ok) {
      addToast(flow.error() ?? 'Could not fetch that sheet', 'error')
      setBusy(null)
      return
    }
    flow.applySavedMapping(src.mapping ?? undefined, src.category_types ?? undefined)
    // 'all' → send every row; the execute-side dedup skips anything already imported, so a
    // re-sync of a growing ledger only lands genuinely new rows and never duplicates.
    await flow.handleImport('all')
    setBusy(null)
  }

  async function preview(src: ImportSource) {
    if (busy()) return
    setBusy({ id: src.id, action: 'preview' })
    setActiveSource(src)
    prime(src)
    const ok = await flow.fetchGoogleSheet({ navigate: false })
    if (!ok) {
      addToast(flow.error() ?? 'Could not fetch that sheet', 'error')
      setBusy(null)
      return
    }
    flow.applySavedMapping(src.mapping ?? undefined, src.category_types ?? undefined)
    await flow.goToPreview()
    setBusy(null)
    setPreviewOpen(true)
  }

  async function addSource() {
    const url = newUrl().trim()
    if (!url || adding()) return
    setAdding(true)
    flow.resetForm()
    flow.setActiveImportTab('google-sheets')
    flow.setSheetUrl(url)
    flow.setSelectedSheet('')
    const ok = await flow.fetchGoogleSheet({ navigate: false })
    if (!ok) {
      addToast(
        flow.error() ?? 'Could not fetch that sheet — make sure it is shared or published',
        'error'
      )
      setAdding(false)
      return
    }
    const headers = flow.currentHeaders()
    // Remember the mapping BY HEADER NAME so it survives the sheet owner reordering columns.
    const mapping = mappingToHeaderNames(autoDetectMapping(headers), headers)
    const label = newLabel().trim() || flow.selectedSheet() || 'Google Sheet'
    const created = await createImportSource({
      kind: 'google_sheet',
      label,
      config: { url, sheetName: flow.selectedSheet() || '' },
      mapping,
      schedule: 'manual',
    })
    setAdding(false)
    if (!created) {
      addToast('Could not save the source', 'error')
      return
    }
    setSources((s) => [created, ...s])
    setNewUrl('')
    setNewLabel('')
    setShowAdd(false)
    addToast('Sheet saved', 'success')
  }

  async function removeSource(src: ImportSource) {
    const ok = await showConfirm(
      `Remove "${src.label}"? This deletes only the saved link — your imported transactions stay.`,
      { danger: true, confirmText: 'Remove' }
    )
    if (!ok) return
    if (!(await deleteImportSource(src.id))) {
      addToast('Could not remove the source', 'error')
      return
    }
    setSources((list) => list.filter((s) => s.id !== src.id))
    addToast('Source removed', 'success')
  }

  async function toggleSchedule(src: ImportSource) {
    const next: ImportSource['schedule'] = src.schedule === 'daily' ? 'manual' : 'daily'
    const updated = await updateImportSource(src.id, { schedule: next })
    if (!updated) {
      addToast('Could not change the schedule', 'error')
      return
    }
    setSources((list) => list.map((s) => (s.id === src.id ? { ...s, schedule: next } : s)))
    addToast(
      next === 'daily' ? 'This sheet will auto-sync daily' : 'Daily auto-sync turned off',
      'success'
    )
  }

  const relTime = (iso?: string | null): string => {
    if (!iso) return 'never synced'
    const then = new Date(iso).getTime()
    if (Number.isNaN(then)) return 'never synced'
    const s = Math.max(0, Math.round((Date.now() - then) / 1000))
    if (s < 60) return 'synced just now'
    const m = Math.round(s / 60)
    if (m < 60) return `synced ${m}m ago`
    const h = Math.round(m / 60)
    if (h < 24) return `synced ${h}h ago`
    return `synced ${Math.round(h / 24)}d ago`
  }

  const sheetMeta = (src: ImportSource): string => {
    const { id, gid } = parseSheetUrl(src.config?.url ?? '')
    const idShort = id ? `${id.slice(0, 6)}…` : 'sheet'
    return `${idShort}${gid ? ` · gid ${gid}` : ''} · ${relTime(src.last_synced_at)}`
  }

  const isSyncing = (id: number) => busy()?.id === id && busy()?.action === 'sync'

  return (
    <div class={styles.section}>
      <div class={styles.head}>
        <h2 class={styles.title}>
          <span class={styles.kickerDot} aria-hidden="true" />
          Connected sources
        </h2>
        <Show when={!showAdd()}>
          <button class={styles.addBtn} type="button" onClick={() => setShowAdd(true)}>
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              aria-hidden="true"
            >
              <path stroke-linecap="round" d="M12 5v14M5 12h14" />
            </svg>
            Add a sheet
          </button>
        </Show>
      </div>

      <Show when={showAdd()}>
        <div class={styles.addForm}>
          <div class={styles.addRow}>
            <input
              class={styles.input}
              placeholder="Google Sheets link (shared or published)"
              value={newUrl()}
              onInput={(e) => setNewUrl(e.currentTarget.value)}
            />
            <input
              class={styles.input}
              style={{ 'max-width': '220px', flex: '0 1 220px' }}
              placeholder="Label (optional)"
              value={newLabel()}
              onInput={(e) => setNewLabel(e.currentTarget.value)}
            />
          </div>
          <p class={styles.hint}>
            The sheet must be shared as "anyone with the link can view" (or File &rarr; Share &rarr;
            Publish). We fetch it once to remember its columns.
          </p>
          <div class={styles.addActions}>
            <button
              class={`${importStyles.btn} ${importStyles.btnGhost} ${importStyles.btnSm}`}
              type="button"
              disabled={adding()}
              onClick={() => {
                setShowAdd(false)
                setNewUrl('')
                setNewLabel('')
              }}
            >
              Cancel
            </button>
            <button
              class={`${importStyles.btn} ${importStyles.btnPrimary} ${importStyles.btnSm}`}
              type="button"
              disabled={adding() || !newUrl().trim()}
              onClick={() => void addSource()}
            >
              {adding() ? 'Saving…' : 'Save sheet'}
            </button>
          </div>
        </div>
      </Show>

      <Show
        when={sources().length > 0}
        fallback={
          <Show when={!showAdd()}>
            <div class={styles.list}>
              <div class={styles.empty}>
                No saved sheets yet. Add a Google Sheets link to sync it with one click.
              </div>
            </div>
          </Show>
        }
      >
        <div class={styles.list}>
          <For each={sources()}>
            {(src) => (
              <div class={styles.row}>
                <div class={styles.glyph} aria-hidden="true">
                  <svg
                    width="21"
                    height="21"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.7"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <rect x="4" y="3" width="16" height="18" rx="2.5" />
                    <path d="M4 9h16M4 15h16M10 3v18" />
                  </svg>
                </div>
                <div class={styles.meta}>
                  <div class={styles.name}>
                    {src.label}
                    <Show when={src.last_synced_at}>
                      <span class={styles.live} title="synced" aria-hidden="true" />
                    </Show>
                  </div>
                  <div class={styles.sub}>{sheetMeta(src)}</div>
                </div>

                <Show when={canSchedule}>
                  <button
                    class={styles.schedulePill}
                    classList={{ [styles.on]: src.schedule === 'daily' }}
                    type="button"
                    disabled={busy() !== null}
                    aria-pressed={src.schedule === 'daily' ? 'true' : 'false'}
                    title="Auto-sync this sheet once a day on the server"
                    onClick={() => void toggleSchedule(src)}
                  >
                    <span class={styles.dot} aria-hidden="true" />
                    Daily
                  </button>
                </Show>

                <div class={styles.capsule} role="group" aria-label={`Actions for ${src.label}`}>
                  <button
                    class={`${styles.btn} ${styles.sync}`}
                    classList={{ [styles.spin]: isSyncing(src.id) }}
                    type="button"
                    disabled={busy() !== null}
                    aria-label={`Auto sync ${src.label}`}
                    onClick={() => void autoSync(src)}
                  >
                    <svg
                      class={styles.ring}
                      width="17"
                      height="17"
                      viewBox="0 0 24 24"
                      fill="none"
                      aria-hidden="true"
                    >
                      <circle
                        cx="12"
                        cy="12"
                        r="8.5"
                        stroke="rgba(238,244,255,.35)"
                        stroke-width="1.6"
                      />
                      <path
                        d="M12 3.5a8.5 8.5 0 0 1 8.5 8.5"
                        stroke="#eef4ff"
                        stroke-width="1.9"
                        stroke-linecap="round"
                      />
                      <path
                        d="M20.5 12l2.2-2.6M20.5 12l-2.7-2"
                        stroke="#eef4ff"
                        stroke-width="1.9"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      />
                      <circle cx="12" cy="12" r="1.7" fill="#eef4ff" />
                    </svg>
                    {isSyncing(src.id) ? 'Syncing…' : 'Auto sync'}
                  </button>
                  <span class={styles.divide} />
                  <button
                    class={`${styles.btn} ${styles.prev}`}
                    type="button"
                    disabled={busy() !== null}
                    aria-label={`Fetch and preview ${src.label}`}
                    onClick={() => void preview(src)}
                  >
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <rect
                        x="3.5"
                        y="4"
                        width="17"
                        height="16"
                        rx="2.5"
                        stroke="currentColor"
                        stroke-width="1.5"
                      />
                      <path d="M3.5 9.2h17" stroke="currentColor" stroke-width="1.3" />
                      <path
                        class={styles.scan}
                        d="M6 13h9M6 16h6"
                        stroke="currentColor"
                        stroke-width="1.6"
                        stroke-linecap="round"
                      />
                    </svg>
                    Preview
                  </button>
                </div>

                <button
                  class={styles.rowDelete}
                  type="button"
                  aria-label={`Remove ${src.label}`}
                  disabled={busy() !== null}
                  onClick={() => void removeSource(src)}
                >
                  <svg
                    width="17"
                    height="17"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.7"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path d="M4 7h16M10 11v6M14 11v6M5 7l1 13a2 2 0 002 2h8a2 2 0 002-2l1-13M9 7V4h6v3" />
                  </svg>
                </button>
              </div>
            )}
          </For>
        </div>
      </Show>

      <ImportPreviewModal
        flow={flow}
        isOpen={previewOpen}
        title="Preview import"
        subtitle={activeSource()?.label}
        onClose={() => setPreviewOpen(false)}
      />
    </div>
  )
}
