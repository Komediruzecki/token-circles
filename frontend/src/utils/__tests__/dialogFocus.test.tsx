/**
 * dialogFocus: whatever opens over or into the page after it loaded takes focus when it opens and
 * gives it back when it shuts.
 *
 * `autofocus` cannot do the first: the browser applies it only while a page loads, never to a
 * node put on the page later. Opened on 19 Nov, Add bill and New Goal left focus on their buttons,
 * behind the dialog, and the loan form did the same until it focused its name itself.
 */
import { createSignal, onMount, Show } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, describe, expect, it } from 'vitest'
import { dialogFocus, dialogFocusWhile, firstField } from '../dialogFocus'
import type { JSX } from 'solid-js'

let host: HTMLDivElement | undefined
let dispose: (() => void) | undefined

afterEach(() => {
  dispose?.()
  dispose = undefined
  host?.remove()
  host = undefined
})

const settle = () => new Promise((r) => setTimeout(r, 0))

function mount(ui: () => JSX.Element) {
  host = document.createElement('div')
  document.body.appendChild(host)
  dispose = render(ui, host)
}

const byTestId = (id: string) => document.querySelector<HTMLElement>(`[data-test-id="${id}"]`)!

describe('dialogFocus, as the ref of a dialog put on the page when it opens', () => {
  it('focuses the first field when it opens, and gives focus back to the opener when it shuts', async () => {
    const [open, setOpen] = createSignal(false)
    mount(() => (
      <>
        <button data-test-id="opener" onClick={() => setOpen(true)}>
          Add bill
        </button>
        <Show when={open()}>
          <div role="dialog" data-test-id="dialog" ref={dialogFocus}>
            <h3>Add bill</h3>
            <input data-test-id="name" />
            <input data-test-id="amount" />
            <button data-test-id="cancel" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </Show>
      </>
    ))
    byTestId('opener').focus()
    byTestId('opener').click()
    await settle()
    expect(document.activeElement).toBe(byTestId('name'))

    byTestId('cancel').focus()
    byTestId('cancel').click()
    await settle()
    expect(document.activeElement).toBe(byTestId('opener'))
  })

  it('gives focus back the same way when the dialog is shown with cond() && (...)', async () => {
    const [open, setOpen] = createSignal(false)
    mount(() => (
      <>
        <button data-test-id="opener">Add</button>
        {open() && (
          <div role="dialog" ref={dialogFocus}>
            <input data-test-id="name" />
          </div>
        )}
      </>
    ))
    byTestId('opener').focus()
    setOpen(true)
    await settle()
    expect(document.activeElement).toBe(byTestId('name'))
    setOpen(false)
    await settle()
    expect(document.activeElement).toBe(byTestId('opener'))
  })

  it('passes over a hidden input, a disabled field and one that is not drawn', async () => {
    const [open, setOpen] = createSignal(false)
    mount(() => (
      <Show when={open()}>
        <div role="dialog" ref={dialogFocus}>
          <input type="hidden" value="1" />
          <input data-test-id="disabled" disabled />
          <div style={{ display: 'none' }}>
            <input data-test-id="not-drawn" />
          </div>
          <select data-test-id="type">
            <option>Expense</option>
          </select>
        </div>
      </Show>
    ))
    setOpen(true)
    await settle()
    expect(document.activeElement).toBe(byTestId('type'))
  })

  it('focuses the dialog itself when it has no field, and still gives focus back', async () => {
    const [open, setOpen] = createSignal(false)
    mount(() => (
      <>
        <button data-test-id="opener">Delete</button>
        <Show when={open()}>
          <div
            role="alertdialog"
            aria-label="Delete this loan?"
            data-test-id="dialog"
            ref={dialogFocus}
          >
            <p>This loan and its extra payments go.</p>
            <button data-test-id="cancel" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </Show>
      </>
    ))
    byTestId('opener').focus()
    setOpen(true)
    await settle()
    expect(document.activeElement).toBe(byTestId('dialog'))
    expect(byTestId('dialog').getAttribute('tabindex')).toBe('-1')
    setOpen(false)
    await settle()
    expect(document.activeElement).toBe(byTestId('opener'))
  })

  it('leaves focus where something inside the dialog already put it', async () => {
    // As Tags.tsx does: a field that focuses itself as it mounts, before the dialog's turn comes.
    function SelfFocusing() {
      let field: HTMLInputElement | undefined
      onMount(() => field?.focus())
      return <input data-test-id="tag" ref={field} />
    }
    const [open, setOpen] = createSignal(false)
    mount(() => (
      <Show when={open()}>
        <div role="dialog" ref={dialogFocus}>
          <input data-test-id="name" />
          <SelfFocusing />
        </div>
      </Show>
    ))
    setOpen(true)
    await settle()
    expect(document.activeElement).toBe(byTestId('tag'))
  })

  it('focuses what `first` names instead of the first field', async () => {
    const [open, setOpen] = createSignal(false)
    let rate: HTMLInputElement | undefined
    mount(() => (
      <Show when={open()}>
        <div
          role="dialog"
          ref={(el) => {
            dialogFocus(el, { first: () => rate })
          }}
        >
          <input data-test-id="name" />
          <input data-test-id="rate" ref={rate} />
        </div>
      </Show>
    ))
    setOpen(true)
    await settle()
    expect(document.activeElement).toBe(byTestId('rate'))
  })

  it('gives focus to `returnTo` when the opener left the page as the dialog opened', async () => {
    // Goals' Add Funds button is taken off the page while its form is open, and a new one is
    // made when the form shuts.
    const [open, setOpen] = createSignal(false)
    mount(() => (
      <>
        <Show when={!open()}>
          <button data-test-id="add-funds" onClick={() => setOpen(true)}>
            Add Funds
          </button>
        </Show>
        <Show when={open()}>
          <form
            ref={(el) => {
              dialogFocus(el, { returnTo: () => byTestId('add-funds') })
            }}
          >
            <input data-test-id="amount" />
          </form>
        </Show>
      </>
    ))
    byTestId('add-funds').focus()
    byTestId('add-funds').click()
    await settle()
    expect(document.activeElement).toBe(byTestId('amount'))
    setOpen(false)
    await settle()
    expect(document.activeElement).toBe(byTestId('add-funds'))
  })

  it('leaves focus alone when it moved out of the dialog before the dialog shut', async () => {
    const [open, setOpen] = createSignal(false)
    mount(() => (
      <>
        <button data-test-id="opener">Add</button>
        <button data-test-id="elsewhere">Elsewhere</button>
        <Show when={open()}>
          <div role="dialog" ref={dialogFocus}>
            <input data-test-id="name" />
          </div>
        </Show>
      </>
    ))
    byTestId('opener').focus()
    setOpen(true)
    await settle()
    byTestId('elsewhere').focus()
    setOpen(false)
    await settle()
    expect(document.activeElement).toBe(byTestId('elsewhere'))
  })
})

