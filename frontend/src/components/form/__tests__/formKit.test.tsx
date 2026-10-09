/**
 * The form kit: `createForm`, `Field`, `FormNotice` and `SubmitButton`.
 *
 * Every form in the app used to answer a refused save the same way: a toast that said the save
 * failed, from a catch that threw the server's reasons away. A blank icon on local-first was
 * "Validation failed" in a corner of the screen, with the dialog still open and nothing in it
 * marked. These tests hold the kit to the behaviour that replaces it: say nothing while the
 * person is still typing, mark the fields that are wrong when they submit, move focus to the first
 * of them, let the message go as soon as the field is fixed, and put a server's per-field reasons
 * on the same fields.
 */
import { createSignal, Index, Show } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../../core/apiError'
import { createForm, Field, FormNotice, SAVING, SubmitButton } from '..'
import type { FieldErrors } from '../../../../../shared/refusal'
import type { Form } from '..'

interface Values {
  name: string
  amount: string
  color: string
}

const INITIAL: Values = { name: '', amount: '', color: '#6e9bff' }

const check = (values: Values): FieldErrors => {
  const errors: FieldErrors = {}
  if (!values.name.trim()) errors.name = 'Give it a name.'
  const amount = Number(values.amount)
  if (Number.isNaN(amount) || amount <= 0) errors.amount = 'Make the amount more than zero.'
  return errors
}

let host: HTMLDivElement | undefined
let dispose: (() => void) | undefined

afterEach(() => {
  dispose?.()
  dispose = undefined
  host?.remove()
  host = undefined
  vi.restoreAllMocks()
})

/** A form with a text field, a number-ish text field and a group of swatches. */
function mount(
  send: (values: Values) => unknown = () => undefined,
  busyLabel?: string,
  saved?: (result: unknown) => void
) {
  const form = createForm<Values>({
    initial: INITIAL,
    check,
    send,
    saved,
    failure: "Couldn't save it. Try again.",
  })
  host = document.createElement('div')
  document.body.appendChild(host)
  dispose = render(
    () => (
      <form {...form.attrs}>
        <FormNotice form={form} />
        <Field form={form} name="name" label="Name" hint="What you call it.">
          {(control) => (
            <input
              {...control}
              type="text"
              required
              value={form.values.name}
              onInput={(e) => form.set('name', e.currentTarget.value)}
            />
          )}
        </Field>
        <Field form={form} name="amount" label="Amount">
          {(control) => (
            <input
              {...control}
              type="text"
              inputmode="decimal"
              value={form.values.amount}
              onInput={(e) => form.set('amount', e.currentTarget.value)}
            />
          )}
        </Field>
        <Field form={form} name="color" label="Color" group>
          {(control) => (
            <div {...control}>
              <button type="button" onClick={() => form.set('color', '#59d2a2')}>
                Mint
              </button>
              <button type="button" onClick={() => form.set('color', '#e0708a')}>
                Rose
              </button>
            </div>
          )}
        </Field>
        <SubmitButton busy={form.submitting()} busyLabel={busyLabel}>
          Save
        </SubmitButton>
      </form>
    ),
    host
  )
  return form
}

const formEl = () => host!.querySelector('form')!
const labelled = (text: string): HTMLElement => {
  const label = [...host!.querySelectorAll('label, span')].find((l) => l.textContent === text)!
  const id = label.getAttribute('for')
  if (id) return document.getElementById(id)!
  return host!.querySelector(`[aria-labelledby="${label.id}"]`)!
}
const describedBy = (el: HTMLElement): string[] =>
  (el.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? `(missing #${id})`)
const notice = () => host!.querySelector('[role="alert"]')!
const submitButton = () => host!.querySelector<HTMLButtonElement>('button[type="submit"]')!
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

/** A send that waits until the test lets it finish, or refuses with `error`. */
function pending() {
  let finish!: () => void
  let fail!: (error: unknown) => void
  const send = vi.fn(
    () =>
      new Promise<void>((resolve, reject) => {
        finish = resolve
        fail = reject
      })
  )
  return {
    send,
    finish: () => {
      finish()
    },
    fail: (error: unknown) => {
      fail(error)
    },
  }
}

