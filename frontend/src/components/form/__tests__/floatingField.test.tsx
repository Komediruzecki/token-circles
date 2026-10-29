/**
 * A field whose label sits inside its box (`floating`), and a password field's reveal button
 * (`reveal`), the two pieces the sign-in screens share.
 *
 * The label is a real `<label for>` the whole time. It stands where the value will go while the
 * field is empty and has no focus, and moves to the box's top edge once the field has focus or a
 * value: a value typed, one the form opens with, one a reset puts back (the address after Back to
 * sign in), one written into the box without an input event, and one the browser autofills.
 *
 * The reveal button shows the password and hides it again. It is a button of its own beside the
 * label, never inside it, so the field is still called "Password". Its name says what a press
 * does, and it has no pressed state and no tooltip. A pointer press on it leaves focus and the
 * caret in the field, it never sends the form, and the field goes back to a password when the form
 * is sent, before the form's own submit handler runs, so the password manager still finds a
 * password field to save.
 */
import { render } from 'solid-js/web'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createForm, Field } from '..'
import formCss from '../Form.module.css?raw'

interface Values {
  email: string
  password: string
}

const EMPTY: Values = { email: '', password: '' }

let host: HTMLDivElement | undefined
let dispose: (() => void) | undefined

afterEach(() => {
  dispose?.()
  dispose = undefined
  host?.remove()
  host = undefined
})

/**
 * The sign-in form's two fields, as the screens build them. `onSubmit` runs first in the form's
 * own submit handler, the one a sign-in screen gives its form.
 */
function mount(initial: Values = EMPTY, onSubmit?: () => void) {
  const send = vi.fn()
  const form = createForm<Values>({ initial, send, failure: "That didn't work. Try again." })
  host = document.createElement('div')
  document.body.appendChild(host)
  dispose = render(
    () => (
      <form
        {...form.attrs}
        onSubmit={(event) => {
          onSubmit?.()
          void form.submit(event)
        }}
      >
        <Field form={form} name="email" id="test-email" label="Email address" floating>
          {(control) => (
            <input
              {...control}
              type="email"
              name="email"
              value={form.values.email}
              onInput={(e) => form.set('email', e.currentTarget.value)}
              autocomplete="username webauthn"
            />
          )}
        </Field>
        <Field form={form} name="password" id="test-password" label="Password" floating reveal>
          {(control) => (
            <input
              {...control}
              name="password"
              value={form.values.password}
              onInput={(e) => form.set('password', e.currentTarget.value)}
              autocomplete="current-password"
            />
          )}
        </Field>
        <button type="submit">Sign in</button>
      </form>
    ),
    host
  )
  return { form, send }
}

const email = () => document.getElementById('test-email') as HTMLInputElement
const password = () => document.getElementById('test-password') as HTMLInputElement
const labelOf = (input: HTMLInputElement) =>
  host!.querySelector<HTMLLabelElement>(`label[for="${input.id}"]`)!
const reveal = () => password().parentElement!.querySelector<HTMLButtonElement>('button')!

/**
 * The label stands at the box's middle while it rests (Form.module.css, `.floatLabel`); every
 * floated rule moves it to the top edge.
 */
const floated = (input: HTMLInputElement) => window.getComputedStyle(labelOf(input)).top !== '50%'

