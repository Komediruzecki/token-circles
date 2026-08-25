/**
 * TokenOrbitLink.
 *
 * The class names matter more than they look. Each token's class comes from the CSS module
 * (`styles.t1`), and `.t1` is declared ONLY inside the nested
 * `@media (prefers-reduced-motion) > @supports` block — unlike `.t2` and `.t3`, which also
 * appear at the top level. If the transform did not export a local for a class it only ever
 * saw inside two nested at-rules, `styles.t1` would be `undefined` and the token would render
 * `class="token undefined"`: no crash, no failing build, just one token silently unstyled and
 * parked at the corner of the pill under reduced motion. That is the case worth pinning.
 */
import { render } from 'solid-js/web'
import { afterEach, describe, expect, it, vi } from 'vitest'
import TokenOrbitLink from '../TokenOrbitLink'

let dispose: (() => void) | undefined
let host: HTMLDivElement | undefined

const mount = (ui: () => ReturnType<typeof TokenOrbitLink>) => {
  host = document.createElement('div')
  document.body.appendChild(host)
  dispose = render(ui, host)
  return host
}

afterEach(() => {
  dispose?.()
  host?.remove()
  dispose = undefined
  host = undefined
})

const button = (el: HTMLElement) => el.querySelector('button') as HTMLButtonElement
const tokens = (el: HTMLElement) => [...el.querySelectorAll('span[aria-hidden="true"]')]

describe('TokenOrbitLink', () => {
  it('gives every token a real class, including the one only declared inside nested at-rules', () => {
    const el = mount(() => <TokenOrbitLink onClick={() => {}}>Manage</TokenOrbitLink>)

    const classes = tokens(el).map((t) => t.getAttribute('class') ?? '')
    expect(classes).toHaveLength(3)
    for (const c of classes) {
      expect(c).not.toContain('undefined')
      expect(c.split(' ').filter(Boolean)).toHaveLength(2) // the shared token class + its own
    }
    // ...and the three are actually distinct, so they cannot all animate as one.
    expect(new Set(classes).size).toBe(3)
  })

  it('renders the label and keeps the tokens out of the accessibility tree', () => {
    const el = mount(() => <TokenOrbitLink onClick={() => {}}>Manage or cancel</TokenOrbitLink>)

    expect(button(el).textContent).toBe('Manage or cancel')
    expect(tokens(el).every((t) => t.getAttribute('aria-hidden') === 'true')).toBe(true)
  })

  it('forwards button attributes, so callers keep their test ids and disabled state', () => {
    const el = mount(() => (
      <TokenOrbitLink onClick={() => {}} disabled data-testid="billing-manage-link">
        Manage
      </TokenOrbitLink>
    ))

    expect(button(el).getAttribute('data-testid')).toBe('billing-manage-link')
    expect(button(el).disabled).toBe(true)
    expect(button(el).type).toBe('button') // never submits a form it happens to sit in
  })

  it('marks itself busy only when asked', () => {
    const idle = mount(() => <TokenOrbitLink onClick={() => {}}>Manage</TokenOrbitLink>)
    const idleClass = button(idle).getAttribute('class') ?? ''
    dispose?.()
    host?.remove()

    const busy = mount(() => (
      <TokenOrbitLink onClick={() => {}} busy>
        Redirecting…
      </TokenOrbitLink>
    ))
    const busyClass = button(busy).getAttribute('class') ?? ''

    expect(busyClass.split(' ').filter(Boolean).length).toBe(
      idleClass.split(' ').filter(Boolean).length + 1
    )
    expect(busyClass).not.toContain('undefined')
  })

  it('calls onClick', () => {
    const onClick = vi.fn()
    const el = mount(() => <TokenOrbitLink onClick={onClick}>Manage</TokenOrbitLink>)

    button(el).click()

    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('does not call onClick while disabled', () => {
    const onClick = vi.fn()
    const el = mount(() => (
      <TokenOrbitLink onClick={onClick} disabled>
        Manage
      </TokenOrbitLink>
    ))

    button(el).click()

    expect(onClick).not.toHaveBeenCalled()
  })
})
