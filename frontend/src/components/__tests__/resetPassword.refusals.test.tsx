/**
 * The set-a-new-password screen says what is wrong where it is wrong, against the real client
 * (the typed `api`, `ApiError`) with only the network answered here.
 *
 * The link is checked when the page opens. A link the Worker answers does not work shows the screen
 * that says to ask for a new one. A check that failed (an error, no answer, or an answer that does
 * not say) says so in the kit's words, and Try again checks the link again.
 *
 * A password that is too short, and a second entry that differs from the first, are marked under
 * their fields and focused before anything is sent. A field the Worker names is marked the same
 * way. A link that stopped working while the page was open shows the screen for a link that does
 * not work. A limit reached is said in the notice, with the wait, and marks no field. None of it
 * is a toast.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GENERIC_ERROR } from '../../../../shared/genericError'
import { refusalOf } from '../../../../shared/refusal'
import { SIGN_IN_MESSAGES as SAY } from '../../../../shared/signInSchema'
import { UNREACHABLE } from '../../core/apiError'

interface Sent {
  method: string
  url: string
  body: Record<string, unknown>
}

const CHECK = 'GET /api/auth/reset-password?token=abc'
const RESET = 'POST /api/auth/reset-password'

let host: HTMLDivElement
let dispose: (() => void) | undefined
let sent: Sent[]
let answers: Record<string, () => Response>
let toasts: () => unknown[]

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

async function mount() {
  vi.resetModules()
  vi.doMock('../../core/apiFetch', () => ({
    apiFetch: async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      sent.push({
        method,
        url,
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : {},
      })
      const answer = answers[`${method} ${url}`]
      if (!answer) throw new Error(`nothing answers ${method} ${url} here`)
      try {
        return answer()
      } catch (error) {
        // No answer at all: what apiFetch throws then (core/apiFetch.ts).
        if (error instanceof TypeError) {
          throw (await import('../../core/apiError')).networkError(error)
        }
        throw error
      }
    },
  }))
  vi.doMock('../../core/storage/storageFactory', () => ({ setStorageMode: () => undefined }))
  vi.doMock('../SupportContact', () => ({ default: () => null }))
  const { default: ResetPassword } = await import('../ResetPassword')
  toasts = (await import('../../core/toastStore')).toasts
  host = document.createElement('div')
  document.body.appendChild(host)
  dispose = render(() => <ResetPassword />, host)
  await settle()
}

const settle = async () => {
  for (let i = 0; i < 8; i += 1) await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

/** The control a visible label names. */
function labelled(text: string): HTMLInputElement {
  const label = [...host.querySelectorAll('label')].find((l) => l.textContent?.trim() === text)
  if (!label) throw new Error(`no field labelled "${text}"`)
  const control = document.getElementById(label.htmlFor)
  if (!(control instanceof HTMLInputElement)) throw new Error(`"${text}" labels no input`)
  return control
}

const newPassword = () => labelled('New password')
const confirmation = () => labelled('Confirm new password')
const notice = () => host.querySelector('[data-test-id="reset-error"]')?.textContent ?? ''
const describedBy = (el: HTMLElement): string[] =>
  (el.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? `(missing #${id})`)
const marked = (el: HTMLElement) => el.getAttribute('aria-invalid') === 'true'
const resets = () => sent.filter((s) => `${s.method} ${s.url}` === RESET)
const checks = () => sent.filter((s) => `${s.method} ${s.url}` === CHECK)
const button = (text: string) =>
  [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)

/** Open the page again, with the link check answered by `answer`. */
async function openChecked(answer: () => Response) {
  dispose?.()
  host.remove()
  sent = []
  answers = { [CHECK]: answer }
  await mount()
}

