/**
 * Focus for whatever opens over or into the page after it loaded: a dialog, or a form that opens
 * in place. Opening puts focus on its first field, or on the dialog itself when it has none, so a
 * keyboard and a screen reader start inside it. Shutting gives focus back to what had it before
 * (`returnFocus`).
 *
 * `autofocus` cannot do the first: the browser applies it only while a page loads, never to a node
 * put on the page later, so focus stayed on the button that opened the dialog, behind it.
 *
 * Escape shuts the dialog on top with `onEscape`: the same function as its own Cancel or Close, so
 * a question about unsaved work still comes first. A dialog opened over another (Add Category over
 * Add bill) is on top until it shuts, and Escape shuts only that one.
 *
 * Tab stays inside the dialog on top. Only at its edges does this step in: Tab on its last stop
 * goes to its first, and Shift+Tab on its first to its last. Between them the browser moves focus
 * as it always does.
 *
 * Two shapes:
 *  - `ref={dialogFocus}` on a dialog put on the page when it opens and taken off when it shuts
 *    (`<Show>`, `cond() && (...)`, an `<Index>` row). The ref runs as the element is made, which is
 *    the opening, and Solid runs its cleanup as the element is taken off, which is the shutting.
 *    With options: `ref={(el) => { dialogFocus(el, { onEscape: close }) }}`.
 *  - `dialogFocusWhile(open, () => el)` for a dialog that stays on the page and is shown by a class.
 */
import { createEffect, on, onCleanup } from 'solid-js'
import { returnFocus } from './returnFocus'

