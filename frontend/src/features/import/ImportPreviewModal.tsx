/**
 * Modal shell around the shared ImportPreviewStep, used by Connected Sources' "Fetch & preview".
 * The step is rendered `embedded` (its in-body execute buttons hidden) so this footer owns the
 * single set of import actions. Everything else — the selection table, dedup flags, dry-run
 * verdict, date filter — is the exact same component the Import page uses.
 */
import { onCleanup, onMount, Show } from 'solid-js'
import importStyles from '../Import.module.css'
import styles from './ImportPreviewModal.module.css'
import { ImportPreviewStep } from './ImportPreviewStep'
import type { ImportFlow } from './importFlow'

export function ImportPreviewModal(props: {
  flow: ImportFlow
  isOpen: () => boolean
  title: string
  subtitle?: string
  onClose: () => void
}) {
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && props.isOpen()) props.onClose()
  }
  onMount(() => {
    document.addEventListener('keydown', onKey)
    onCleanup(() => {
      document.removeEventListener('keydown', onKey)
    })
  })

  const selected = () => props.flow.selectedRows().size
  const duplicates = () => props.flow.duplicateIndices().length

  return (
    <Show when={props.isOpen()}>
      <div
        class={styles.overlay}
        onClick={(e) => {
          if (e.target === e.currentTarget) props.onClose()
        }}
      >
        <div class={styles.modal} role="dialog" aria-modal="true" aria-label={props.title}>
          <div class={styles.header}>
            <h2 class={styles.title}>
              {props.title}
              <Show when={props.subtitle}>
                <span class={styles.subtitle}>{props.subtitle}</span>
              </Show>
            </h2>
            <button
              class={styles.close}
              type="button"
              aria-label="Close preview"
              onClick={props.onClose}
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div class={styles.content}>
            <ImportPreviewStep flow={props.flow} embedded />
          </div>

          <div class={styles.footer}>
            <button
              class={`${importStyles.btn} ${importStyles.btnGhost}`}
              type="button"
              onClick={props.onClose}
              disabled={props.flow.loading()}
            >
              Cancel
            </button>
            <Show when={duplicates() > 0}>
              <button
                class={`${importStyles.btn} ${importStyles.btnSecondary}`}
                type="button"
                disabled={props.flow.loading()}
                onClick={() => void props.flow.handleImport('new')}
              >
                Import only new
              </button>
            </Show>
            <button
              class={`${importStyles.btn} ${importStyles.btnOutline}`}
              type="button"
              disabled={props.flow.loading()}
              onClick={() => void props.flow.handleImport('all')}
            >
              Import all
            </button>
            <button
              class={`${importStyles.btn} ${importStyles.btnPrimary}`}
              type="button"
              disabled={props.flow.loading() || selected() === 0}
              onClick={() => void props.flow.handleImport('selected')}
            >
              Import selected ({selected()})
            </button>
          </div>
        </div>
      </div>
    </Show>
  )
}
