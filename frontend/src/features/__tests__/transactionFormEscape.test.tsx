/**
 * Escape shuts Transactions' entry form, as its Cancel does, and focus goes back to the button
 * that opened it.
 *
 * Found in review on 19 Nov 2026 and reproduced the same day: with the form open from "Add
 * transaction", one Escape and then a second left it open, with focus on the add button behind
 * it and with focus in its amount or its description. The form had no Escape at all. It stays on
 * the page while shut, so focus left in one of its fields would count as typing and hold back the
 * app's shortcuts (utils/returnFocus.ts).
 */
import { createSignal, Show } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import KeyboardShortcutsModal from '../../components/KeyboardShortcutsModal'
import { setCurrentProfile, setPage, setProfiles } from '../../core/appStore'
import { __resetDataVersionsForTest } from '../../core/dataVersions'
import { setPeriod } from '../../core/periodStore'
import { removeToast, toasts } from '../../core/toastStore'

vi.mock('../../core/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  api: new Proxy({} as Record<string, unknown>, {
    // Every list the page and its children read is empty.
    get: (target, name: string) => target[name] ?? (async () => []),
  }),
}))

const flush = () => new Promise((r) => setTimeout(r, 0))
const settle = async () => {
  await flush()
  await flush()
  await flush()
}

let host: HTMLDivElement
let dispose: (() => void) | undefined

beforeAll(async () => {
  await import('../Transactions')
}, 120_000)

beforeEach(async () => {
  __resetDataVersionsForTest()
  localStorage.setItem('currentProfileId', '1')
  setProfiles([{ id: 1, name: 'Personal' }] as never)
  setCurrentProfile({ id: 1, name: 'Personal' } as never)
  Element.prototype.scrollIntoView = () => {}
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  }))
  setPage('transactions')
  setPeriod({ mode: 'range', year: 2026, preset: 'all' })
  host = document.createElement('div')
  document.body.appendChild(host)
  const { default: Transactions } = await import('../Transactions')
  dispose = render(() => <Transactions />, host)
  await settle()
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  host.remove()
  vi.unstubAllGlobals()
  localStorage.clear()
  for (const t of toasts()) removeToast(t.id)
})

const addButton = () => host.querySelector<HTMLElement>('[data-test-id="add-transaction-btn"]')!
const formIsOpen = () =>
  host.querySelector<HTMLElement>('[data-test-id="tx-modal"]')!.className.includes('show')

async function openFromTheAddButton() {
  // jsdom lays nothing out. In a browser the form has a box while it is open, and none when shut.
  const form = host.querySelector<HTMLElement>('[data-test-id="tx-modal"]')!
  form.getClientRects = () => (formIsOpen() ? [{}] : []) as unknown as DOMRectList
  addButton().focus()
  addButton().click()
  await settle()
  expect(formIsOpen()).toBe(true)
}

async function pressEscape(on: EventTarget = document.activeElement ?? document) {
  on.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
  await settle()
}

/** A dialog over the form that, like the keyboard shortcuts, shuts on Escape and says nothing. */
function dialogThatShutsOnEscape() {
  const dialog = document.createElement('div')
  dialog.setAttribute('role', 'dialog')
  dialog.setAttribute('aria-modal', 'true')
  // jsdom lays nothing out; a dialog on screen has a box.
  dialog.getClientRects = () => [{}] as unknown as DOMRectList
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') dialog.remove()
  }
  document.addEventListener('keydown', onKey)
  return {
    dialog,
    dispose: () => {
      document.removeEventListener('keydown', onKey)
      dialog.remove()
    },
  }
}

