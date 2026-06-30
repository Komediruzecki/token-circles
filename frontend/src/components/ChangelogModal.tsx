/**
 * ChangelogModal — renders the project CHANGELOG.md (Keep a Changelog format).
 *
 * The repo-root CHANGELOG.md is the single source of truth (also rendered on
 * GitHub). We import it via Vite's `?raw` loader and parse the
 * `## [version] — date` / `### Section` / `- item` structure once at module
 * load — no hardcoded duplicate to keep in sync.
 */
import { For, Show } from 'solid-js'
import rawChangelog from '../../../CHANGELOG.md?raw'
import styles from './ChangelogModal.module.css'
import type { JSX } from 'solid-js'

interface ChangelogSection {
  title: string
  items: string[]
}

interface ChangelogEntry {
  version: string
  date: string
  sections: ChangelogSection[]
}

// `## [5.1.2] — 2026-06-30`, `## [v1.0.0] - 2026-03-01`, or `## [Unreleased]`.
const VERSION_RE = /^##\s+\[([^\]]+)\]\s*(.*)$/
const SECTION_RE = /^###\s+(.+)$/
const ITEM_RE = /^[-*]\s+(.+)$/
// Strips the leading date separator (em-dash, en-dash, or hyphen) + spaces.
const DATE_LEAD_RE = /^[—–-]\s*/

function parseChangelog(md: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = []
  let entry: ChangelogEntry | null = null
  let section: ChangelogSection | null = null

  for (const line of md.split('\n')) {
    const versionMatch = line.match(VERSION_RE)
    if (versionMatch) {
      entry = {
        version: versionMatch[1].replace(/^v/, '').trim(),
        date: versionMatch[2].replace(DATE_LEAD_RE, '').trim(),
        sections: [],
      }
      entries.push(entry)
      section = null
      continue
    }
    if (!entry) continue

    const sectionMatch = line.match(SECTION_RE)
    if (sectionMatch) {
      section = { title: sectionMatch[1].trim(), items: [] }
      entry.sections.push(section)
      continue
    }

    const itemMatch = line.match(ITEM_RE)
    if (itemMatch && section) {
      section.items.push(itemMatch[1].trim())
    }
  }

  // The modal shows shipped releases only. "[Unreleased]" stays in the file
  // (Keep a Changelog convention) but is hidden here.
  return entries.filter((e) => e.version.toLowerCase() !== 'unreleased')
}

const CHANGELOG = parseChangelog(rawChangelog)

// Keep a Changelog section -> accent kind (drives the colored dot + label color).
const SECTION_KIND: Record<string, string> = {
  added: 'added',
  changed: 'changed',
  fixed: 'fixed',
  removed: 'removed',
  deprecated: 'deprecated',
  security: 'security',
}

function kindOf(title: string): string {
  return SECTION_KIND[title.toLowerCase()] ?? 'other'
}

// Inline Markdown: `code`, **bold**, _italic_.
const INLINE_RE = /(`[^`]+`|\*\*[^*]+\*\*|_[^_]+_)/

function renderInline(text: string): JSX.Element {
  return (
    <For each={text.split(INLINE_RE)}>
      {(part) => {
        if (part.startsWith('`') && part.endsWith('`')) {
          return <code class={styles.code}>{part.slice(1, -1)}</code>
        }
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong>{part.slice(2, -2)}</strong>
        }
        if (part.startsWith('_') && part.endsWith('_')) {
          return <em>{part.slice(1, -1)}</em>
        }
        return <>{part}</>
      }}
    </For>
  )
}

export default function ChangelogModal(props: { onClose: () => void }) {
  return (
    <div class={styles.overlay} onClick={props.onClose}>
      <div
        class={styles.modal}
        onClick={(e) => {
          e.stopPropagation()
        }}
      >
        <div class={styles.header}>
          <h2>Changelog</h2>
          <button class={styles.closeBtn} onClick={props.onClose} aria-label="Close changelog">
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
          <For each={CHANGELOG}>
            {(entry, i) => (
              <div class={styles.entry} data-latest={i() === 0 ? '' : undefined}>
                <div class={styles.versionHeader}>
                  <div class={styles.versionLeft}>
                    <span class={styles.version}>v{entry.version}</span>
                    <Show when={i() === 0}>
                      <span class={styles.latest}>Latest</span>
                    </Show>
                  </div>
                  <Show when={entry.date}>
                    <span class={styles.date}>{entry.date}</span>
                  </Show>
                </div>
                <For each={entry.sections}>
                  {(section) => (
                    <div class={styles.section}>
                      <h4 class={styles.sectionTitle} data-kind={kindOf(section.title)}>
                        <span class={styles.sectionDot} />
                        {section.title}
                      </h4>
                      <ul class={styles.list}>
                        <For each={section.items}>
                          {(item) => <li class={styles.item}>{renderInline(item)}</li>}
                        </For>
                      </ul>
                    </div>
                  )}
                </For>
              </div>
            )}
          </For>
        </div>
      </div>
    </div>
  )
}
