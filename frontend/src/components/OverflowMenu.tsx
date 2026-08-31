/**
 * OverflowMenu — a "…" trigger opening a small action menu, for cards whose secondary actions
 * would otherwise crowd the layout. The menu is portalled to <body> and positioned from the
 * trigger's rect: cards routinely clip (`overflow: hidden` for accent stripes) and glass panels
 * carry a backdrop-filter, either of which would trap an in-card dropdown.
 *
 * Closes on select, Escape (focus returns to the trigger), a press outside, scroll and resize.
 */
import { createEffect, createSignal, For, onCleanup, Show } from 'solid-js'
import { Portal } from 'solid-js/web'
import styles from './OverflowMenu.module.css'
import type { JSX } from 'solid-js'

export interface OverflowMenuItem {
  label: string
  icon?: () => JSX.Element
  /** Renders in the danger tone (destructive actions). */
  danger?: boolean
  onSelect: () => void
}

interface OverflowMenuProps {
  /** Accessible name for the trigger, e.g. "More actions for Netflix". */
  label: string
  items: OverflowMenuItem[]
  class?: string
}

export default function OverflowMenu(props: OverflowMenuProps) {
  const [open, setOpen] = createSignal(false)
  const [anchor, setAnchor] = createSignal({ top: 0, right: 0 })
  let triggerEl: HTMLButtonElement | undefined
  let menuEl: HTMLDivElement | undefined

  const close = () => setOpen(false)

  const toggle = () => {
    if (open()) {
      close()
      return
    }
    const rect = triggerEl!.getBoundingClientRect()
    // Right-align the menu to the trigger; `right` avoids measuring the menu's own width.
    setAnchor({ top: rect.bottom + 6, right: window.innerWidth - rect.right })
    setOpen(true)
  }

  createEffect(() => {
    if (!open()) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close()
        triggerEl?.focus()
      }
    }
    const onPress = (e: MouseEvent) => {
      const t = e.target as Node
      if (menuEl?.contains(t) || triggerEl?.contains(t)) return
      close()
    }
    // Any scroll leaves the fixed-position menu floating away from its card — just close.
    const onScroll = () => close()
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onPress)
    window.addEventListener('scroll', onScroll, { capture: true, passive: true })
    window.addEventListener('resize', onScroll)
    onCleanup(() => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onPress)
      window.removeEventListener('scroll', onScroll, { capture: true })
      window.removeEventListener('resize', onScroll)
    })
  })

  return (
    <>
      <button
        ref={triggerEl}
        type="button"
        class={`${styles.trigger}${props.class ? ` ${props.class}` : ''}`}
        aria-label={props.label}
        aria-haspopup="menu"
        aria-expanded={open() ? 'true' : 'false'}
        data-test-id="sub-menu-btn"
        onClick={toggle}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="1.7" />
          <circle cx="12" cy="12" r="1.7" />
          <circle cx="19" cy="12" r="1.7" />
        </svg>
      </button>
      <Show when={open()}>
        <Portal>
          <div
            ref={menuEl}
            class={styles.menu}
            role="menu"
            aria-label={props.label}
            data-test-id="overflow-menu"
            style={{ top: `${anchor().top}px`, right: `${anchor().right}px` }}
          >
            <For each={props.items}>
              {(item) => (
                <button
                  type="button"
                  role="menuitem"
                  class={`${styles.item}${item.danger ? ` ${styles.danger}` : ''}`}
                  onClick={() => {
                    close()
                    item.onSelect()
                  }}
                >
                  <Show when={item.icon}>
                    {(icon) => <span class={styles.icon}>{icon()()}</span>}
                  </Show>
                  {item.label}
                </button>
              )}
            </For>
          </div>
        </Portal>
      </Show>
    </>
  )
}