function type(el: HTMLElement, text: string) {
  el.focus()
  ;(el as HTMLInputElement).value = text
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

async function submit() {
  formEl().requestSubmit()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('first entry', () => {
  it('says nothing while the person fills the form in', () => {
    mount()
    const name = labelled('Name')

    type(name, 'C')
    type(name, '')
    type(labelled('Amount'), '-3')

    expect(host!.querySelectorAll('[aria-invalid="true"]')).toHaveLength(0)
    expect(describedBy(name)).toEqual(['What you call it.'])
  })
})

describe('submit', () => {
  it('marks every field that is wrong, sends nothing, and focuses the first one', async () => {
    const send = vi.fn()
    mount(send)
    host!.querySelector<HTMLButtonElement>('button[type="submit"]')!.focus()

    await submit()

    expect(send).not.toHaveBeenCalled()
    expect(labelled('Name').getAttribute('aria-invalid')).toBe('true')
    expect(labelled('Amount').getAttribute('aria-invalid')).toBe('true')
    expect(labelled('Color').getAttribute('aria-invalid')).toBeNull()
    // The error first, then the hint: the reason is what a screen reader should say first.
    expect(describedBy(labelled('Name'))).toEqual(['Give it a name.', 'What you call it.'])
    expect(describedBy(labelled('Amount'))).toEqual(['Make the amount more than zero.'])
    expect(document.activeElement).toBe(labelled('Name'))
  })

  it('focuses the first wrong field in the page, not the first the check names', async () => {
    mount()
    type(labelled('Name'), 'Coffee')

    await submit()

    expect(document.activeElement).toBe(labelled('Amount'))
  })

  it('sends the values once they pass, as a plain object', async () => {
    const send = vi.fn()
    const form = mount(send)
    type(labelled('Name'), 'Coffee')
    type(labelled('Amount'), '12.50')

    await submit()

    expect(send).toHaveBeenCalledTimes(1)
    const sent = send.mock.calls[0][0] as Values
    expect(sent).toEqual({ name: 'Coffee', amount: '12.50', color: '#6e9bff' })
    sent.name = 'changed'
    expect(form.values.name).toBe('Coffee')
  })

  it('is submitting while send runs, and ignores a second submit', async () => {
    const { send, finish } = pending()
    const form = mount(send)
    type(labelled('Name'), 'Coffee')
    type(labelled('Amount'), '3')

    await submit()
    expect(form.submitting()).toBe(true)
    await form.submit()
    await submit()
    expect(send).toHaveBeenCalledTimes(1)

    finish()
    await tick()
    expect(form.submitting()).toBe(false)
  })
})

describe('while the form sends', () => {
  it('leaves the browser’s own bubbles off, so the kit says what is wrong', () => {
    mount()

    expect(formEl().noValidate).toBe(true)
  })

  it('says so on the button, which keeps focus and does not send twice', async () => {
    const { send, finish } = pending()
    mount(send)
    type(labelled('Name'), 'Coffee')
    type(labelled('Amount'), '3')
    expect(submitButton().textContent).toBe('Save')

    submitButton().focus()
    submitButton().click()
    await tick()

    expect(submitButton().textContent).toBe(SAVING)
    expect(submitButton().getAttribute('aria-disabled')).toBe('true')
    expect(submitButton().disabled).toBe(false)
    expect(document.activeElement).toBe(submitButton())
    expect(formEl().getAttribute('aria-busy')).toBe('true')

    submitButton().click()
    await tick()
    expect(send).toHaveBeenCalledTimes(1)

    finish()
    await tick()
    expect(submitButton().textContent).toBe('Save')
    expect(submitButton().hasAttribute('aria-disabled')).toBe(false)
    expect(formEl().hasAttribute('aria-busy')).toBe(false)
  })

  it('a click on the busy button submits nothing', async () => {
    const { send } = pending()
    mount(send)
    type(labelled('Name'), 'Coffee')
    type(labelled('Amount'), '3')
    submitButton().click()
    await tick()

    const submits = vi.fn()
    formEl().addEventListener('submit', submits)
    submitButton().click()
    await tick()

    expect(submits).not.toHaveBeenCalled()
  })

  it('says the form’s own verb when it has one', async () => {
    const { send } = pending()
    mount(send, 'Adding…')
    type(labelled('Name'), 'Coffee')
    type(labelled('Amount'), '3')

    await submit()

    expect(submitButton().textContent).toBe('Adding…')
  })

  it('stops being busy when the save is refused, and focus goes to the field', async () => {
    const { send, fail } = pending()
    mount(send)
    type(labelled('Name'), 'Coffee')
    type(labelled('Amount'), '3')
    await submit()

    fail(new ApiError(400, 'Rename it.', { name: 'Rename it.' }))
    await tick()

    expect(submitButton().textContent).toBe('Save')
    expect(submitButton().hasAttribute('aria-disabled')).toBe(false)
    expect(formEl().hasAttribute('aria-busy')).toBe(false)
    expect(document.activeElement).toBe(labelled('Name'))
  })
})

describe('a submit button with nothing new to send', () => {
  it('says so, keeps focus, and a click on it submits nothing', async () => {
    // A settings form that is saved, like the retirement planner's: its button reads "Saved".
    const [unchanged, setUnchanged] = createSignal(true)
    const submits = vi.fn((event: Event) => {
      event.preventDefault()
    })
    host = document.createElement('div')
    document.body.appendChild(host)
    dispose = render(
      () => (
        <form onSubmit={submits}>
          <SubmitButton busy={false} unchanged={unchanged()}>
            {unchanged() ? 'Saved' : 'Save'}
          </SubmitButton>
        </form>
      ),
      host
    )
    const button = host.querySelector('button')!
    button.focus()
    button.click()
    await tick()

    expect(submits).not.toHaveBeenCalled()
    expect(button.getAttribute('aria-disabled')).toBe('true')
    expect(button.disabled).toBe(false)
    expect(document.activeElement).toBe(button)

    setUnchanged(false)
    expect(button.hasAttribute('aria-disabled')).toBe(false)
    button.click()
    await tick()
    expect(submits).toHaveBeenCalledTimes(1)
  })
})

describe('after a submit', () => {
  it('re-checks a marked field as it changes, so the message goes once it is fixed', async () => {
    mount()
    await submit()
    const name = labelled('Name')

    type(name, 'C')
    expect(name.getAttribute('aria-invalid')).toBeNull()
    expect(describedBy(name)).toEqual(['What you call it.'])

    type(name, '')
    expect(name.getAttribute('aria-invalid')).toBe('true')
    expect(describedBy(name)[0]).toBe('Give it a name.')
  })

  it('leaves a field alone that was fine when the form was sent', async () => {
    mount()
    type(labelled('Amount'), '5')
    await submit()

    type(labelled('Amount'), '0')

    expect(labelled('Amount').getAttribute('aria-invalid')).toBeNull()
  })
})

describe('a refusal from the server', () => {
  it('marks the fields it names and focuses the first', async () => {
    const send = vi.fn().mockRejectedValue(
      new ApiError(400, 'You already have a category called "Coffee". Choose another name.', {
        name: 'You already have a category called "Coffee". Choose another name.',
      })
    )
    mount(send)
    type(labelled('Name'), 'coffee')
    type(labelled('Amount'), '3')
    labelled('Amount').focus()

    await submit()

    expect(labelled('Name').getAttribute('aria-invalid')).toBe('true')
    expect(describedBy(labelled('Name'))[0]).toBe(
      'You already have a category called "Coffee". Choose another name.'
    )
    expect(document.activeElement).toBe(labelled('Name'))
    expect(notice().textContent).toBe('')
  })

  it('lets a server mark go on the field’s next change', async () => {
    mount(vi.fn().mockRejectedValue(new ApiError(400, 'Taken.', { name: 'That name is taken.' })))
    type(labelled('Name'), 'coffee')
    type(labelled('Amount'), '3')
    await submit()

    type(labelled('Name'), 'coffee2')

    expect(labelled('Name').getAttribute('aria-invalid')).toBeNull()
  })

  it('puts a field this form does not show into the notice', async () => {
    mount(
      vi.fn().mockRejectedValue(
        new ApiError(400, 'x', {
          name: 'That name is taken.',
          parent_id: 'Choose a parent category from the list, or leave it empty.',
        })
      )
    )
    type(labelled('Name'), 'coffee')
    type(labelled('Amount'), '3')

    await submit()

    expect(labelled('Name').getAttribute('aria-invalid')).toBe('true')
    expect(notice().textContent).toBe('Choose a parent category from the list, or leave it empty.')
  })

  it('puts the words of a refusal with no fields in the notice', async () => {
    mount(
      vi
        .fn()
        .mockRejectedValue(
          new ApiError(503, "Token Circles isn't answering right now. Try again in a moment.")
        )
    )
    type(labelled('Name'), 'Coffee')
    type(labelled('Amount'), '3')

    await submit()

    expect(notice().textContent).toBe(
      "Token Circles isn't answering right now. Try again in a moment."
    )
    expect(host!.querySelectorAll('[aria-invalid="true"]')).toHaveLength(0)
  })

  it('says the failure sentence for an error with no words for a person', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mount(
      vi.fn().mockRejectedValue(new TypeError("Cannot read properties of undefined (reading 'id')"))
    )
    type(labelled('Name'), 'Coffee')
    type(labelled('Amount'), '3')

    await submit()

    expect(notice().textContent).toBe("Couldn't save it. Try again.")
    expect(logged).toHaveBeenCalled()
  })

  it('clears the notice when the form is sent again', async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(0, "You're offline. Reconnect and try again."))
      .mockResolvedValueOnce(undefined)
    mount(send)
    type(labelled('Name'), 'Coffee')
    type(labelled('Amount'), '3')
    await submit()
    expect(notice().textContent).toBe("You're offline. Reconnect and try again.")

    await submit()

    expect(notice().textContent).toBe('')
    expect(send).toHaveBeenCalledTimes(2)
  })
})

