/**
 * domFocus — the one answer to "does the focused control own this keystroke?".
 *
 * Every global key handler needs it (the "?" shortcuts guide, ←/→ period stepping, the
 * GuidedOrbit keypad) and so does the deploy watcher, which must not reload a half-typed
 * form out from under the user. They each used to carry their own copy of the check and had
 * already drifted: one omitted SELECT, and only one knew that a checkbox keeps focus long
 * after the click.
 *
 * The default answer is "is the user mid-entry" — focus resting on a checkbox or a submit
 * button is NOT an entry in progress, and treating it as one would veto a shortcut (or an
 * auto-reload) for as long as that focus lasts. Handlers bound to keys the resting controls
 * drive themselves pass `includeResting` — see the option.
 */

/** Input types whose focus is a resting state, not an entry in progress. A checkbox or a
 *  toggle keeps focus long after the click; treating that as "mid-entry" would veto the
 *  caller forever. */
const NON_ENTRY_INPUT_TYPES = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
])

export interface EditableTargetOptions {
  /**
   * Count the resting controls above as editable too. Set this when the guarded key is one
   * those controls drive natively: ←/→ slide a `<input type="range">` — RangeField, on the
   * Retirement Planner — and would move a radio group's selection, so a global arrow handler
   * has to stand down for them even though nothing is being typed.
   *
   * Note this widens to EVERY input type, not only the arrow-driven ones. That is deliberate
   * for now: it is exactly the `tagName === 'INPUT'` behaviour the arrow handler shipped with,
   * and narrowing it to {radio, range} is a behaviour change that wants its own patch.
   */
  includeResting?: boolean
}

/**
 * True when `el` is a control that owns the keystrokes it receives — a text-entry input, a
 * textarea, a select (arrows and type-ahead pick its option), or a contentEditable node.
 */
export function isEditableTarget(el: Element | null, opts: EditableTargetOptions = {}): boolean {
  if (el instanceof HTMLInputElement) {
    return opts.includeResting === true || !NON_ENTRY_INPUT_TYPES.has(el.type)
  }
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true
  if (!(el instanceof HTMLElement)) return false
  // The property is authoritative wherever it exists — it accounts for inheritance, so a node
  // nested inside an editable region answers true. jsdom does not implement it at all (it reads
  // back undefined), and ONLY there do we fall back to the attribute, read as the
  // case-insensitive enumerated attribute it really is: anything that is not an explicit
  // "editable" keyword ("inherit", a typo, "false") leaves the element not editable.
  if (typeof el.isContentEditable === 'boolean') return el.isContentEditable
  const editable = el.getAttribute('contenteditable')?.toLowerCase()
  return editable === '' || editable === 'true' || editable === 'plaintext-only'
}
