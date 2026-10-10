/**
 * TwofaSettings — the Settings card: enroll (secret + confirm code -> recovery codes shown
 * exactly once), status display, and the disable flow that demands a code.
 *
 * Both code steps are kit forms: a code left empty is marked and focused before anything is
 * sent, a code the Worker does not take is marked at the field in the Worker's words, and the rest
 * of what the Worker says is the form's notice, with the field unmarked.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { refusalOf } from '../../../../shared/refusal'
import { SIGN_IN_MESSAGES as SAY } from '../../../../shared/signInSchema'

let host: HTMLDivElement
let dispose: (() => void) | undefined
const requests: { url: string; body: unknown }[] = []
const toasts: { message: string; type: string }[] = []
let statusResponse: () => Promise<Response> = () =>
  Promise.resolve(json({ enabled: false, recoveryCodesLeft: 0 }))
let setupResponse: () => Promise<Response> = () =>
  Promise.resolve(json({ secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', otpauthUri: 'otpauth://x' }))
let enableResponse: () => Promise<Response> = () => Promise.resolve(json({ recoveryCodes: CODES }))
let disableResponse: () => Promise<Response> = () => Promise.resolve(json({ ok: true }))

const CODES = Array.from({ length: 10 }, (_, i) => `AAAA${i}-BBBB${i}`)

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

async function mount() {
  vi.resetModules()
  vi.doMock('../../core/api', () => ({
    toast: (message: string, type = 'info') => toasts.push({ message, type }),
  }))
  vi.doMock('../../core/apiFetch', () => ({
    apiFetch: (url: string, init?: RequestInit) => {
      requests.push({ url, body: init?.body ? JSON.parse(init.body as string) : undefined })
      if (url === '/api/auth/2fa/status') return statusResponse()
      if (url === '/api/auth/2fa/setup') return setupResponse()
      if (url === '/api/auth/2fa/enable') return enableResponse()
      if (url === '/api/auth/2fa/disable') return disableResponse()
      return Promise.resolve(json({ error: 'unexpected' }, 500))
    },
  }))
  const { default: TwofaSettings } = await import('../TwofaSettings')
  host = document.createElement('div')
  document.body.appendChild(host)
  dispose = render(() => <TwofaSettings />, host)
  await flush()
}

const flush = async () => {
  for (let i = 0; i < 6; i += 1) await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

function type(selector: string, value: string) {
  const input = host.querySelector<HTMLInputElement>(selector)!
  input.focus()
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

const field = (testId: string) =>
  host.querySelector<HTMLInputElement>(`[data-test-id="${testId}"]`)!
const describedBy = (el: HTMLElement): string[] =>
  (el.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? `(missing #${id})`)
const marked = (el: HTMLElement) => el.getAttribute('aria-invalid') === 'true'
const notice = () => host.querySelector('[data-test-id="twofa-error"]')?.textContent ?? ''
/** The label the browser gives the control: the one its id points a `<label>` at. */
const labelOf = (el: HTMLElement) => host.querySelector(`label[for="${el.id}"]`)?.textContent
/**
 * The border properties set on the element itself, its corners aside. The form kit draws a marked
 * field's border with a rule (Form.module.css), and a border set on the element would win over it.
 * jsdom applies no style sheets, so this reads the element's own style, not the border a browser
 * computes.
 */
const ownBorder = (el: HTMLElement) =>
  Array.from(el.style).filter((p) => p.startsWith('border') && !p.endsWith('radius'))

async function confirm(testId: 'twofa-enroll' | 'twofa-disable', code: string) {
  type(`[data-test-id="${testId}-code"]`, code)
  host.querySelector<HTMLButtonElement>(`[data-test-id="${testId}-confirm"]`)!.click()
  await flush()
}

async function startEnroll() {
  await mount()
  host.querySelector<HTMLButtonElement>('[data-test-id="twofa-enable-btn"]')!.click()
  await flush()
}