describe('reset', () => {
  it('restores the values and clears every mark and the notice', async () => {
    const form = mount(vi.fn().mockRejectedValue(new ApiError(500, 'Broken.')))
    await submit()
    type(labelled('Name'), 'Coffee')
    type(labelled('Amount'), '3')
    await submit()
    expect(notice().textContent).toBe('Broken.')

    form.reset({ name: 'Rent', amount: '900', color: '#e0708a' })

    expect(form.values).toEqual({ name: 'Rent', amount: '900', color: '#e0708a' })
    expect((labelled('Name') as HTMLInputElement).value).toBe('Rent')
    expect(host!.querySelectorAll('[aria-invalid="true"]')).toHaveLength(0)
    expect(notice().textContent).toBe('')

    // Nothing is marked any more, so nothing is checked while typing.
    type(labelled('Name'), '')
    expect(labelled('Name').getAttribute('aria-invalid')).toBeNull()

    form.reset()
    expect(form.values).toEqual(INITIAL)
  })

  it('ignores a refusal that arrives after the form was reset', async () => {
    let refuse!: (error: unknown) => void
    const form = mount(
      () =>
        new Promise((_, reject) => {
          refuse = reject
        })
    )
    type(labelled('Name'), 'Coffee')
    type(labelled('Amount'), '3')
    await submit()

    form.reset()
    refuse(new ApiError(400, 'Taken.', { name: 'That name is taken.' }))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(labelled('Name').getAttribute('aria-invalid')).toBeNull()
    expect(notice().textContent).toBe('')
    expect(form.submitting()).toBe(false)
  })
})

