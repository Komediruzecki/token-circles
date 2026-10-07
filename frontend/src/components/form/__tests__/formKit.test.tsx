/**
 * The form kit: `createForm`, `Field` and `FormNotice`.
 *
 * Every form in the app used to answer a refused save the same way: a toast that said the save
 * failed, from a catch that threw the server's reasons away. A blank icon on local-first was
 * "Validation failed" in a corner of the screen, with the dialog still open and nothing in it
 * marked. These tests hold the kit to the behaviour that replaces it: say nothing while the
 * person is still typing, mark the fields that are wrong when they submit, move focus to the first
 * of them, let the message go as soon as the field is fixed, and put a server's per-field reasons
 * on the same fields.
 */
import { render } from 'solid-js/web'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../../core/apiError'
import { createForm, Field, FormNotice } from '..'
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
function mount(send: (values: Values) => unknown = () => undefined) {
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
      <form novalidate onSubmit={form.submit}>
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
        <button type="submit" disabled={form.submitting()}>
          Save
        </button>
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
    let finish!: () => void
    const send = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    const form = mount(send)
    type(labelled('Name'), 'Coffee')
    type(labelled('Amount'), '3')

    await submit()
    expect(form.submitting()).toBe(true)
    expect(host!.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true)
    await form.submit()
    expect(send).toHaveBeenCalledTimes(1)

    finish()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(form.submitting()).toBe(false)
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

describe('Field', () => {
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