describe('dialogFocusWhile, for a dialog that stays on the page and is shown by a class', () => {
  it('focuses the first field each time it opens and gives focus back each time it shuts', async () => {
    const [open, setOpen] = createSignal(false)
    let form: HTMLDivElement | undefined

    function Page() {
      dialogFocusWhile(open, () => form)
      return (
        <>
          <button data-test-id="opener">Add transaction</button>
          <div
            role="dialog"
            ref={form}
            style={{ display: open() ? 'flex' : 'none' }}
            data-test-id="form"
          >
            <select data-test-id="type">
              <option>Expense</option>
            </select>
          </div>
        </>
      )
    }
    mount(() => <Page />)
    for (let round = 0; round < 2; round++) {
      byTestId('opener').focus()
      setOpen(true)
      await settle()
      expect(document.activeElement).toBe(byTestId('type'))
      setOpen(false)
      await settle()
      expect(document.activeElement).toBe(byTestId('opener'))
    }
  })

  it('does not focus into a form that shut again before focus could move', async () => {
    const [open, setOpen] = createSignal(false)
    let form: HTMLDivElement | undefined

    function Page() {
      dialogFocusWhile(open, () => form)
      return (
        <div role="dialog" ref={form}>
          <input data-test-id="name" />
        </div>
      )
    }
    mount(() => <Page />)
    setOpen(true)
    setOpen(false)
    await settle()
    expect(document.activeElement).not.toBe(byTestId('name'))
  })
})

describe('a dialog that fades in from visibility: hidden', () => {
  /** A field a browser will not focus yet: `focus()` does nothing for the first `refusals` calls. */
  function refusing(el: HTMLElement, refusals: number) {
    const focus = el.focus.bind(el)
    const calls = { count: 0 }
    el.focus = (options?: FocusOptions) => {
      calls.count += 1
      if (calls.count > refusals) focus(options)
    }
    return calls
  }
  const frames = async (n: number) => {
    for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 40))
  }

  function Page(props: { open: () => boolean }) {
    let panel: HTMLDivElement | undefined
    dialogFocusWhile(props.open, () => panel)
    return (
      <>
        <button data-test-id="opener">Auto</button>
        <button data-test-id="elsewhere">Filter</button>
        <div role="dialog" ref={panel}>
          <select data-test-id="choice">
            <option>Food</option>
          </select>
        </div>
      </>
    )
  }

  it('takes focus on a later frame, once it is drawn', async () => {
    const [open, setOpen] = createSignal(false)
    mount(() => <Page open={open} />)
    refusing(byTestId('choice'), 2)
    byTestId('opener').focus()
    setOpen(true)
    await settle()
    expect(document.activeElement).toBe(byTestId('opener'))

    await frames(4)
    expect(document.activeElement).toBe(byTestId('choice'))
  })

  it('leaves focus where someone moved it while the dialog was coming in', async () => {
    const [open, setOpen] = createSignal(false)
    mount(() => <Page open={open} />)
    refusing(byTestId('choice'), 1)
    byTestId('opener').focus()
    setOpen(true)
    await settle()
    byTestId('elsewhere').focus()

    await frames(3)
    expect(document.activeElement).toBe(byTestId('elsewhere'))
  })

  it('stops trying after ten frames', async () => {
    const [open, setOpen] = createSignal(false)
    mount(() => <Page open={open} />)
    const calls = refusing(byTestId('choice'), Infinity)
    byTestId('opener').focus()
    setOpen(true)

    await frames(16)
    expect(calls.count).toBe(11)
  })
})

describe('firstField', () => {
  it('finds no field in a dialog of buttons', () => {
    const div = document.createElement('div')
    div.innerHTML = '<button>Cancel</button><button>Delete</button>'
    expect(firstField(div)).toBeNull()
  })
})