describe('after a save', () => {
  it('runs saved with what send returned', async () => {
    const saved = vi.fn()
    const form = mount(() => Promise.resolve('Saved it.'), undefined, saved)
    type(labelled('Name'), 'Coffee')
    type(labelled('Amount'), '3')

    await submit()

    expect(saved).toHaveBeenCalledTimes(1)
    expect(saved).toHaveBeenCalledWith('Saved it.')
    expect(form.submitting()).toBe(false)
  })

  // A dialog cancelled and opened again while its save was out has been reset by the opening.
  // The save landing late used to close it, and what was being typed in it went too.
  it('does not run saved for a save that lands after the form was reset', async () => {
    let land!: (said: string) => void
    const saved = vi.fn()
    const form = mount(
      () =>
        new Promise<string>((resolve) => {
          land = resolve
        }),
      undefined,
      saved
    )
    type(labelled('Name'), 'Coffee')
    type(labelled('Amount'), '3')
    await submit()

    form.reset()
    land('Saved it.')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(saved).not.toHaveBeenCalled()
    expect(form.submitting()).toBe(false)
  })
})

/**
 * A field inside a section the person has closed ("Show advanced options"): the kit cannot put its
 * message under a field that is not on the page, so the notice says it. It used to stay in the
 * notice after the section was opened, said a second time under the field, and stay there after
 * the field was fixed, until the next Save.
 */