function type(input: HTMLInputElement, text: string) {
  input.focus()
  input.value = text
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('a floating label', () => {
  it('is a real label for its input, after it in the same box, and no placeholder stands in', () => {
    mount()
    for (const [input, text] of [
      [email(), 'Email address'],
      [password(), 'Password'],
    ] as const) {
      const label = labelOf(input)
      expect(label.textContent).toBe(text)
      expect(input.labels?.[0]).toBe(label)
      // In the box with its input, after it: the stylesheet floats it from the input's state.
      expect(label.parentElement).toBe(input.parentElement)
      expect(input.compareDocumentPosition(label) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      // The placeholder is blank: it only lets the stylesheet see an empty box. The label names
      // the field.
      expect(input.getAttribute('placeholder')?.trim()).toBe('')
    }
  })

  it('sits in the box while the field is empty and has no focus', () => {
    mount()
    expect(floated(email())).toBe(false)
    expect(floated(password())).toBe(false)
  })

  it('moves up while the field has focus, and back down when an empty field loses it', () => {
    mount()
    email().focus()
    expect(floated(email())).toBe(true)
    expect(floated(password())).toBe(false)

    email().blur()
    expect(floated(email())).toBe(false)
  })

  it('stays up once the field holds a value, after focus has gone', () => {
    mount()
    type(email(), 'name@example.com')
    email().blur()

    expect(email().parentElement!.getAttribute('data-filled')).toBe('true')
    expect(floated(email())).toBe(true)

    type(email(), '')
    email().blur()
    expect(email().parentElement!.hasAttribute('data-filled')).toBe(false)
    expect(floated(email())).toBe(false)
  })

  it('is up from the start for a value the form opens with', () => {
    mount({ email: 'name@example.com', password: '' })
    expect(floated(email())).toBe(true)
    expect(floated(password())).toBe(false)
  })

  it('moves up when a reset puts a value back, as Back to sign in does with the address', () => {
    const { form } = mount()
    expect(floated(email())).toBe(false)

    form.reset({ email: 'name@example.com', password: '' })

    expect(email().value).toBe('name@example.com')
    expect(floated(email())).toBe(true)
  })

  it('moves up for a value written into the box without an input event', () => {
    mount()
    expect(floated(email())).toBe(false)

    email().value = 'name@example.com'
    expect(floated(email())).toBe(true)
  })

  it('has rules for browser autofill, each on its own so a browser without one keeps the other', () => {
    // A selector list with a pseudo-class the browser does not know drops the whole rule, so the
    // two spellings must never share one. Each moves the label to the top edge.
    const rules = formCss
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('}')
      .map((rule) => rule.trim())
    for (const pseudo of [':autofill', ':-webkit-autofill']) {
      const rule = rules.find((r) => r.includes(`${pseudo} ~`))
      expect(rule, `a rule for ${pseudo}`).toBeDefined()
      const selector = rule!.slice(0, rule!.indexOf('{'))
      expect(selector).not.toContain(',')
      expect(rule).toMatch(/top:\s*\d/)
    }
  })
})

describe('the reveal button', () => {
  it('is a button inside the password field, named Show password, with no pressed state or tooltip', () => {
    mount()
    const button = reveal()

    expect(button.type).toBe('button')
    expect(button.getAttribute('aria-label')).toBe('Show password')
    expect(button.getAttribute('aria-controls')).toBe('test-password')
    // The name says what a press does. A pressed state as well reads as a double negative
    // ("Hide password, pressed"), and a tooltip has a screen reader say the name twice.
    expect(button.hasAttribute('aria-pressed')).toBe(false)
    expect(button.hasAttribute('title')).toBe(false)
    // An icon, not words or an emoji, and outside the label, so the field is still "Password".
    expect(button.querySelector('svg')).not.toBeNull()
    expect(button.textContent?.trim()).toBe('')
    expect(labelOf(password()).contains(button)).toBe(false)
    expect(password().type).toBe('password')
    // Only the password field has one.
    expect(email().parentElement!.querySelector('button')).toBeNull()
  })

  it('shows the password and says Hide password, then hides it again', () => {
    mount()
    type(password(), 'a-long-password')

    const drawn = () =>
      [...reveal().querySelectorAll('svg *')].map((shape) => [shape.localName, shape.namespaceURI])
    const SVG = 'http://www.w3.org/2000/svg'
    // An eye, drawn as SVG (a shape outside the SVG namespace draws nothing).
    expect(drawn()).toEqual([
      ['path', SVG],
      ['circle', SVG],
    ])

    reveal().click()
    expect(password().type).toBe('text')
    expect(reveal().getAttribute('aria-label')).toBe('Hide password')
    expect(reveal().hasAttribute('aria-pressed')).toBe(false)
    expect(reveal().hasAttribute('title')).toBe(false)
    expect(password().value).toBe('a-long-password')
    // The eye struck through.
    expect(drawn()).toEqual([
      ['path', SVG],
      ['line', SVG],
    ])

    reveal().click()
    expect(password().type).toBe('password')
    expect(reveal().getAttribute('aria-label')).toBe('Show password')
  })

  it('never sends the form', async () => {
    const { send } = mount()
    type(email(), 'name@example.com')
    type(password(), 'a-long-password')
    const submits = vi.fn()
    host!.querySelector('form')!.addEventListener('submit', submits)

    reveal().click()
    reveal().click()
    await tick()

    expect(submits).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  it('leaves focus and the caret in the field when it is pressed', () => {
    mount()
    type(password(), 'a-long-password')
    password().setSelectionRange(3, 3)

    // A pointer press would move focus to the button; the button cancels that.
    const press = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    reveal().dispatchEvent(press)
    expect(press.defaultPrevented).toBe(true)

    reveal().click()
    expect(document.activeElement).toBe(password())
    expect(password().type).toBe('text')
    expect([password().selectionStart, password().selectionEnd]).toEqual([3, 3])

    reveal().click()
    expect(document.activeElement).toBe(password())
    expect([password().selectionStart, password().selectionEnd]).toEqual([3, 3])
  })

  it('puts the caret back where it was if the browser moves it as the type changes', () => {
    mount()
    type(password(), 'a-long-password')
    password().setSelectionRange(3, 3)
    // jsdom and Firefox leave the caret alone when the type changes. This stands in for a browser
    // that sends it to the end as the type changes.
    const field = password()
    const setAttribute = field.setAttribute.bind(field)
    vi.spyOn(field, 'setAttribute').mockImplementation((name: string, value: string) => {
      setAttribute(name, value)
      if (name === 'type') field.setSelectionRange(field.value.length, field.value.length)
    })

    reveal().click()

    expect(field.type).toBe('text')
    expect([field.selectionStart, field.selectionEnd]).toEqual([3, 3])
  })

  it('puts the caret back after the click, where Chromium sends it to the start', async () => {
    mount()
    type(password(), 'a-long-password')
    password().setSelectionRange(3, 3)
    // Chromium, after a mouse click that changed the type: once the click is over, and before the
    // next frame, the caret is at the start (measured in chrome-headless-shell 153; a scripted
    // click does not do it).
    const field = password()
    const setAttribute = field.setAttribute.bind(field)
    vi.spyOn(field, 'setAttribute').mockImplementation((name: string, value: string) => {
      setAttribute(name, value)
      if (name === 'type') {
        queueMicrotask(() => {
          field.setSelectionRange(0, 0)
        })
      }
    })

    reveal().click()
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))

    expect(field.type).toBe('text')
    expect(document.activeElement).toBe(field)
    expect([field.selectionStart, field.selectionEnd]).toEqual([3, 3])
  })

  it('keeps the autocomplete token, so a password manager still knows the field', () => {
    mount()
    reveal().click()
    expect(password().getAttribute('autocomplete')).toBe('current-password')
    expect(password().name).toBe('password')
  })

  it('hides the password again when the form is sent', async () => {
    mount()
    type(email(), 'name@example.com')
    type(password(), 'a-long-password')
    reveal().click()
    expect(password().type).toBe('text')

    host!.querySelector('form')!.requestSubmit()
    await tick()

    expect(password().type).toBe('password')
    expect(reveal().getAttribute('aria-label')).toBe('Show password')
  })

  it("hides it before the form's own submit handler runs, and the form still sends the password", async () => {
    const seen: string[] = []
    const { send } = mount(EMPTY, () => seen.push(password().type))
    type(email(), 'name@example.com')
    type(password(), 'a-long-password')
    reveal().click()
    expect(password().type).toBe('text')

    host!.querySelector('form')!.requestSubmit()
    await tick()

    // The form's handler listens in the bubble phase and was added first, with the form. The hide
    // listens in the capture phase, so it has run by then.
    expect(seen).toEqual(['password'])
    // What is sent is the form's values, so hiding first takes nothing from it.
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith({ email: 'name@example.com', password: 'a-long-password' })
  })

  it('keeps the text clear of the button: the field leaves room at its right end', () => {
    mount()
    const room = parseFloat(window.getComputedStyle(password()).paddingRight)
    const button = window.getComputedStyle(reveal())
    // At least a 44px target, and the field's text stops before it.
    expect(parseFloat(button.width)).toBeGreaterThanOrEqual(44)
    expect(room).toBeGreaterThanOrEqual(parseFloat(button.width))
  })
})
