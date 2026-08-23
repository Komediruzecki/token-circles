/**
 * RangeField.
 *
 * A slider exists here because the value it carries is a trade-off rather than a figure:
 * you learn what a withdrawal rate costs by moving it and watching the rest of the page
 * answer. So the tests care about what it emits while being dragged, and about the fill
 * staying sane when the bound value sits outside the track — which it can, because the
 * same value is also editable as a number.
 */
import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, describe, expect, it, vi } from 'vitest'
import RangeField from '../RangeField'

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
  return host
}

const slider = () => host.querySelector<HTMLInputElement>('[data-test-id="rate"]')!
const readout = () => host.querySelector<HTMLElement>('[data-test-id="rate-readout"]')

describe('RangeField', () => {
  it('reports every value it is dragged through', () => {
    const onChange = vi.fn()
    mount(() => (
      <RangeField min={1} max={12} step={0.1} value={4} onChange={onChange} testId="rate" />
    ))

    for (const v of ['4.5', '7', '11.9']) {
      slider().value = v
      slider().dispatchEvent(new Event('input', { bubbles: true }))
    }
    expect(onChange.mock.calls.map((c) => c[0])).toEqual([4.5, 7, 11.9])
  })

  it('follows the value when something else changes it', () => {
    const [value, setValue] = createSignal(4)
    mount(() => (
      <RangeField min={1} max={12} step={0.1} value={value()} onChange={setValue} testId="rate" />
    ))
    expect(slider().value).toBe('4')

    setValue(9.5)
    expect(slider().value).toBe('9.5')
  })

  it('shows the value, to the precision the step implies', () => {
    mount(() => (
      <RangeField
        min={1}
        max={12}
        step={0.1}
        value={4}
        onChange={() => {}}
        suffix="%"
        testId="rate"
      />
    ))
    expect(readout()!.textContent).toBe('4.0%')
  })

  it('drops its own readout when the caller supplies one', () => {
    mount(() => (
      <RangeField
        min={1}
        max={12}
        step={0.1}
        value={4}
        onChange={() => {}}
        showReadout={false}
        testId="rate"
      />
    ))
    expect(readout()).toBeNull()
  })

  it('fills the track in proportion to the value', () => {
    const [value, setValue] = createSignal(1)
    mount(() => (
      <RangeField min={1} max={11} step={0.1} value={value()} onChange={setValue} testId="rate" />
    ))
    const fill = () => slider().style.getPropertyValue('--fill')

    expect(fill()).toBe('0%')
    setValue(6)
    expect(fill()).toBe('50%')
    setValue(11)
    expect(fill()).toBe('100%')
  })

  it('clamps the fill for a value typed outside the track', () => {
    // The same figure is editable as a number, so it can legitimately be off the slider.
    // A gradient stop past either end paints the whole track anyway; the point is that it
    // stays a percentage rather than becoming NaN or a negative length.
    const [value, setValue] = createSignal(4)
    mount(() => (
      <RangeField min={1} max={12} step={0.1} value={value()} onChange={setValue} testId="rate" />
    ))
    setValue(50)
    expect(slider().style.getPropertyValue('--fill')).toBe('100%')
    setValue(-20)
    expect(slider().style.getPropertyValue('--fill')).toBe('0%')
  })

  it('does not divide by a zero-width range', () => {
    mount(() => (
      <RangeField min={5} max={5} step={0.1} value={5} onChange={() => {}} testId="rate" />
    ))
    expect(slider().style.getPropertyValue('--fill')).toBe('0%')
  })

  it('shows a whole number when the step is a whole number', () => {
    mount(() => (
      <RangeField min={0} max={100} step={1} value={42} onChange={() => {}} testId="rate" />
    ))
    expect(readout()!.textContent).toBe('42')
  })

  it('honours an explicit precision over the one the step implies', () => {
    mount(() => (
      <RangeField
        min={0}
        max={100}
        step={1}
        value={42}
        onChange={() => {}}
        decimals={2}
        testId="rate"
      />
    ))
    expect(readout()!.textContent).toBe('42.00')
  })

  it('works with no test id and no suffix', () => {
    mount(() => <RangeField min={1} max={12} step={0.1} value={4} onChange={() => {}} />)
    const input = host.querySelector<HTMLInputElement>('input[type="range"]')!
    expect(input.getAttribute('data-test-id')).toBeNull()
    expect(host.textContent).toBe('4.0')
  })

  it('ignores an input event that carries no number', () => {
    const onChange = vi.fn()
    mount(() => (
      <RangeField min={1} max={12} step={0.1} value={4} onChange={onChange} testId="rate" />
    ))
    // A range input cannot normally produce this, but the guard is what keeps a NaN out
    // of the model if one ever does.
    Object.defineProperty(slider(), 'value', { value: 'not a number', configurable: true })
    slider().dispatchEvent(new Event('input', { bubbles: true }))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('names itself for a screen reader and can be disabled', () => {
    mount(() => (
      <RangeField
        min={1}
        max={12}
        step={0.1}
        value={4}
        onChange={() => {}}
        ariaLabel="Withdrawal rate, percent"
        disabled
        testId="rate"
      />
    ))
    expect(slider().getAttribute('aria-label')).toBe('Withdrawal rate, percent')
    expect(slider().disabled).toBe(true)
  })
})