describe('a field inside a closed section', () => {
  function mountWithSection(send: (values: Values) => unknown = () => undefined) {
    const [open, setOpen] = createSignal(false)
    const form = createForm<Values>({
      initial: INITIAL,
      check,
      send,
      failure: "Couldn't save it. Try again.",
    })
    host = document.createElement('div')
    document.body.appendChild(host)
    dispose = render(
      () => (
        <form {...form.attrs}>
          <FormNotice form={form} />
          <Field form={form} name="name" label="Name">
            {(control) => (
              <input
                {...control}
                value={form.values.name}
                onInput={(e) => form.set('name', e.currentTarget.value)}
              />
            )}
          </Field>
          <Show when={open()}>
            <Field form={form} name="amount" label="Amount">
              {(control) => (
                <input
                  {...control}
                  value={form.values.amount}
                  onInput={(e) => form.set('amount', e.currentTarget.value)}
                />
              )}
            </Field>
          </Show>
          <SubmitButton busy={form.submitting()}>Save</SubmitButton>
        </form>
      ),
      host
    )
    return { form, open: () => setOpen(true), close: () => setOpen(false) }
  }

  it('is said in the notice while the section is closed', async () => {
    mountWithSection()
    type(labelled('Name'), 'Coffee')

    await submit()

    expect(notice().textContent).toBe('Make the amount more than zero.')
  })

  it('moves under the field when the section opens, and is said once', async () => {
    const { open } = mountWithSection()
    type(labelled('Name'), 'Coffee')
    await submit()

    open()

    expect(labelled('Amount').getAttribute('aria-invalid')).toBe('true')
    expect(describedBy(labelled('Amount'))).toEqual(['Make the amount more than zero.'])
    expect(notice().textContent).toBe('')
  })

  it('goes from the field and the notice as soon as the field is fixed', async () => {
    const { open } = mountWithSection()
    type(labelled('Name'), 'Coffee')
    await submit()
    open()

    type(labelled('Amount'), '3')

    expect(labelled('Amount').getAttribute('aria-invalid')).toBeNull()
    expect(notice().textContent).toBe('')
  })

  it('goes from the notice when it is fixed with the section still closed', async () => {
    const { form } = mountWithSection()
    type(labelled('Name'), 'Coffee')
    await submit()

    form.set('amount', '3')

    expect(notice().textContent).toBe('')
  })

  it('goes back to the notice when the section is closed again', async () => {
    const { open, close } = mountWithSection()
    type(labelled('Name'), 'Coffee')
    await submit()
    open()

    close()

    expect(notice().textContent).toBe('Make the amount more than zero.')
  })

  it('takes a server’s refusal of it the same way', async () => {
    const { form, open } = mountWithSection(
      vi.fn().mockRejectedValue(
        new ApiError(400, 'Use at most two decimal places.', {
          amount: 'Use at most two decimal places.',
        })
      )
    )
    type(labelled('Name'), 'Coffee')
    form.set('amount', '3.333')
    await submit()
    expect(notice().textContent).toBe('Use at most two decimal places.')

    open()

    expect(describedBy(labelled('Amount'))).toEqual(['Use at most two decimal places.'])
    expect(notice().textContent).toBe('')

    type(labelled('Amount'), '3.33')
    expect(labelled('Amount').getAttribute('aria-invalid')).toBeNull()
    expect(notice().textContent).toBe('')
  })
})

