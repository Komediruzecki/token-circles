/**
 * domFocus — the shared "does the focused control own this keystroke?" predicate.
 *
 * Every case here goes through `document.activeElement`, because that is the only shape the
 * four production call sites use; asserting on an element we happen to be holding would pass
 * just as well with the element detached and nothing focused at all.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { isEditableTarget } from '../domFocus'
import type { EditableTargetOptions } from '../domFocus'

afterEach(() => {
  document.body.innerHTML = ''
})

/**
 * Append, focus, and answer the predicate the way production does. The activeElement
 * assertion is the point: without it, any control jsdom refuses to focus would silently be
 * answered as `<body>` and the case would pass for the wrong reason.
 */
function focusAndCheck(el: HTMLElement, opts?: EditableTargetOptions): boolean {
  document.body.appendChild(el)
  el.focus()
  expect(document.activeElement).toBe(el)
  return isEditableTarget(document.activeElement, opts)
}

function input(type?: string): HTMLInputElement {
  const el = document.createElement('input')
  if (type) el.type = type
  return el
}

function editableDiv(value?: string): HTMLDivElement {
  const el = document.createElement('div')
  if (value !== undefined) el.setAttribute('contenteditable', value)
  return el
}

/** Every type the predicate treats as a resting state rather than an entry in progress. */
const RESTING_TYPES = [
  'button',
  'checkbox',
  'color',
  'file',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
]

describe('isEditableTarget', () => {
  it('is false for nothing focused', () => {
    expect(isEditableTarget(null)).toBe(false)
    // A plain div is not focusable, so focus stays on <body> — the everyday case on which
    // a global shortcut must fire.
    document.body.appendChild(document.createElement('div'))
    expect(isEditableTarget(document.activeElement)).toBe(false)
  })

  it('is true for text-entry inputs', () => {
    expect(focusAndCheck(input())).toBe(true)
    for (const type of ['text', 'number', 'date', 'email', 'password', 'search']) {
      expect(focusAndCheck(input(type)), type).toBe(true)
    }
  })

  it('is true for a textarea', () => {
    expect(focusAndCheck(document.createElement('textarea'))).toBe(true)
  })

  it('is true for a select — arrows and type-ahead pick its option', () => {
    // GuidedOrbit's copy of this check omitted SELECT. No dropdown is reachable in that
    // component today, so nothing was visibly broken; the divergence itself is the defect,
    // since the four copies disagreed about what counts.
    expect(focusAndCheck(document.createElement('select'))).toBe(true)
  })

  it('is false for resting controls — focus lingers there long after the click', () => {
    for (const type of RESTING_TYPES) {
      expect(focusAndCheck(input(type)), type).toBe(false)
    }
  })

  it('counts every resting control when includeResting is set', () => {
    // ←/→ slide a range input and would move a radio group; the arrow handler stands down
    // for the whole set, matching the tagName check it replaced.
    for (const type of RESTING_TYPES) {
      expect(focusAndCheck(input(type), { includeResting: true }), type).toBe(true)
    }
  })

  it('still ignores non-inputs with includeResting — the option widens inputs only', () => {
    expect(isEditableTarget(null, { includeResting: true })).toBe(false)
    expect(focusAndCheck(document.createElement('select'), { includeResting: true })).toBe(true)
  })
})

describe('isEditableTarget contentEditable', () => {
  it('is true for an editable host', () => {
    expect(focusAndCheck(editableDiv('true'))).toBe(true)
  })

  it('trusts isContentEditable over the attribute wherever the property exists', () => {
    // The browser branch. jsdom does not implement the property, so define it to stand in for
    // a real browser: an authored attribute must NOT override an authoritative false, or a
    // node the browser considers read-only would veto the shortcuts and the auto-reload for
    // as long as it held focus.
    const el = editableDiv('true')
    Object.defineProperty(el, 'isContentEditable', { value: false, configurable: true })
    expect(focusAndCheck(el)).toBe(false)

    const editable = editableDiv('false')
    Object.defineProperty(editable, 'isContentEditable', { value: true, configurable: true })
    document.body.appendChild(editable)
    expect(isEditableTarget(editable)).toBe(true)
  })

  it('reads the attribute as the case-insensitive enumerated attribute it is', () => {
    // Only the editable keywords count. "inherit" and any invalid value mean the element is
    // NOT editable, and the comparison must not care about case.
    for (const value of ['', 'true', 'TRUE', 'plaintext-only']) {
      expect(isEditableTarget(editableDiv(value)), JSON.stringify(value)).toBe(true)
    }
    for (const value of ['false', 'FALSE', 'inherit', 'ture']) {
      expect(isEditableTarget(editableDiv(value)), value).toBe(false)
    }
    expect(isEditableTarget(editableDiv())).toBe(false)
  })
})
