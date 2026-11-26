/**
 * OverflowMenu — a "…" trigger opening a small action menu, for cards whose secondary actions
 * would otherwise crowd the layout. The menu is portalled to <body> and positioned from the
 * trigger's rect: cards routinely clip (`overflow: hidden` for accent stripes) and glass panels
 * carry a backdrop-filter, either of which would trap an in-card dropdown.
 *
 * It follows the WAI-ARIA menu button pattern, because the portal takes the menu out of the tab
 * order: opening puts focus on the first item (ArrowUp on the trigger, on the last), the arrows,
 * Home and End move through the items, and Escape or Tab put focus back on the trigger, which Tab
 * then moves on from. An item picked closes the menu and returns focus to the trigger before it
 * runs, so whatever it opens can take focus from there. A menu with no room under the trigger
 * opens above it.
 *
 * Closes on select, Escape, Tab, a press outside, a resize, and a scroll that moves the trigger.
 */
import { createEffect, createSignal, createUniqueId, For, onCleanup, Show } from 'solid-js'
import { Portal } from 'solid-js/web'
import styles from './OverflowMenu.module.css'
import type { JSX } from 'solid-js'

export interface OverflowMenuItem {
  label: string
  icon?: () => JSX.Element
  /** Renders in the danger tone (destructive actions). */
  danger?: boolean
  /** The item's data-test-id. */
  testId?: string
  onSelect: () => void
}

interface OverflowMenuProps {
  /** Accessible name for the trigger, e.g. "More actions for Netflix". */
  label: string
  items: OverflowMenuItem[]
  class?: string
  /** The trigger's data-test-id; the subscription card's when not given. */
  testId?: string
  /** The open menu's data-test-id. */
  menuTestId?: string
}

/** Room kept between the menu and the edge of the window. */
const EDGE = 8

export default function OverflowMenu(props: OverflowMenuProps) {
  const menuId = `overflow-menu-${createUniqueId()}`
  const [open, setOpen] = createSignal(false)
  const [anchor, setAnchor] = createSignal<{ top?: number; bottom?: number; right: number }>({
    top: 0,
    right: 0,
  })
  let triggerEl: HTMLButtonElement | undefined
  let menuEl: HTMLDivElement | undefined
  /** Where the trigger was when the menu opened. */
  let openedAt = { top: 0, left: 0 }

  const items = () => Array.from(menuEl?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])

  const focusItem = (index: number) => {
    const list = items()
    if (list.length === 0) return
    // preventScroll: any scroll closes the menu.
    list[(index + list.length) % list.length].focus({ preventScroll: true })
  }

  const close = (refocus = false) => {
    setOpen(false)
    if (refocus) triggerEl?.focus({ preventScroll: true })
  }

  /** Open under the trigger, or above it when the window has no room below, on an item. */
  const openAt = (item: 'first' | 'last') => {
    const rect = triggerEl!.getBoundingClientRect()
    openedAt = { top: rect.top, left: rect.left }
    // Right-align the menu to the trigger; `right` avoids measuring the menu's own width.
    const right = window.innerWidth - rect.right
    setAnchor({ top: rect.bottom + 6, right })
    setOpen(true)
    const height = menuEl?.offsetHeight ?? 0
    if (rect.bottom + 6 + height > window.innerHeight - EDGE && rect.top - 6 - height >= EDGE) {
      setAnchor({ bottom: window.innerHeight - rect.top + 6, right })
    }
    focusItem(item === 'first' ? 0 : -1)
  }

  const toggle = () => {
    if (open()) close()
    else openAt('first')
  }

  const onTriggerKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    openAt(e.key === 'ArrowDown' ? 'first' : 'last')
  }

  const onMenuKey = (e: KeyboardEvent) => {
    const list = items()
    const at = list.indexOf(document.activeElement as HTMLElement)
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        focusItem(at + 1)
        break
      case 'ArrowUp':
        e.preventDefault()
        focusItem(at < 0 ? -1 : at - 1)
        break
      case 'Home':
        e.preventDefault()
        focusItem(0)
        break
      case 'End':
        e.preventDefault()
        focusItem(-1)
        break
      case 'Tab':
        // Not prevented: focus goes back to the trigger first, so the browser's own Tab moves on
        // from there instead of off the end of the page, where the portal sits.
        close(true)
        break
    }
  }

  createEffect(() => {
    if (!open()) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Handled, so a listener that runs after this one can tell.
        e.preventDefault()
        close(true)
      }
    }
    const onPress = (e: MouseEvent) => {
      const t = e.target as Node
      if (menuEl?.contains(t) || triggerEl?.contains(t)) return
      close()
    }
    // A scroll that moves the trigger would leave the fixed-position menu floating away from its
    // card, so it closes. Scroll events come a frame late, though: the one for a scroll that came
    // with the press that opened the menu arrives after it opened, and closed it before anyone saw
    // it (seen on a phone-sized page when the page scrolled to the trigger as it was pressed). So
    // only a trigger that has moved since the menu opened closes it.
    const onScroll = () => {
      const rect = triggerEl?.getBoundingClientRect()
      if (
        !rect ||
        Math.abs(rect.top - openedAt.top) > 1 ||
        Math.abs(rect.left - openedAt.left) > 1
      ) {
        close()
      }
    }
    const onResize = () => {
      close()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onPress)
    window.addEventListener('scroll', onScroll, { capture: true, passive: true })
    window.addEventListener('resize', onResize)
    onCleanup(() => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onPress)
      window.removeEventListener('scroll', onScroll, { capture: true })
      window.removeEventListener('resize', onResize)
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
        aria-controls={open() ? menuId : undefined}
        data-test-id={props.testId ?? 'sub-menu-btn'}
        onClick={toggle}
        onKeyDown={onTriggerKey}
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
            id={menuId}
            class={styles.menu}
            role="menu"
            aria-label={props.label}
            data-test-id={props.menuTestId ?? 'overflow-menu'}
            style={{
              top: anchor().top === undefined ? undefined : `${anchor().top}px`,
              bottom: anchor().bottom === undefined ? undefined : `${anchor().bottom}px`,
              right: `${anchor().right}px`,
            }}
            onKeyDown={onMenuKey}
          >
            <For each={props.items}>
              {(item) => (
                <button
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  class={`${styles.item}${item.danger ? ` ${styles.danger}` : ''}`}
                  data-test-id={item.testId}
                  onClick={() => {
                    close(true)
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