function type(input: HTMLInputElement, value: string) {
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

async function setTo(first: string, second: string) {
  type(newPassword(), first)
  type(confirmation(), second)
  host.querySelector('form')!.requestSubmit()
  await settle()
}

beforeEach(async () => {
  sent = []
  answers = { [CHECK]: () => json({ valid: true }) }
  vi.stubGlobal('location', {
    hash: '#reset-password?token=abc',
    reload: () => undefined,
  } as unknown as Location)
  await mount()
})

afterEach(() => {
  dispose?.()
  host.remove()
  vi.unstubAllGlobals()
})

describe('before anything is sent', () => {
  it('marks a password shorter than 8 characters under it and focuses it', async () => {
    await setTo('short', 'short')

    expect(marked(newPassword())).toBe(true)
    expect(describedBy(newPassword())).toContain(SAY.newPassword)
    expect(document.activeElement).toBe(newPassword())
    expect(resets()).toEqual([])
  })

  it('marks a second entry that differs from the first under it and focuses it', async () => {
    await setTo('a-new-password', 'a-new-passwort')

    expect(marked(confirmation())).toBe(true)
    expect(describedBy(confirmation())).toContain(SAY.confirmPassword)
    expect(marked(newPassword())).toBe(false)
    expect(document.activeElement).toBe(confirmation())
    expect(resets()).toEqual([])
  })
})

describe('what the Worker answers', () => {
  it('sends the link and the password once both entries agree', async () => {
    answers[RESET] = () => json({ ok: true })
    await setTo('a-new-password', 'a-new-password')

    expect(resets().map((s) => s.body)).toEqual([{ token: 'abc', password: 'a-new-password' }])
    expect(host.textContent).toContain('Password updated.')
  })

  it('marks a password the Worker refuses under it, in the Worker words', async () => {
    answers[RESET] = () => json(refusalOf({ password: 'Pick a password of your own.' }), 400)
    await setTo('a-new-password', 'a-new-password')

    expect(marked(newPassword())).toBe(true)
    expect(describedBy(newPassword())).toContain('Pick a password of your own.')
    expect(document.activeElement).toBe(newPassword())
    expect(toasts()).toEqual([])
  })

  it('shows the screen for a link that does not work when the link stopped working meanwhile', async () => {
    answers[RESET] = () => json({ error: 'This reset link is invalid or has expired' }, 400)
    await setTo('a-new-password', 'a-new-password')

    expect(host.textContent).toContain(
      'This reset link is invalid or has expired. Request a new one from the sign-in screen.'
    )
    expect(host.querySelector('form')).toBeNull()
    expect(toasts()).toEqual([])
  })

  it('says to wait, and for how long, when the limit is reached, and marks no field', async () => {
    answers[RESET] = () =>
      json({ error: 'Too many attempts. Please try again in 15 minutes.' }, 429, {
        'Retry-After': '900',
      })
    await setTo('a-new-password', 'a-new-password')

    expect(notice()).toBe('Too many attempts. Please try again in 15 minutes.')
    expect(marked(newPassword())).toBe(false)
    expect(marked(confirmation())).toBe(false)
    expect(toasts()).toEqual([])
  })
})

describe('checking the link', () => {
  it('says the link does not work when the Worker answers that it does not', async () => {
    await openChecked(() => json({ valid: false }))

    expect(host.textContent).toContain(
      'This reset link is invalid or has expired. Request a new one from the sign-in screen.'
    )
    expect(host.querySelector('form')).toBeNull()
    expect(button('Try again')).toBeUndefined()
  })

  const FAILED: { what: string; answer: () => Response; says: () => Promise<string> }[] = [
    {
      what: 'an error on the Worker',
      answer: () => json({ error: GENERIC_ERROR }, 500),
      says: async () => GENERIC_ERROR,
    },
    {
      what: 'no answer',
      answer: () => {
        throw new TypeError('Failed to fetch')
      },
      says: async () => UNREACHABLE,
    },
    {
      what: 'an answer that does not say',
      answer: () => new Response('<!doctype html>', { headers: { 'Content-Type': 'text/html' } }),
      says: async () => (await import('../signInForm')).SIGN_IN_FAILED,
    },
  ]
  for (const { what, answer, says } of FAILED) {
    it(`says a check that failed with ${what} in the kit words, and Try again checks again`, async () => {
      await openChecked(answer)

      expect(host.textContent).toContain("Your reset link wasn't checked, so it may still work.")
      expect(host.textContent).toContain(await says())
      expect(host.textContent).not.toContain('invalid or has expired')
      expect(host.querySelector('form')).toBeNull()

      answers[CHECK] = () => json({ valid: true })
      button('Try again')!.click()
      await settle()

      expect(checks()).toHaveLength(2)
      expect(host.querySelector('form')).not.toBeNull()
      expect(toasts()).toEqual([])
    })
  }
})