export interface DialogFocusOptions {
  /** What to focus instead of the first field, for a dialog that opens on a later part. */
  first?: () => HTMLElement | null | undefined
  /**
   * Where focus goes when it cannot go back to the opener as the dialog shuts: the opener has left
   * the page (a button the open form stood in for, made again when it shuts), or can no longer
   * take focus (the token reveal's Create token, disabled once its name is cleared).
   */
  returnTo?: () => HTMLElement | null | undefined
  preventScroll?: boolean
  /**
   * What Escape does while this dialog is on top: what its Cancel or Close does. Left out by a
   * dialog that hears Escape itself, and by one Escape must not shut (the API token, shown once).
   * Either way a dialog under it hears nothing.
   */
  onEscape?: () => void
  /**
   * A form that opens in place on the page, not over it (Add money, a profile's rename, Delete
   * account, the 2FA step). It hears Escape only while focus is in it, and one with no `onEscape`
   * passes Escape on to the dialog it is in. Tab is not kept in it: it is part of the page.
   */
  inPlace?: boolean
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

/** An open dialog. They are kept in the order they opened, so the last one is on top. */
interface OpenDialog {
  dialog: () => HTMLElement | undefined
  onEscape: (() => void) | undefined
  inPlace: boolean
}

const openDialogs: OpenDialog[] = []

function shut(entry: OpenDialog): void {
  const at = openDialogs.indexOf(entry)
  if (at !== -1) openDialogs.splice(at, 1)
}

/** On top, or back on top when it opens again. */
function opened(entry: OpenDialog): void {
  shut(entry)
  openDialogs.push(entry)
  listenForKeys()
}

/**
 * The dialog Escape is for: the last one opened that is drawn (one on a page not shown is not). A
 * form open in place is not over the page: it takes Escape only from inside it, and otherwise
 * Escape goes on to what is under it.
 */
function onTop(): OpenDialog | undefined {
  const active = document.activeElement
  for (let i = openDialogs.length - 1; i >= 0; i--) {
    const entry = openDialogs[i]
    const el = entry.dialog()
    if (!el || !drawn(el)) continue
    if (entry.inPlace && !(entry.onEscape && active !== null && el.contains(active))) continue
    return entry
  }
  return undefined
}

/** Part of an open dialog this file knows: inside one, or holding one. */
function known(el: Element): boolean {
  return openDialogs.some((entry) => {
    const dialog = entry.dialog()
    return dialog !== undefined && (dialog.contains(el) || el.contains(dialog))
  })
}

/**
 * Something open over the page that takes Escape for itself: an (i) panel, a menu, or a modal this
 * file does not know (the command bar). Some of them shut without saying so, so this is asked as
 * Escape comes in, before any of them has had it. A modal that stays on the page while shut stops
 * taking clicks (`pointer-events: none`) or is hidden.
 */
function takenElsewhere(): boolean {
  if (document.querySelector('[role="tooltip"]') !== null) return true
  for (const menu of document.querySelectorAll('[role="menu"]')) {
    if (menu.getClientRects().length > 0) return true
  }
  for (const modal of document.querySelectorAll<HTMLElement>('[aria-modal="true"]')) {
    // No box: on a page not shown, or taken out of the layout while shut.
    if (known(modal) || !drawn(modal) || modal.getClientRects().length === 0) continue
    const style = window.getComputedStyle(modal)
    if (style.visibility === 'hidden' || style.pointerEvents === 'none') continue
    return true
  }
  return false
}

/** The dialog over the page that Tab stays in: the last one opened that is drawn and not in place. */
function overPage(): OpenDialog | undefined {
  for (let i = openDialogs.length - 1; i >= 0; i--) {
    const entry = openDialogs[i]
    const el = entry.dialog()
    if (el && !entry.inPlace && drawn(el)) return entry
  }
  return undefined
}

/** What Tab can stop on, before the checks in `tabStops`. */
const TABBABLE = [
  'a[href]',
  'area[href]',
  'button',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  'summary',
  'iframe',
  'audio[controls]',
  'video[controls]',
  '[tabindex]',
  '[contenteditable]:not([contenteditable="false"])',
].join(', ')

/** Inside something inert: neither Tab nor a click reaches it. */
function inert(el: Element): boolean {
  for (let at: Element | null = el; at; at = at.parentElement) {
    if ((at as HTMLElement).inert || at.hasAttribute('inert')) return true
  }
  return false
}

/** Drawn and not `visibility: hidden`: what Tab can land on. */
function shown(el: HTMLElement): boolean {
  if (!el.isConnected) return false
  if (typeof el.checkVisibility === 'function') {
    return el.checkVisibility({ visibilityProperty: true })
  }
  return drawn(el) && window.getComputedStyle(el).visibility !== 'hidden'
}

/**
 * Where Tab stops inside `root`, in order: what it can reach that is not disabled, inert or hidden,
 * and of a group of radios only the checked one, or the first when none is.
 */
function tabStops(root: HTMLElement): HTMLElement[] {
  const stops: HTMLElement[] = []
  const groups = new Map<string, HTMLInputElement>()
  for (const el of root.querySelectorAll<HTMLElement>(TABBABLE)) {
    if (el.tabIndex < 0 || el.matches(':disabled') || inert(el) || !shown(el)) continue
    if (el instanceof HTMLInputElement && el.type === 'radio' && el.name !== '') {
      const group = `${el.form?.id ?? ''}|${el.name}`
      const chosen = groups.get(group)
      if (chosen === undefined) {
        groups.set(group, el)
        stops.push(el)
      } else if (el.checked && !chosen.checked) {
        groups.set(group, el)
        stops[stops.indexOf(chosen)] = el
      }
      continue
    }
    stops.push(el)
  }
  return stops
}

/** Where Tab from `active` must go to stay in `root`, or null where the browser can take it. */
function wrapTarget(root: HTMLElement, active: Element | null, back: boolean): HTMLElement | null {
  const stops = tabStops(root)
  // Nothing to stop on: focus stays on the dialog.
  if (stops.length === 0) {
    if (!root.hasAttribute('tabindex')) root.tabIndex = -1
    return root
  }
  const first = stops[0]
  const last = stops[stops.length - 1]
  // From the dialog itself, or from outside it: in at the edge Tab is going towards.
  if (active === null || active === root || !root.contains(active)) return back ? last : first
  const at = stops.indexOf(active as HTMLElement)
  if (at !== -1) {
    if (!back && at === stops.length - 1) return first
    if (back && at === 0) return last
    return null
  }
  // Focus on something inside that Tab does not stop on: past the last stop, or before the first.
  const follows = (stop: HTMLElement) =>
    (active.compareDocumentPosition(stop) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
  if (!back && !stops.some(follows)) return first
  if (back && stops.every(follows)) return last
  return null
}

/**
 * Keeps a Tab press inside `root`, at its edges only: Tab on the last stop goes to the first,
 * Shift+Tab on the first to the last, and from outside `root` Tab goes to its first stop and
 * Shift+Tab to its last. With nothing to stop on, focus stays on `root`. For a modal this file does
 * not keep (the command bar), from its own keydown.
 */
export function keepTabIn(e: KeyboardEvent, root: HTMLElement): void {
  const target = wrapTarget(root, document.activeElement, e.shiftKey)
  if (!target) return
  e.preventDefault()
  target.focus()
}

/**
 * A layer opened over a dialog that keeps Tab while focus is in it: an (i) panel, a menu, a modal
 * this file does not know (the command bar), or the card of a running tour.
 */
function inLayer(el: Element | null): boolean {
  if (el === null) return false
  if (el.closest('[role="tooltip"], [role="menu"], [data-tour-card]') !== null) return true
  const modal = el.closest('[aria-modal="true"]')
  return modal !== null && !known(modal)
}

/** The dialog an Escape on its way in was for, until it is on its way out. */
let escapeFor: OpenDialog | undefined
/** The dialog a Tab on its way in is kept in, until it is on its way out. */
let tabFor: OpenDialog | undefined
let listening = false

/**
 * Escape is read twice. On its way in, before anything has had it: which dialog is on top, and is
 * something else over it? On its way out, after every other listener: did something spend it (a
 * list inside that shuts, a dialog that hears Escape itself)? Only when neither does the dialog on
 * top shut.
 */
function listenForKeys(): void {
  if (listening) return
  listening = true
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Escape') return
      escapeFor = undefined
      // Escape while composing belongs to the input method: it drops what was being composed.
      if (e.isComposing || takenElsewhere()) return
      escapeFor = onTop()
    },
    true
  )
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return
    const entry = escapeFor
    escapeFor = undefined
    // Still open: it may have shut itself on the way.
    if (!entry || e.defaultPrevented || !openDialogs.includes(entry)) return
    if (!entry.onEscape) return
    e.preventDefault()
    entry.onEscape()
  })
  // Tab the same way: on its way in, is focus in a layer over the dialog? On its way out, did
  // something spend it? A modifier makes it someone else's (Ctrl+Tab changes the browser's tab).
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Tab') return
      tabFor = undefined
      if (e.ctrlKey || e.altKey || e.metaKey || e.isComposing) return
      if (inLayer(document.activeElement)) return
      tabFor = overPage()
    },
    true
  )
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return
    const entry = tabFor
    tabFor = undefined
    if (!entry || e.defaultPrevented || !openDialogs.includes(entry)) return
    const dialog = entry.dialog()
    if (dialog) keepTabIn(e, dialog)
  })
}