describe('mark', () => {
  const CASH = "Couldn't create the Cash account. Try again."

  it('puts words under a field from outside a submit, and leaves focus where it is', () => {
    const form = mount()
    const color = labelled('Color')
    color.querySelector('button')!.focus()

    form.mark('color', CASH)

    expect(color.getAttribute('aria-invalid')).toBe('true')
    expect(describedBy(color)).toEqual([CASH])
    expect(document.activeElement).toBe(color.querySelector('button'))
    expect(notice().textContent).toBe('')
  })

  it('lets the mark go on the field’s next change, as a server’s does', () => {
    const form = mount()
    form.mark('name', CASH)

    type(labelled('Name'), 'Coffee')

    expect(labelled('Name').getAttribute('aria-invalid')).toBeNull()
  })

  it('takes a mark away when given no words', () => {
    const form = mount()
    form.mark('amount', CASH)

    form.mark('amount', undefined)

    expect(labelled('Amount').getAttribute('aria-invalid')).toBeNull()
  })

  it('clears with the next submit that passes, and sends', async () => {
    const send = vi.fn()
    const form = mount(send)
    form.mark('color', CASH)
    type(labelled('Name'), 'Coffee')
    type(labelled('Amount'), '3')

    await submit()

    expect(send).toHaveBeenCalledTimes(1)
    expect(labelled('Color').getAttribute('aria-invalid')).toBeNull()
  })

  it('says words for a field this form does not show in the notice', () => {
    const form = mount()

    // A name no Field on this form registered: what a server or a page could name.
    form.mark('note' as keyof Values, CASH)

    expect(notice().textContent).toBe(CASH)
  })
})

describe('Field', () => {
  it('keeps a tip beside the label, out of the control’s name', () => {
    const form = createForm<Values>({ initial: INITIAL, send: () => undefined, failure: 'x' })
    host = document.createElement('div')
    document.body.appendChild(host)
    dispose = render(
      () => (
        <Field
          form={form}
          name="name"
          label="Description"
          labelClass="page-label"
          tip={<button type="button" aria-label="A short label for this entry, shown in lists." />}
        >
          {(control) => <input {...control} />}
        </Field>
      ),
      host
    )

    const input = host.querySelector('input')!
    const label = host.querySelector(`label[for="${input.id}"]`)!
    // The label holds the field's name and nothing else, so that is all its control is called.
    expect(label.textContent).toBe('Description')
    expect(label.querySelector('button')).toBeNull()
    // The tip sits beside it, in the wrapper that carries the page's label class.
    const tip = host.querySelector('button')!
    expect(tip.parentElement).toBe(label.parentElement)
    expect(label.parentElement!.className).toBe('page-label')
    expect(label.className).toBe('')
  })

  it('labels its control, and a group by aria-labelledby', () => {
    mount()

    const name = labelled('Name')
    expect(name.tagName).toBe('INPUT')
    expect(host!.querySelector(`label[for="${name.id}"]`)?.textContent).toBe('Name')

    const color = labelled('Color')
    expect(color.getAttribute('role')).toBe('group')
    expect(document.getElementById(color.getAttribute('aria-labelledby')!)?.textContent).toBe(
      'Color'
    )
  })

  it('gives every field its own ids, even with two forms on the page', () => {
    mount()
    const first = labelled('Name').id
    const other = createForm<Values>({ initial: INITIAL, send: () => undefined, failure: 'x' })
    const second = document.createElement('div')
    document.body.appendChild(second)
    const disposeSecond = render(
      () => (
        <Field form={other} name="name" label="Other name">
          {(control) => <input {...control} />}
        </Field>
      ),
      second
    )

    expect(second.querySelector('input')!.id).not.toBe(first)
    disposeSecond()
    second.remove()
  })

  it('marks a group and focuses the first control inside it', async () => {
    const form = createForm<Values>({
      initial: INITIAL,
      check: (values): FieldErrors =>
        values.color === '#6e9bff' ? { color: 'Pick a color.' } : {},
      send: () => undefined,
      failure: 'x',
    })
    host = document.createElement('div')
    document.body.appendChild(host)
    dispose = render(
      () => (
        <form novalidate onSubmit={form.submit}>
          <Field form={form} name="color" label="Color" group>
            {(control) => (
              <div {...control}>
                <button type="button" onClick={() => form.set('color', '#59d2a2')}>
                  Mint
                </button>
              </div>
            )}
          </Field>
        </form>
      ),
      host
    )

    await submit()

    const group = labelled('Color')
    expect(group.getAttribute('aria-invalid')).toBe('true')
    expect(describedBy(group)).toEqual(['Pick a color.'])
    expect(document.activeElement).toBe(group.querySelector('button'))

    group.querySelector('button')!.click()
    expect(group.getAttribute('aria-invalid')).toBeNull()
  })
})

