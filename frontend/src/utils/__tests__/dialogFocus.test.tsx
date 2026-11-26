/**
 * dialogFocus: whatever opens over or into the page after it loaded takes focus when it opens and
 * gives it back when it shuts.
 *
 * `autofocus` cannot do the first: the browser applies it only while a page loads, never to a
 * node put on the page later. Opened on 19 Nov, Add bill and New Goal left focus on their buttons,
 * behind the dialog, and the loan form did the same until it focused its name itself.
 */
import { createSignal, onCleanup, onMount, Show } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, describe, expect, it, onTestFinished } from 'vitest'
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

/**
 * Escape shuts a dialog the way its own Cancel or Close does (`onEscape`), so a question about
 * unsaved work still comes first. Only the dialog on top hears it: Escape in Add Category, opened
 * over Add bill, shuts Add Category and leaves Add bill as it was.
 */
describe('Escape, through onEscape', () => {
  /** Escape pressed where focus is, as a browser sends it. */
  const escape = (init: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
      ...init,
    })
    ;(document.activeElement ?? document.body).dispatchEvent(event)
    return event
  }

  function Dialog(props: {
    open: () => boolean
    onEscape?: () => void
    name: string
    children?: JSX.Element
  }) {
    return (
      <Show when={props.open()}>
        <div
          role="dialog"
          data-test-id={props.name}
          ref={(el) => {
            dialogFocus(el, { onEscape: props.onEscape })
          }}
        >
          <input data-test-id={`${props.name}-field`} />
          {props.children}
        </div>
      </Show>
    )
  }

  it('runs what the dialog says Escape does, and focus goes back to the opener', async () => {
    const [open, setOpen] = createSignal(false)
    mount(() => (
      <>
        <button data-test-id="opener">Add bill</button>
        <Dialog open={open} name="bill" onEscape={() => setOpen(false)} />
      </>
    ))
    byTestId('opener').focus()
    setOpen(true)
    await settle()
    expect(document.activeElement).toBe(byTestId('bill-field'))

    const event = escape()
    expect(open()).toBe(false)
    // Spent, so a page that also shuts something on Escape leaves its own open.
    expect(event.defaultPrevented).toBe(true)
    await settle()
    expect(document.activeElement).toBe(byTestId('opener'))
  })

  it('does the same for a dialog that stays on the page while shut', async () => {
    const [open, setOpen] = createSignal(false)
    let panel: HTMLDivElement | undefined

    function Page() {
      dialogFocusWhile(open, () => panel, { onEscape: () => setOpen(false) })
      return (
        <>
          <button data-test-id="opener">Scan</button>
          <div role="dialog" ref={panel} style={{ display: open() ? 'block' : 'none' }}>
            <input data-test-id="field" />
          </div>
        </>
      )
    }
    mount(() => <Page />)
    byTestId('opener').focus()
    setOpen(true)
    await settle()
    expect(document.activeElement).toBe(byTestId('field'))

    escape()
    expect(open()).toBe(false)
    await settle()
    expect(document.activeElement).toBe(byTestId('opener'))
  })

  it('shuts only the dialog on top: Add Category first, then Add bill', async () => {
    const [bill, setBill] = createSignal(false)
    const [category, setCategory] = createSignal(false)
    mount(() => (
      <>
        <button data-test-id="add-bill">Add bill</button>
        <Dialog open={bill} name="bill" onEscape={() => setBill(false)}>
          <button data-test-id="add-category">Add Category</button>
        </Dialog>
        <Dialog open={category} name="category" onEscape={() => setCategory(false)} />
      </>
    ))
    byTestId('add-bill').focus()
    setBill(true)
    await settle()
    byTestId('add-category').focus()
    setCategory(true)
    await settle()
    expect(document.activeElement).toBe(byTestId('category-field'))

    escape()
    expect(category()).toBe(false)
    expect(bill()).toBe(true)
    await settle()
    expect(document.activeElement).toBe(byTestId('add-category'))

    escape()
    expect(bill()).toBe(false)
    await settle()
    expect(document.activeElement).toBe(byTestId('add-bill'))
  })

  it('leaves the dialog below alone when the one on top handles Escape itself', async () => {
    const [bill, setBill] = createSignal(false)
    const [guide, setGuide] = createSignal(false)

    function Guide() {
      // Shuts itself on Escape and says nothing (no preventDefault), as the shortcuts guide does.
      onMount(() => {
        const onKey = (e: KeyboardEvent) => {
          if (e.key === 'Escape') setGuide(false)
        }
        document.addEventListener('keydown', onKey)
        onCleanup(() => {
          document.removeEventListener('keydown', onKey)
        })
      })
      return (
        <div role="dialog" ref={dialogFocus}>
          <button data-test-id="guide-close">Close</button>
        </div>
      )
    }
    mount(() => (
      <>
        <button data-test-id="add-bill">Add bill</button>
        <Dialog open={bill} name="bill" onEscape={() => setBill(false)} />
        <Show when={guide()}>
          <Guide />
        </Show>
      </>
    ))
    byTestId('add-bill').focus()
    setBill(true)
    await settle()
    setGuide(true)
    await settle()

    escape()
    expect(guide()).toBe(false)
    expect(bill()).toBe(true)
  })

  it('does not run onEscape for a dialog that shut itself on the way', async () => {
    const [open, setOpen] = createSignal(false)
    let escapes = 0
    mount(() => (
      <Dialog
        open={open}
        name="bill"
        onEscape={() => {
          escapes += 1
        }}
      >
        <button
          data-test-id="inside"
          onKeyDown={(e) => {
            // Shuts the dialog on Escape and says nothing.
            if (e.key === 'Escape') setOpen(false)
          }}
        >
          Close
        </button>
      </Dialog>
    ))
    setOpen(true)
    await settle()
    byTestId('inside').focus()

    escape()
    expect(open()).toBe(false)
    expect(escapes).toBe(0)
  })

  it('leaves an Escape that something inside already spent', async () => {
    const [open, setOpen] = createSignal(false)
    mount(() => (
      <Dialog open={open} name="bill" onEscape={() => setOpen(false)}>
        <select
          data-test-id="list"
          onKeyDown={(e) => {
            // A list that shuts on Escape, and says so.
            if (e.key === 'Escape') e.preventDefault()
          }}
        />
      </Dialog>
    ))
    setOpen(true)
    await settle()
    byTestId('list').focus()

    escape()
    expect(open()).toBe(true)
  })

  it('leaves Escape to an open (i) panel, which shuts without saying so', async () => {
    const [open, setOpen] = createSignal(false)
    const [tip, setTip] = createSignal(false)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setTip(false)
    }
    document.addEventListener('keydown', onKey)
    onTestFinished(() => {
      document.removeEventListener('keydown', onKey)
    })
    mount(() => (
      <Dialog open={open} name="bill" onEscape={() => setOpen(false)}>
        <Show when={tip()}>
          <div role="tooltip">What a due day is</div>
        </Show>
      </Dialog>
    ))
    setOpen(true)
    setTip(true)
    await settle()

    escape()
    expect(tip()).toBe(false)
    expect(open()).toBe(true)
  })

  it('leaves Escape to an open modal it does not know, such as the command bar', async () => {
    const [open, setOpen] = createSignal(false)
    const [bar, setBar] = createSignal(false)
    mount(() => (
      <>
        <Dialog open={open} name="bill" onEscape={() => setOpen(false)} />
        <Show when={bar()}>
          <div role="dialog" aria-modal="true">
            <input data-test-id="bar-input" />
          </div>
        </Show>
      </>
    ))
    setOpen(true)
    await settle()
    setBar(true)
    byTestId('bar-input').focus()

    escape()
    expect(open()).toBe(true)
    // Nor with focus dropped to the page while the bar is open.
    byTestId('bar-input').blur()
    escape()
    expect(open()).toBe(true)
  })

  it('still shuts while a modal that stays on the page sits shut beside it', async () => {
    const [open, setOpen] = createSignal(false)
    mount(() => (
      <>
        <Dialog open={open} name="bill" onEscape={() => setOpen(false)} />
        {/* The scan, faded out and taking no clicks; Auto Categorize, hidden. */}
        <div role="dialog" aria-modal="true" style={{ 'pointer-events': 'none' }} />
        <div role="dialog" aria-modal="true" style={{ visibility: 'hidden' }} />
      </>
    ))
    setOpen(true)
    await settle()

    escape()
    expect(open()).toBe(false)
  })

  it('hears nothing while shut, or once its page has gone', async () => {
    const [open, setOpen] = createSignal(false)
    let escapes = 0
    let panel: HTMLDivElement | undefined

    function Page() {
      dialogFocusWhile(open, () => panel, {
        onEscape: () => {
          escapes += 1
        },
      })
      return (
        <div role="dialog" ref={panel}>
          <input />
        </div>
      )
    }
    mount(() => <Page />)
    escape()
    expect(escapes).toBe(0)

    setOpen(true)
    await settle()
    dispose?.()
    dispose = undefined
    escape()
    expect(escapes).toBe(0)
  })

  it('leaves Escape to an input method that is composing', async () => {
    const [open, setOpen] = createSignal(false)
    mount(() => <Dialog open={open} name="bill" onEscape={() => setOpen(false)} />)
    setOpen(true)
    await settle()

    escape({ isComposing: true })
    expect(open()).toBe(true)
  })
})