beforeEach(() => {
  requests.length = 0
  toasts.length = 0
  statusResponse = () => Promise.resolve(json({ enabled: false, recoveryCodesLeft: 0 }))
  setupResponse = () =>
    Promise.resolve(json({ secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', otpauthUri: 'otpauth://x' }))
  enableResponse = () => Promise.resolve(json({ recoveryCodes: CODES }))
  disableResponse = () => Promise.resolve(json({ ok: true }))
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  host?.remove()
  vi.resetModules()
})

describe('enrollment', () => {
  it('Enable fetches a secret and shows it with the otpauth link', async () => {
    await mount()
    host.querySelector<HTMLButtonElement>('[data-test-id="twofa-enable-btn"]')!.click()
    await flush()

    expect(requests.map((r) => r.url)).toContain('/api/auth/2fa/setup')
    expect(host.querySelector('[data-test-id="twofa-secret"]')!.textContent).toContain(
      'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
    )
    expect(
      host.querySelector<HTMLAnchorElement>('[data-test-id="twofa-otpauth"]')!.getAttribute('href')
    ).toBe('otpauth://x')
  })

  it('renders the otpauth URI as an inline SVG QR code', async () => {
    await mount()
    host.querySelector<HTMLButtonElement>('[data-test-id="twofa-enable-btn"]')!.click()
    await flush()

    const qr = host.querySelector('[data-test-id="twofa-qr"]')
    expect(qr).not.toBeNull()
    // Rendered locally — the secret must never travel to a QR image service.
    expect(qr!.querySelector('svg')).not.toBeNull()
  })

  it('offers the codes as a downloadable file, not only the clipboard', async () => {
    const blobs: Blob[] = []
    // Patch only the two static methods — replacing the URL global breaks `new URL(...)`.
    const saved = { create: URL.createObjectURL?.bind(URL), revoke: URL.revokeObjectURL?.bind(URL) }
    URL.createObjectURL = ((b: Blob) => {
      blobs.push(b)
      return 'blob:fake'
    }) as typeof URL.createObjectURL
    URL.revokeObjectURL = (() => {}) as typeof URL.revokeObjectURL
    try {
      await mount()
      host.querySelector<HTMLButtonElement>('[data-test-id="twofa-enable-btn"]')!.click()
      await flush()
      type('[data-test-id="twofa-enroll-code"]', '123456')
      host.querySelector<HTMLButtonElement>('[data-test-id="twofa-enroll-confirm"]')!.click()
      await flush()

      host.querySelector<HTMLButtonElement>('[data-test-id="twofa-download-codes"]')!.click()
      await flush()
      expect(blobs).toHaveLength(1)
      expect(await blobs[0].text()).toContain(CODES[0])
    } finally {
      URL.createObjectURL = saved.create
      URL.revokeObjectURL = saved.revoke
    }
  })

  it('confirming a code stores it and shows the ten recovery codes once', async () => {
    await mount()
    host.querySelector<HTMLButtonElement>('[data-test-id="twofa-enable-btn"]')!.click()
    await flush()
    type('[data-test-id="twofa-enroll-code"]', '123456')
    host.querySelector<HTMLButtonElement>('[data-test-id="twofa-enroll-confirm"]')!.click()
    await flush()

    const enable = requests.find((r) => r.url === '/api/auth/2fa/enable')
    expect(enable?.body).toEqual({ code: '123456' })
    const codesBox = host.querySelector('[data-test-id="twofa-recovery-codes"]')!
    for (const code of CODES) expect(codesBox.textContent).toContain(code)
  })

  it('a rejected code keeps the enroll step and marks the code, in the Worker words', async () => {
    enableResponse = () => Promise.resolve(json(refusalOf({ code: SAY.appCodeRefused }), 401))
    await startEnroll()
    await confirm('twofa-enroll', '000000')

    expect(marked(field('twofa-enroll-code'))).toBe(true)
    expect(describedBy(field('twofa-enroll-code'))).toContain(SAY.appCodeRefused)
    expect(document.activeElement).toBe(field('twofa-enroll-code'))
    expect(notice()).toBe('')
    expect(toasts).toEqual([])
  })

  it('labels the code with the step that asks for it', async () => {
    await startEnroll()

    expect(labelOf(field('twofa-enroll-code'))).toBe('2. Enter the 6-digit code the app shows:')
  })

  it('marks an empty code and sends nothing', async () => {
    await startEnroll()
    await confirm('twofa-enroll', '  ')

    expect(marked(field('twofa-enroll-code'))).toBe(true)
    expect(describedBy(field('twofa-enroll-code'))).toContain(SAY.appCode)
    expect(document.activeElement).toBe(field('twofa-enroll-code'))
    expect(requests.map((r) => r.url)).not.toContain('/api/auth/2fa/enable')
  })

  it('sets no border on the code field, so a marked code takes the form kit border', async () => {
    await startEnroll()
    await confirm('twofa-enroll', '')

    expect(marked(field('twofa-enroll-code'))).toBe(true)
    expect(ownBorder(field('twofa-enroll-code'))).toEqual([])
  })

  it('says a setup that is no longer there in the notice, and marks no field', async () => {
    enableResponse = () => Promise.resolve(json({ error: 'No 2FA setup in progress' }, 400))
    await startEnroll()
    await confirm('twofa-enroll', '123456')

    expect(notice()).toBe('No 2FA setup in progress')
    expect(marked(field('twofa-enroll-code'))).toBe(false)
  })
})

describe('enabled state and disable', () => {
  beforeEach(() => {
    statusResponse = () => Promise.resolve(json({ enabled: true, recoveryCodesLeft: 7 }))
  })

  it('shows the enabled badge and how many recovery codes remain', async () => {
    await mount()
    expect(host.querySelector('[data-test-id="twofa-enabled-badge"]')).not.toBeNull()
    expect(host.textContent).toContain('7')
    expect(host.querySelector('[data-test-id="twofa-codes-low"]')).toBeNull()
  })

  it('warns when recovery codes are running low', async () => {
    // The codes are the only path back in after a lost authenticator; a user who silently
    // burns down to zero is permanently locked out, so the drop must be loud before that.
    statusResponse = () => Promise.resolve(json({ enabled: true, recoveryCodesLeft: 2 }))
    await mount()
    expect(host.querySelector('[data-test-id="twofa-codes-low"]')).not.toBeNull()
  })

  it('labels the code with what it is for', async () => {
    await mount()
    host.querySelector<HTMLButtonElement>('[data-test-id="twofa-disable-btn"]')!.click()
    await flush()

    expect(labelOf(field('twofa-disable-code'))).toBe(
      'Enter a current authenticator code (or a recovery code) to turn two-factor authentication off.'
    )
  })

  it('marks an empty code and sends nothing', async () => {
    await mount()
    host.querySelector<HTMLButtonElement>('[data-test-id="twofa-disable-btn"]')!.click()
    await flush()
    await confirm('twofa-disable', '')

    expect(marked(field('twofa-disable-code'))).toBe(true)
    expect(describedBy(field('twofa-disable-code'))).toContain(SAY.secondFactor)
    expect(requests.map((r) => r.url)).not.toContain('/api/auth/2fa/disable')
  })

  it('sets no border on the code field, so a marked code takes the form kit border', async () => {
    await mount()
    host.querySelector<HTMLButtonElement>('[data-test-id="twofa-disable-btn"]')!.click()
    await flush()
    await confirm('twofa-disable', '')

    expect(marked(field('twofa-disable-code'))).toBe(true)
    expect(ownBorder(field('twofa-disable-code'))).toEqual([])
  })

  it('marks a code the Worker does not take, in its words, and stays on the step', async () => {
    disableResponse = () => Promise.resolve(json(refusalOf({ code: SAY.secondFactorRefused }), 401))
    await mount()
    host.querySelector<HTMLButtonElement>('[data-test-id="twofa-disable-btn"]')!.click()
    await flush()
    await confirm('twofa-disable', '000000')

    expect(marked(field('twofa-disable-code'))).toBe(true)
    expect(describedBy(field('twofa-disable-code'))).toContain(SAY.secondFactorRefused)
    expect(document.activeElement).toBe(field('twofa-disable-code'))
    expect(host.querySelector('[data-test-id="twofa-enable-btn"]')).toBeNull()
  })

  it('says to wait when the limit is reached, and marks no field', async () => {
    disableResponse = () =>
      Promise.resolve(json({ error: 'Too many attempts. Please try again in 15 minutes.' }, 429))
    await mount()
    host.querySelector<HTMLButtonElement>('[data-test-id="twofa-disable-btn"]')!.click()
    await flush()
    await confirm('twofa-disable', '000000')

    expect(notice()).toBe('Too many attempts. Please try again in 15 minutes.')
    expect(marked(field('twofa-disable-code'))).toBe(false)
  })

  it('disable demands a code, posts it, and returns to the disabled state', async () => {
    await mount()
    host.querySelector<HTMLButtonElement>('[data-test-id="twofa-disable-btn"]')!.click()
    await flush()
    statusResponse = () => Promise.resolve(json({ enabled: false, recoveryCodesLeft: 0 }))
    type('[data-test-id="twofa-disable-code"]', '654321')
    host.querySelector<HTMLButtonElement>('[data-test-id="twofa-disable-confirm"]')!.click()
    await flush()

    const disable = requests.find((r) => r.url === '/api/auth/2fa/disable')
    expect(disable?.body).toEqual({ code: '654321' })
    await vi.waitFor(() => {
      expect(host.querySelector('[data-test-id="twofa-enable-btn"]')).not.toBeNull()
    })
  })
})
