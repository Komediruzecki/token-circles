/**
 * The tour menu is a dialog named by its heading.
 *
 * It had no role and no name, so a screen reader announced its content with nothing to say a
 * dialog had opened, and its close button was a bare icon with no name. The name is read through
 * the heading, whatever the heading says, so a renamed heading renames the dialog.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import TourSelectionModal from '../TourSelectionModal'

let host: HTMLDivElement
let dispose: (() => void) | undefined

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('finance_storage_mode', 'serverless')
  vi.stubGlobal('fetch', async () => new Response('[]', { status: 200 }))
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  host.remove()
  vi.unstubAllGlobals()
  localStorage.clear()
})

it('is a modal dialog named by its heading', () => {
  dispose = render(() => <TourSelectionModal />, host)
  const dialog = host.querySelector('[role="dialog"]')
  expect(dialog).not.toBeNull()
  expect(dialog!.getAttribute('aria-modal')).toBe('true')
  const heading = host.querySelector('h2')!
  const ids = (dialog!.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean)
  expect(ids).toEqual([heading.id])
  expect(heading.id).not.toBe('')
  expect(document.getElementById(heading.id)).toBe(heading)
})

it('names its close button', () => {
  dispose = render(() => <TourSelectionModal />, host)
  const close = host.querySelector('[role="dialog"] button')!
  expect(close.getAttribute('aria-label')).toBe('Close')
})
