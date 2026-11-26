/**
 * Focus for whatever opens over or into the page after it loaded: a dialog, or a form that opens
 * in place. Opening puts focus on its first field, or on the dialog itself when it has none, so a
 * keyboard and a screen reader start inside it. Shutting gives focus back to what had it before
 * (`returnFocus`).
 *
 * `autofocus` cannot do the first: the browser applies it only while a page loads, never to a node
 * put on the page later, so focus stayed on the button that opened the dialog, behind it.
 *
 * Two shapes:
 *  - `ref={dialogFocus}` on a dialog put on the page when it opens and taken off when it shuts
 *    (`<Show>`, `cond() && (...)`, an `<Index>` row). The ref runs as the element is made, which is
 *    the opening, and Solid runs its cleanup as the element is taken off, which is the shutting.
 *  - `dialogFocusWhile(open, () => el)` for a dialog that stays on the page and is shown by a class.
 */
import { createEffect, on, onCleanup } from 'solid-js'
import { returnFocus } from './returnFocus'

export interface DialogFocusOptions {
  /** What to focus instead of the first field, for a dialog that opens on a later part. */
  first?: () => HTMLElement | null | undefined
  /**
   * Where focus goes when the opener has left the page by the time the dialog shuts: a button the
   * open form stood in for, made again when it shuts.
   */
  returnTo?: () => HTMLElement | null | undefined
  preventScroll?: boolean
}

const FIELDS = 'input:not([type="hidden"]), select, textarea, [contenteditable="true"]'

/** Whether `el` is drawn: on the page, and not inside something hidden. */
function drawn(el: HTMLElement): boolean {
  if (!el.isConnected) return false
  if (typeof el.checkVisibility === 'function') return el.checkVisibility()
  // For environments without checkVisibility.
  for (let at: HTMLElement | null = el; at; at = at.parentElement) {
    if (at.hidden || window.getComputedStyle(at).display === 'none') return false
  }
  return true
}

/** The first field in `root` a person can type in or choose from, or null. */
export function firstField(root: ParentNode): HTMLElement | null {
  for (const el of root.querySelectorAll<HTMLElement>(FIELDS)) {
    if (el.matches(':disabled') || !drawn(el)) continue
    return el
  }
  return null
}

/** Frames to keep trying while a dialog is still being drawn in. */
const FRAMES = 10

function nextFrame(run: () => void): void {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run)
  else setTimeout(run, 16)
}

/**
 * Puts focus in `dialog`. One that fades in from `visibility: hidden` (Auto Categorize) cannot
 * hold focus until it is drawn, a frame after it opens, and until then `focus()` does nothing: so
 * it tries again on the next frames, while the dialog is open and focus is where it was.
 */
function focusInto(
  dialog: HTMLElement,
  options: DialogFocusOptions,
  isOpen: () => boolean,
  from: Element | null = document.activeElement,
  frames = FRAMES
): void {
  if (!isOpen()) return
  const active = document.activeElement
  // Something inside already put focus where it belongs (a field that focuses itself).
  if (dialog.contains(active) && active !== dialog) return
  // Moved by someone else while the dialog came in: theirs to keep.
  if (active !== from) return
  const preventScroll = options.preventScroll === true
  const target = options.first?.() ?? firstField(dialog)
  if (target) {
    target.focus({ preventScroll })
  } else {
    // No field: the dialog itself, so a screen reader reads its name and Tab starts inside it.
    if (!dialog.hasAttribute('tabindex')) dialog.tabIndex = -1
    dialog.focus({ preventScroll })
  }
  if (document.activeElement !== from || frames === 0) return
  nextFrame(() => {
    focusInto(dialog, options, isOpen, from, frames - 1)
  })
}

function giveBack(
  opener: Element | null,
  dialog: HTMLElement | undefined,
  options: DialogFocusOptions
) {
  returnFocus(opener, dialog)
  const returnTo = options.returnTo
  if (!returnTo) return
  // The button the form stood in for is made again in the same update; it is there once it ends.
  queueMicrotask(() => {
    const active = document.activeElement
    if (active !== null && active !== document.body) return
    returnTo()?.focus({ preventScroll: options.preventScroll === true })
  })
}

/** Use as the `ref` of a dialog put on the page when it opens and taken off when it shuts. */
export function dialogFocus(dialog: HTMLElement, options: DialogFocusOptions = {}): void {
  // Read now, as the dialog is made: nothing inside it has taken focus yet.
  const opener = document.activeElement
  queueMicrotask(() => {
    focusInto(dialog, options, () => dialog.isConnected)
  })
  onCleanup(() => {
    giveBack(opener, dialog, options)
  })
}

/** For a dialog that stays on the page and is shown by a class while `open()` is true. */
export function dialogFocusWhile(
  open: () => boolean,
  dialog: () => HTMLElement | undefined,
  options: DialogFocusOptions = {}
): void {
  let opener: Element | null = null
  createEffect(
    on(open, (isOpen, wasOpen) => {
      if (isOpen) {
        opener = document.activeElement
        queueMicrotask(() => {
          const el = dialog()
          // Not if it shut again in the meantime: focus would go into a shut dialog.
          if (el) focusInto(el, options, () => open() && el.isConnected)
        })
      } else if (wasOpen === true) {
        giveBack(opener, dialog(), options)
      }
    })
  )
}
