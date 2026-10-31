/**
 * The "Worth a look" cards on Progress. A long history can raise many at once, so the list shows
 * the first ADVICE_SHOWN, most useful first, and a button in the same container shows the rest.
 * Dismissing a card lets the next one move up: the list is always the first cards of what is left.
 * Focus follows the dismissal, so a keyboard user carries on from where the card was.
 *
 * Each card says which of the seven circles it counts toward, under its detail line, and that link
 * opens the circle's view.
 */
import { createEffect, createMemo, createSignal, createUniqueId, For, Show } from 'solid-js'
import { CIRCLE_NAMES } from '../../../shared/guidance/circles'
import { circleHash } from '../core/progressRoute'
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
  /** The last card went: the page moves focus to what replaces the list. */
  onEmpty?: () => void
}): JSX.Element {
  const listId = `advice-list-${createUniqueId()}`
  const [open, setOpen] = createSignal(false)
  const hidden = () => Math.max(0, props.cards.length - ADVICE_SHOWN)
  const shown = createMemo(() => (open() ? props.cards : props.cards.slice(0, ADVICE_SHOWN)))
  let list: HTMLUListElement | undefined
  let toggle: HTMLButtonElement | undefined

  // Open with nothing left to hide is no state at all: the next cards to arrive start folded.
  createEffect(() => {
    if (hidden() === 0) setOpen(false)
  })

  /**
   * After a dismissal the card's own button is gone, and focus would fall to the page. It goes to
   * the card now in that place, else the toggle, else the card before, else back to the page.
   */
  const dismiss = (id: string, index: number): void => {
    props.onDismiss(id)
    queueMicrotask(() => {
      // The page swaps the list out when it empties; a detached list's buttons cannot take focus.
      const buttons = list?.isConnected
        ? [...list.querySelectorAll<HTMLButtonElement>('[data-dismiss]')]
        : []
      const next =
        buttons[index] ?? (toggle?.isConnected ? toggle : undefined) ?? buttons[index - 1]
      if (next) next.focus()
      else props.onEmpty?.()
    })
  }

  return (
    <div class={styles.adviceList}>
      <ul class={styles.advice} id={listId} ref={list}>
        <For each={shown()}>
          {(card, index) => (
            <li class={styles.adviceCard} data-tone={card.tone} data-advice-card>
              <div class={styles.adviceBody}>
                <div class={styles.adviceTitle} data-advice-title>
                  {card.title}
                </div>
                <p class={styles.adviceDetail}>{card.detail}</p>
                <a
                  class={styles.why}
                  href={circleHash(card.circle)}
                  data-test-id="advice-why"
                  data-circle={card.circle}
                >
                  Counts toward {CIRCLE_NAMES[card.circle]}
                </a>
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
                data-dismiss
                aria-label={`Dismiss: ${card.title}`}
                onClick={() => {
                  dismiss(card.id, index())
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
          ref={toggle}
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
