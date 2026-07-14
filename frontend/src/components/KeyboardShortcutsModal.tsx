/**
 * KeyboardShortcutsModal — a quick reference for the app's keyboard shortcuts.
 * Opened by the "?" key (App.tsx) or from Settings → About. Mirrors the
 * ChangelogModal overlay pattern; closes on backdrop click, the X, or Esc.
 */
import { For, onCleanup, onMount } from 'solid-js'
import styles from './KeyboardShortcutsModal.module.css'

interface Shortcut {
  combos: string[][] // each inner array is one chord ("Ctrl","K"); multiple = "or"
  label: string
}
interface Group {
  title: string
  shortcuts: Shortcut[]
}

// Show ⌘ on Apple platforms, Ctrl elsewhere. The handlers themselves accept both
// (Ctrl or Cmd); this only affects the label.
const IS_APPLE =
  typeof window !== 'undefined' && /Mac|iPhone|iPad|iPod/i.test(window.navigator.userAgent)
const MOD = IS_APPLE ? '⌘' : 'Ctrl'

const GROUPS: Group[] = [
  {
    title: 'General',
    shortcuts: [
      { combos: [[MOD, 'K']], label: 'Open the command bar — add a transaction or jump anywhere' },
      { combos: [['?']], label: 'Show this shortcuts guide' },
      { combos: [['Esc']], label: 'Close a dialog' },
    ],
  },
  {
    title: 'Navigation',
    shortcuts: [
      {
        combos: [['←'], ['→']],
        label: 'Previous / next period (month, range, or year) — on any page',
      },
    ],
  },
  {
    title: 'Command bar',
    shortcuts: [
      { combos: [['↑'], ['↓']], label: 'Move the selection' },
      { combos: [['Enter']], label: 'Run the selected action' },
    ],
  },
]

function Keys(props: { combos: string[][] }) {
  return (
    <span class={styles.keys}>
      <For each={props.combos}>
        {(combo, i) => (
          <>
            {i() > 0 && <span class={styles.or}>or</span>}
            <For each={combo}>
              {(token, j) => (
                <>
                  {j() > 0 && <span class={styles.plus}>+</span>}
                  <kbd class={styles.kbd}>{token}</kbd>
                </>
              )}
            </For>
          </>
        )}
      </For>
    </span>
  )
}

export default function KeyboardShortcutsModal(props: { onClose: () => void }) {
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose()
    }
    document.addEventListener('keydown', onKey)
    onCleanup(() => {
      document.removeEventListener('keydown', onKey)
    })
  })

  return (
    <div class={styles.overlay} onClick={props.onClose}>
      <div
        class={styles.modal}
        role="dialog"
        aria-label="Keyboard shortcuts"
        data-test-id="shortcuts-modal"
        onClick={(e) => {
          e.stopPropagation()
        }}
      >
        <div class={styles.header}>
          <h2 data-test-id="shortcuts-title">Keyboard shortcuts</h2>
          <button class={styles.closeBtn} onClick={props.onClose} aria-label="Close">
            <svg
              width="20"
              height="20"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              viewBox="0 0 24 24"
            >
              <path d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div class={styles.body}>
          <For each={GROUPS}>
            {(group) => (
              <div class={styles.group}>
                <h4 class={styles.groupTitle}>{group.title}</h4>
                <For each={group.shortcuts}>
                  {(s) => (
                    <div class={styles.row}>
                      <Keys combos={s.combos} />
                      <span class={styles.label}>{s.label}</span>
                    </div>
                  )}
                </For>
              </div>
            )}
          </For>
          <p class={styles.footnote}>
            <kbd class={styles.kbd}>{MOD}</kbd>
            <span class={styles.plus}>+</span>
            <kbd class={styles.kbd}>Shift</kbd>
            <span class={styles.plus}>+</span>
            <kbd class={styles.kbd}>T</kbd> also opens the command bar, but most browsers reserve it
            (reopen last tab) — prefer <kbd class={styles.kbd}>{MOD}</kbd>
            <span class={styles.plus}>+</span>
            <kbd class={styles.kbd}>K</kbd>.
          </p>
        </div>
      </div>
    </div>
  )
}