/** Use as the `ref` of a dialog put on the page when it opens and taken off when it shuts. */
export function dialogFocus(dialog: HTMLElement, options: DialogFocusOptions = {}): void {
  // Read now, as the dialog is made: nothing inside it has taken focus yet.
  const opener = document.activeElement
  const entry: OpenDialog = {
    dialog: () => dialog,
    onEscape: options.onEscape,
    inPlace: options.inPlace === true,
  }
  opened(entry)
  queueMicrotask(() => {
    focusInto(dialog, options, () => dialog.isConnected)
  })
  onCleanup(() => {
    shut(entry)
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
  const entry: OpenDialog = {
    dialog,
    onEscape: options.onEscape,
    inPlace: options.inPlace === true,
  }
  createEffect(
    on(open, (isOpen, wasOpen) => {
      if (isOpen) {
        opener = document.activeElement
        opened(entry)
        queueMicrotask(() => {
          const el = dialog()
          // Not if it shut again in the meantime: focus would go into a shut dialog.
          if (el) focusInto(el, options, () => open() && el.isConnected)
        })
      } else if (wasOpen === true) {
        shut(entry)
        giveBack(opener, dialog(), options)
      }
    })
  )
  // Taken off the page while open (its page went): no longer on top of anything.
  onCleanup(() => {
    shut(entry)
  })
}
