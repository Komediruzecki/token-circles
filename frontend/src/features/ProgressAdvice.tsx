/**
 * The "Worth a look" cards on Progress. A long history can raise many at once, so the list shows
 * the first ADVICE_SHOWN, most useful first, and a button in the same container shows the rest.
 * Dismissing a card lets the next one move up: the list is always the first cards of what is left.
 */
import { createMemo, createSignal, createUniqueId, For, Show } from 'solid-js'
import styles from './ProgressPage.module.css'
import type { JSX } from 'solid-js'
import type { AdviceCard } from '../core/achievements/advice'

export const ADVICE_SHOWN = 3

const IconDismiss = (): JSX.Element => (
  <svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true">
    <path
      d="M5 5l10 10M15 5L5 15"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      fill="none"
    />
  </svg>
)

export default function AdviceList(props: {
  cards: AdviceCard[]
  onOpen: (page: string) => void
  onDismiss: (id: string) => void
}): JSX.Element {
  const listId = `advice-list-${createUniqueId()}`
  const [open, setOpen] = createSignal(false)
  const hidden = () => Math.max(0, props.cards.length - ADVICE_SHOWN)
  const shown = createMemo(() => (open() ? props.cards : props.cards.slice(0, ADVICE_SHOWN)))

  return (
    <div class={styles.adviceList}>
      <ul class={styles.advice} id={listId}>
        <For each={shown()}>
          {(card) => (
            <li class={styles.adviceCard} data-tone={card.tone} data-advice-card>
              <div class={styles.adviceBody}>
                <div class={styles.adviceTitle} data-advice-title>
                  {card.title}
                </div>
                <p class={styles.adviceDetail}>{card.detail}</p>
                <div class={styles.adviceFoot}>
                  <span class={styles.figure}>{card.figure}</span>
                  <Show when={card.link}>
                    {(link) => (
                      <button
                        type="button"
                        class={styles.ghost}
                        onClick={() => {
                          props.onOpen(link().page)
                        }}
                      >
                        {link().label}
                      </button>
                    )}
                  </Show>
                </div>
              </div>
              <button
                type="button"
                class={styles.dismiss}
                aria-label={`Dismiss: ${card.title}`}
                onClick={() => {
                  props.onDismiss(card.id)
                }}
              >
                <IconDismiss />
              </button>
            </li>
          )}
        </For>
      </ul>
      <Show when={hidden() > 0}>
        <button
          type="button"
          class={styles.adviceToggle}
          data-test-id="advice-toggle"
          aria-expanded={open() ? 'true' : 'false'}
          aria-controls={listId}
          onClick={() => setOpen((o) => !o)}
        >
          {open() ? 'Show fewer' : `Show ${hidden()} more`}
        </button>
      </Show>
    </div>
  )
}
