/**
 * The confirm dialog. A confirm can carry a title, which heads it and names it, and its message
 * can be a few short lines, each its own paragraph: the local-only confirm on a phone was one
 * six-line paragraph with no heading, and its buttons were 39px tall (review D5).
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
  const bodyId = dialog.getAttribute('aria-describedby')
  const body = bodyId ? document.getElementById(bodyId) : null
  return {
    dialog,
    heading: dialog.querySelector('h2'),
    lines: [...(body?.querySelectorAll('p') ?? [])].map((p) => p.textContent),
  }
}

describe('the confirm dialog', () => {
  it('heads a confirm with its title, and gives each line its own paragraph', () => {
    void showConfirm(['Nothing syncs.', 'The account stays.'], { title: 'Keep it here?' })
    const { dialog, heading, lines } = shown()
    expect(heading?.textContent).toBe('Keep it here?')
    expect(heading?.id).toBeTruthy()
    expect(dialog.getAttribute('aria-labelledby')).toBe(heading?.id)
    expect(lines).toEqual(['Nothing syncs.', 'The account stays.'])
  })

  it('shows a confirm with no title as one paragraph, as before', () => {
    void showConfirm('Delete it?')
    const { dialog, heading, lines } = shown()
    expect(heading).toBeNull()
    expect(dialog.hasAttribute('aria-labelledby')).toBe(false)
    expect(lines).toEqual(['Delete it?'])
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