describe('FormNotice', () => {
  it('is a live region that is in the page before it has anything to say', () => {
    mount()

    expect(notice()).not.toBeNull()
    expect(notice().textContent).toBe('')
  })
})

/** Compile-time: a Field's name has to be one of the form's own fields. */
export function nameMustBeAField(form: Form<Values>) {
  return (
    // @ts-expect-error -- 'nickname' is not a field of this form
    <Field form={form} name="nickname" label="Nickname">
      {(control) => <input {...control} />}
    </Field>
  )
}

describe('a field in a row of a list', () => {
  interface Period {
    rate: string
  }
  interface ListValues {
    title: string
    periods: Period[]
  }

  const rateWords = 'Enter the rate for these payments.'

  /** A form with a list of rows, each with its own field: `periods.<index>.rate`. */
  function mountList(send: (values: ListValues) => unknown = () => undefined) {
    const form = createForm<ListValues>({
      initial: { title: 'Car', periods: [{ rate: '5' }, { rate: '' }, { rate: '7' }] },
      check: (values) => {
        const errors: FieldErrors = {}
        values.periods.forEach((period, i) => {
          if (!period.rate.trim()) errors[`periods.${i}.rate`] = rateWords
        })
        return errors
      },
      send,
      failure: "Couldn't save it. Try again.",
    })
    host = document.createElement('div')
    document.body.appendChild(host)
    dispose = render(
      () => (
        <form {...form.attrs}>
          <FormNotice form={form} />
          <Index each={form.values.periods}>
            {(period, i) => (
              <Field form={form} name={`periods.${i}.rate`} label={`Rate ${i + 1}`}>
                {(control) => (
                  <input
                    {...control}
                    value={period().rate}
                    onInput={(e) => {
                      const rate = e.currentTarget.value
                      form.set(
                        'periods',
                        form.values.periods.map((p, j) => (j === i ? { ...p, rate } : p))
                      )
                    }}
                  />
                )}
              </Field>
            )}
          </Index>
          <SubmitButton busy={form.submitting()}>Save</SubmitButton>
        </form>
      ),
      host
    )
    return form
  }

  const removeRow = (form: Form<ListValues>, index: number) =>
    form.set(
      'periods',
      form.values.periods.filter((_, j) => j !== index)
    )

  it('is marked by a check that names it, and gets focus', async () => {
    const send = vi.fn()
    mountList(send)

    await submit()

    expect(send).not.toHaveBeenCalled()
    expect(labelled('Rate 2').getAttribute('aria-invalid')).toBe('true')
    expect(describedBy(labelled('Rate 2'))).toEqual([rateWords])
    expect(document.activeElement).toBe(labelled('Rate 2'))
    expect(labelled('Rate 1').getAttribute('aria-invalid')).toBeNull()
  })

  it('takes the server’s words for it, which go when that row’s field changes', async () => {
    const said = 'Enter a rate from 0 to 100.'
    mountList(
      vi
        .fn()
        .mockRejectedValue(
          new ApiError(400, said, { 'periods.0.rate': said, 'periods.2.rate': said })
        )
    )
    type(labelled('Rate 2'), '6')
    await submit()
    expect(labelled('Rate 1').getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(labelled('Rate 1'))

    type(labelled('Rate 1'), '4')

    expect(labelled('Rate 1').getAttribute('aria-invalid')).toBeNull()
    // Another row's mark stays: only the server knows whether it still holds.
    expect(describedBy(labelled('Rate 3'))).toEqual([said])
    expect(notice().textContent).toBe('')
  })

  it('moves the marks of the rows after a removed row along with them', async () => {
    const said = 'Enter a rate from 0 to 100.'
    const form = mountList(
      vi
        .fn()
        .mockRejectedValue(
          new ApiError(400, said, { 'periods.1.rate': said, 'periods.2.rate': 'Too high.' })
        )
    )
    type(labelled('Rate 2'), '6')
    await submit()

    removeRow(form, 0)

    // The second row is now the first and the third the second, each with its own words.
    expect(describedBy(labelled('Rate 1'))).toEqual([said])
    expect(describedBy(labelled('Rate 2'))).toEqual(['Too high.'])
    expect(notice().textContent).toBe('')

    removeRow(form, 0)

    // The removed row's words went with it.
    expect(describedBy(labelled('Rate 1'))).toEqual(['Too high.'])
    expect(notice().textContent).toBe('')
  })

  it('is re-checked where the row now is when a row before it is removed', async () => {
    const form = mountList()
    await submit()
    expect(labelled('Rate 2').getAttribute('aria-invalid')).toBe('true')

    removeRow(form, 0)

    // The blank rate moved up to the first row, and is marked there.
    expect(labelled('Rate 1').getAttribute('aria-invalid')).toBe('true')
    expect(labelled('Rate 2').getAttribute('aria-invalid')).toBeNull()
    expect(notice().textContent).toBe('')
  })

  it('leaves the lists it was given as they were, so a reset to the start shows none', () => {
    // A reset reconciles the store, which changes the lists it holds in place. When those were the
    // form's own `initial`, a new loan opened after an edit showed the edited loan's rate periods.
    const start: ListValues = { title: '', periods: [] }
    const opened: ListValues = { title: 'Van', periods: [{ rate: '4' }, { rate: '6' }] }
    const form = createForm<ListValues>({ initial: start, send: () => undefined, failure: 'x' })

    form.reset(opened)
    form.set('periods', [...form.values.periods, { rate: '8' }])
    form.reset({ title: 'Bus', periods: [{ rate: '1' }] })
    expect(opened).toEqual({ title: 'Van', periods: [{ rate: '4' }, { rate: '6' }] })

    form.reset()
    expect(start.periods).toEqual([])
    expect(form.values.periods).toEqual([])
  })

  it('sends a copy of the rows that a later reset leaves alone', async () => {
    let sent: ListValues | undefined
    const form = createForm<ListValues>({
      initial: { title: 'Van', periods: [{ rate: '4' }] },
      send: (values) => {
        sent = values
      },
      failure: 'x',
    })

    await form.submit()
    form.reset({ title: 'Bus', periods: [{ rate: '1' }, { rate: '2' }] })

    expect(sent).toEqual({ title: 'Van', periods: [{ rate: '4' }] })
  })
})

/** Compile-time: a row's field is named `<list>.<index>.<field>`, for a list of the form's own. */
export function rowFieldMustBeAListField(
  form: Form<{ title: string; periods: { rate: string }[] }>
) {
  return (
    <>
      <Field form={form} name="periods.0.rate" label="Rate">
        {(control) => <input {...control} />}
      </Field>
      {/* @ts-expect-error -- 'title' is not a list */}
      <Field form={form} name="title.0.rate" label="Title">
        {(control) => <input {...control} />}
      </Field>
      {/* @ts-expect-error -- a period has no 'note' */}
      <Field form={form} name="periods.0.note" label="Note">
        {(control) => <input {...control} />}
      </Field>
    </>
  )
}
