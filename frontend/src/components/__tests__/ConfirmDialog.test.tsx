/**
 * The confirm dialog. A confirm can carry a title, which heads it and names it, and its message
 * can be a few short lines, each its own paragraph: the local-only confirm on a phone was one
 * six-line paragraph with no heading, and its buttons were 39px tall (review D5).
 *
 * Every confirm has an accessible name: its title, or, when it has none, its message. A confirm
 * without a title had no name at all, so a screen reader announced only "alert dialog".
 */
/* eslint-disable security/detect-non-literal-fs-filename -- the path is the dialog's own
   stylesheet, named below, not anything supplied from outside this file. */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { confirmRequests, resolveConfirm, showConfirm } from '../../core/confirmStore'
import ConfirmDialog from '../ConfirmDialog'

let host: HTMLDivElement
let dispose: (() => void) | undefined

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(() => {
  for (const req of confirmRequests()) resolveConfirm(req.id, false)
  dispose?.()
  dispose = undefined
  host.remove()
})

function shown() {
  dispose = render(() => <ConfirmDialog />, host)
  const dialog = host.querySelector<HTMLElement>('[role="alertdialog"]')
  if (!dialog) throw new Error('no dialog')
  const body = dialog.querySelector('p')?.parentElement ?? null
  return {
    dialog,
    heading: dialog.querySelector('h2'),
    body,
    lines: [...(body?.querySelectorAll('p') ?? [])].map((p) => p.textContent),
  }
}

/** The text of the elements an aria-labelledby or aria-describedby names, as a reader joins it. */
function textOf(dialog: HTMLElement, attribute: string): string {
  return (dialog.getAttribute(attribute) ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
    .join(' ')
}

describe('the confirm dialog', () => {
  it('heads a confirm with its title, and gives each line its own paragraph', () => {
    void showConfirm(['Nothing syncs.', 'The account stays.'], { title: 'Keep it here?' })
    const { dialog, heading, lines } = shown()
    expect(heading?.textContent).toBe('Keep it here?')
    expect(heading?.id).toBeTruthy()
    expect(dialog.getAttribute('aria-labelledby')).toBe(heading?.id)
    expect(textOf(dialog, 'aria-labelledby')).toBe('Keep it here?')
    expect(textOf(dialog, 'aria-describedby')).toBe('Nothing syncs.The account stays.')
    expect(lines).toEqual(['Nothing syncs.', 'The account stays.'])
  })

  it('shows a confirm with no title as one paragraph, and names it by that paragraph', () => {
    void showConfirm('Delete it?')
    const { dialog, heading, lines } = shown()
    expect(heading).toBeNull()
    expect(lines).toEqual(['Delete it?'])
    expect(textOf(dialog, 'aria-labelledby')).toBe('Delete it?')
    // Named by the message, so not described by it a second time.
    expect(dialog.hasAttribute('aria-describedby')).toBe(false)
  })

  it('names a confirm with no title and several lines by all of them', () => {
    void showConfirm(['Remove the account?', 'Its entries go with it.'])
    const { dialog } = shown()
    expect(textOf(dialog, 'aria-labelledby')).toBe('Remove the account?Its entries go with it.')
  })

  it('makes its buttons 44px tall on a phone', () => {
    const css = readFileSync(resolve(__dirname, '../ConfirmDialog.module.css'), 'utf8').replace(
      /\/\*[\s\S]*?\*\//g,
      ''
    )
    const at = css.indexOf('@media (max-width: 768px), (pointer: coarse) {')
    expect(at, 'a phone rule').toBeGreaterThanOrEqual(0)
    const rule = css.slice(at, css.indexOf('}', at))
    expect(rule).toContain('.btnCancel')
    expect(rule).toContain('.btnConfirm')
    expect(rule).toMatch(/min-height:\s*44px/)
  })
})
