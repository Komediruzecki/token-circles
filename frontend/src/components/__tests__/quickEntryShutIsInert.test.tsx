/**
 * The two quick entries stay mounted while shut, so they can fade in and out. Shut, they have to
 * be gone for everyone, not only for the eye.
 *
 * Both kept role="dialog" and aria-modal="true" while closed and faded to opacity 0, so every page
 * carried an invisible "dialog Add transaction" in its accessibility tree, and a screen reader that
 * honours aria-modal can keep its reading cursor inside a dialog nobody can see. Shut, each overlay
 * is now inert (out of the accessibility tree and the tab order) and claims no aria-modal.
 *
 * Closing hands focus back to what had it before opening. The shut box is inert, so a keyboard
 * user whose focus was inside it would otherwise start again from the top of the page.
 */
import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CommandBar } from '../CommandBar'
import { GuidedOrbit } from '../GuidedOrbit'
import type { JSX } from 'solid-js'
import type { QuickEntryList } from '../../core/quickEntryLists'
import type { Account, Category } from '../../types/models'

function ready<T>(): QuickEntryList<T> {
  return {
    items: () => [],
    status: () => 'ready',
    profileId: () => 1,
    isCurrent: () => true,
    reload: vi.fn(),
  }
}

/**
 * Solid sets `inert` as a property, which a browser reflects to the attribute and jsdom does not,
 * so read both (as onboardingHoldsPageBehind.test.tsx does).
 */
const isInert = (el: Element) => (el as HTMLElement).inert || el.hasAttribute('inert')

/** Past the command bar's 60 ms wait before it focuses its input. */
const settle = () => new Promise((r) => setTimeout(r, 80))

let host: HTMLDivElement
let dispose: (() => void) | undefined

beforeEach(() => {
  localStorage.setItem('currentProfileId', '1')
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  host.remove()
  localStorage.clear()
})

type View = (isOpen: () => boolean, onClose: () => void) => JSX.Element

const ENTRIES: { name: string; label: string; view: View }[] = [
  {
    name: 'the command bar',
    label: 'Quick entry command bar',
    view: (isOpen, onClose) => (
      <CommandBar
        isOpen={isOpen}
        onClose={onClose}
        categories={ready<Category>()}
        accounts={ready<Account>()}
        onSave={() => {}}
      />
    ),
  },
  {
    name: 'the Add transaction sheet',
    label: 'Add transaction',
    view: (isOpen, onClose) => (
      <GuidedOrbit
        isOpen={isOpen}
        onClose={onClose}
        categories={ready<Category>()}
        accounts={ready<Account>()}
        onSave={() => {}}
      />
    ),
  },
]

function mount(view: View) {
  const [open, setOpen] = createSignal(false)
  dispose = render(
    () => (
      <>
        <button type="button" data-test-id="opener" onClick={() => setOpen(true)}>
          Open
        </button>
        {view(open, () => setOpen(false))}
      </>
    ),
    host
  )
  const dialog = () => host.querySelector<HTMLElement>('[role="dialog"]')!
  return {
    setOpen,
    opener: host.querySelector<HTMLButtonElement>('[data-test-id="opener"]')!,
    dialog,
    overlay: () => dialog().parentElement!,
  }
}

describe.each(ENTRIES)('$name', ({ label, view }) => {
  it('is out of the accessibility tree and the tab order while shut', () => {
    const m = mount(view)
    expect(isInert(m.overlay())).toBe(true)
    expect(host.querySelector('[aria-modal="true"]')).toBeNull()
  })

  it('is a modal dialog while open', async () => {
    const m = mount(view)
    m.setOpen(true)
    await settle()
    expect(isInert(m.overlay())).toBe(false)
    expect(m.dialog().getAttribute('aria-modal')).toBe('true')
    expect(m.dialog().getAttribute('aria-label')).toBe(label)
  })

  it('shuts again behind Escape, inert once more', async () => {
    const m = mount(view)
    m.setOpen(true)
    await settle()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await settle()
    expect(isInert(m.overlay())).toBe(true)
    expect(host.querySelector('[aria-modal="true"]')).toBeNull()
  })

  it('hands focus back to what opened it', async () => {
    const m = mount(view)
    m.opener.focus()
    m.opener.click()
    await settle()
    const inside = m.dialog().querySelector<HTMLElement>('input, button')!
    inside.focus()
    expect(document.activeElement).toBe(inside)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await settle()
    expect(document.activeElement).toBe(m.opener)
  })

  it('takes focus out of it when nothing had focus before', async () => {
    const m = mount(view)
    ;(document.activeElement as HTMLElement | null)?.blur()
    m.setOpen(true)
    await settle()
    m.dialog().querySelector<HTMLElement>('input, button')!.focus()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await settle()
    expect(m.dialog().contains(document.activeElement)).toBe(false)
  })

  it('leaves focus alone when the user has already moved on', async () => {
    const m = mount(view)
    const elsewhere = document.createElement('button')
    host.appendChild(elsewhere)
    m.opener.focus()
    m.opener.click()
    await settle()
    elsewhere.focus()
    m.setOpen(false)
    await settle()
    expect(document.activeElement).toBe(elsewhere)
  })
})

describe('the command bar opened and shut at once', () => {
  it('does not focus its input after it has shut', async () => {
    const m = mount(ENTRIES[0].view)
    m.opener.focus()
    m.setOpen(true)
    m.setOpen(false)
    await settle()
    expect(m.dialog().contains(document.activeElement)).toBe(false)
  })
})