describe("Transactions' entry form and Escape", () => {
  it('shuts on Escape with focus where it opened, and focus stays on the add button', async () => {
    await openFromTheAddButton()
    await pressEscape()
    expect(formIsOpen()).toBe(false)
    expect(document.activeElement).toBe(addButton())
  })

  it('shuts on Escape typed in one of its fields, and focus goes back to the add button', async () => {
    await openFromTheAddButton()
    const amount = host.querySelector<HTMLInputElement>('[data-test-id="tx-amount"]')!
    amount.focus()
    expect(document.activeElement).toBe(amount)
    await pressEscape()
    expect(formIsOpen()).toBe(false)
    expect(document.activeElement).toBe(addButton())
  })

  it('gives focus back to the add button when Cancel shuts it too', async () => {
    await openFromTheAddButton()
    const cancel = host.querySelector<HTMLButtonElement>('[data-test-id="tx-cancel-btn"]')!
    cancel.focus()
    cancel.click()
    await settle()
    expect(formIsOpen()).toBe(false)
    expect(document.activeElement).toBe(addButton())
  })

  it('leaves the first Escape to a dialog over it, even one that shuts without saying so', async () => {
    // Listening from before the form opened, as the command bar does: it hears Escape first.
    const over = dialogThatShutsOnEscape()
    try {
      await openFromTheAddButton()
      document.body.appendChild(over.dialog)
      await pressEscape(document)
      expect(over.dialog.isConnected).toBe(false)
      expect(formIsOpen()).toBe(true)
      await pressEscape(document)
      expect(formIsOpen()).toBe(false)
    } finally {
      over.dispose()
    }
  })

  it('leaves the first Escape to the keyboard shortcuts over it, and shuts on the second', async () => {
    await openFromTheAddButton()
    // "?" opens the list over the form while focus is still on the add button behind it.
    const [listShown, setListShown] = createSignal(true)
    const listHost = document.createElement('div')
    document.body.appendChild(listHost)
    const disposeList = render(
      () => (
        <Show when={listShown()}>
          <KeyboardShortcutsModal onClose={() => setListShown(false)} />
        </Show>
      ),
      listHost
    )
    try {
      const list = listHost.querySelector<HTMLElement>('[data-test-id="shortcuts-modal"]')!
      // jsdom lays nothing out; the list on screen has a box.
      list.getClientRects = () => [{}] as unknown as DOMRectList
      await pressEscape()
      expect(listShown()).toBe(false)
      expect(formIsOpen()).toBe(true)
      await pressEscape()
      expect(formIsOpen()).toBe(false)
    } finally {
      disposeList()
      listHost.remove()
    }
  })

  it('is not held back by a dialog that stays in the page while shut', async () => {
    await openFromTheAddButton()
    // Still says aria-modal, but has no box: not on screen.
    const shut = document.createElement('div')
    shut.setAttribute('role', 'dialog')
    shut.setAttribute('aria-modal', 'true')
    document.body.appendChild(shut)
    try {
      await pressEscape(document)
      expect(formIsOpen()).toBe(false)
    } finally {
      shut.remove()
    }
  })

  it('leaves the first Escape to an open (i) panel in it, and shuts on the second', async () => {
    await openFromTheAddButton()
    const tip = host.querySelector<HTMLButtonElement>(
      '[data-test-id="tx-modal"] button[aria-label^="How much money moved"]'
    )!
    tip.click()
    await settle()
    expect(document.querySelector('[role="tooltip"]')).not.toBeNull()
    await pressEscape()
    expect(document.querySelector('[role="tooltip"]')).toBeNull()
    expect(formIsOpen()).toBe(true)
    await pressEscape()
    expect(formIsOpen()).toBe(false)
  })

  it('leaves Escape alone once a listener that hears it later has spent it', async () => {
    await openFromTheAddButton()
    // Starts listening after the form opened, as a menu does when it opens over it.
    const spend = (e: KeyboardEvent) => {
      if (e.key === 'Escape') e.preventDefault()
    }
    document.addEventListener('keydown', spend)
    try {
      await pressEscape(document)
      expect(formIsOpen()).toBe(true)
    } finally {
      document.removeEventListener('keydown', spend)
    }
  })

  it('leaves Escape alone while another page is shown', async () => {
    await openFromTheAddButton()
    setPage('loans')
    await pressEscape(document)
    expect(formIsOpen()).toBe(true)
    setPage('transactions')
  })
})
