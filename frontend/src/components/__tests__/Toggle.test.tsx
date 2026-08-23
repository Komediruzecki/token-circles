/**
 * Toggle.
 *
 * The switch grew two things: an optional label rendered inside the button, and a compact
 * size. The label matters for accessibility as much as for layout — putting the words in
 * the control means clicking them flips it and they name it for a screen reader, which a
 * `<label>` wrapped round a `<button>` would not do. The tests hold both ends of that:
 * the existing label-less usages must be untouched, and the labelled one must behave like
 * one control rather than a switch with some text beside it.
 */
import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Toggle from '../Toggle'

let host: HTMLDivElement
let dispose: (() => void) | undefined

afterEach(() => {
  dispose?.()
  dispose = undefined
  host?.remove()
})

const mount = (ui: () => unknown) => {
  host = document.createElement('div')
  document.body.appendChild(host)
  dispose = render(ui as never, host)
  return host.querySelector<HTMLButtonElement>('[role="switch"]')!
}

describe('Toggle', () => {
  it('reports and flips its state', () => {
    const [on, setOn] = createSignal(false)
    const toggle = mount(() => <Toggle checked={on()} onChange={setOn} label="Markers" />)

    expect(toggle.getAttribute('aria-checked')).toBe('false')
    toggle.click()
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    toggle.click()
    expect(toggle.getAttribute('aria-checked')).toBe('false')
  })

  it('accepts an accessor as well as a plain boolean', () => {
    const [on, setOn] = createSignal(true)
    const toggle = mount(() => <Toggle checked={on} onChange={setOn} label="Markers" />)
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    setOn(false)
    expect(toggle.getAttribute('aria-checked')).toBe('false')
  })

  it('is a bare switch when given no label text', () => {
    const toggle = mount(() => <Toggle checked={false} onChange={() => {}} label="Markers" />)
    // What every existing usage renders: the pill and nothing else, named by aria-label.
    expect(toggle.textContent).toBe('')
    expect(toggle.getAttribute('aria-label')).toBe('Markers')
  })

  it('takes its accessible name from the label text it is given', () => {
    const toggle = mount(() => (
      <Toggle checked={false} onChange={() => {}}>
        Mark when each lifestyle is reached
      </Toggle>
    ))
    expect(toggle.textContent).toBe('Mark when each lifestyle is reached')
    expect(toggle.getAttribute('aria-label')).toBeNull()
  })

  it('flips when the label text is clicked, because the text is inside the control', () => {
    const onChange = vi.fn()
    mount(() => (
      <Toggle checked={false} onChange={onChange}>
        Show a better and worse return
      </Toggle>
    ))
    const text = host.querySelector('span:last-child')!
    text.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('prefers an explicit aria-label over the text, for a shorter spoken name', () => {
    const toggle = mount(() => (
      <Toggle checked={false} onChange={() => {}} aria-label="Lifestyle markers">
        Mark when each lifestyle is reached
      </Toggle>
    ))
    expect(toggle.getAttribute('aria-label')).toBe('Lifestyle markers')
  })

  it('carries the compact class only when asked for it', () => {
    const compact = mount(() => (
      <Toggle checked={false} onChange={() => {}} size="compact" label="A" />
    ))
    expect(compact.className).toMatch(/compact/)
    dispose?.()
    host.remove()

    const normal = mount(() => <Toggle checked={false} onChange={() => {}} label="A" />)
    expect(normal.className).not.toMatch(/compact/)
  })

  it('does not fire while disabled', () => {
    const onChange = vi.fn()
    const toggle = mount(() => (
      <Toggle checked={false} onChange={onChange} disabled label="Markers" />
    ))
    toggle.click()
    expect(onChange).not.toHaveBeenCalled()
    expect(toggle.disabled).toBe(true)
  })

  it('is a button that cannot submit the form around it', () => {
    const toggle = mount(() => <Toggle checked={false} onChange={() => {}} label="Markers" />)
    // A switch inside the assumptions form would otherwise save the plan on every flip.
    expect(toggle.getAttribute('type')).toBe('button')
  })

  it('passes through the ids the callers hang off it', () => {
    const toggle = mount(() => (
      <Toggle
        checked={false}
        onChange={() => {}}
        id="t1"
        aria-labelledby="lbl"
        aria-describedby="desc"
        data-test-id="my-toggle"
      />
    ))
    expect(toggle.id).toBe('t1')
    expect(toggle.getAttribute('aria-labelledby')).toBe('lbl')
    expect(toggle.getAttribute('aria-describedby')).toBe('desc')
    expect(toggle.getAttribute('data-test-id')).toBe('my-toggle')
  })
})
