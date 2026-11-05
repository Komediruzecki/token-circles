import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, describe, expect, it } from 'vitest'
import ToggleField from '../ToggleField'

/**
 * Every row is the switch's label (review D11, which the first-week switch had first): a tap on
 * its title, its description or the space around them flips it, once, and a disabled switch takes
 * no tap anywhere on its row.
 */
function mountRow(props: { disabled?: boolean } = {}) {
  host = document.createElement('div')
  document.body.appendChild(host)
  const [checked, setChecked] = createSignal(false)
  const changes: boolean[] = []
  dispose = render(
    () => (
      <ToggleField
        title="Autopay"
        description="Indicate that this bill is handled automatically."
        checked={checked}
        onChange={(v) => {
          changes.push(v)
          setChecked(v)
        }}
        disabled={props.disabled}
      />
    ),
    host
  )
  const toggle = host.querySelector<HTMLButtonElement>('[role="switch"]')!
  const row = host.firstElementChild as HTMLElement
  const words = (text: string) =>
    [...row.querySelectorAll('span')].find((span) => span.textContent === text)!
  return { toggle, row, words, changes }
}

let host: HTMLDivElement
let dispose: () => void

afterEach(() => {
  dispose?.()
  host?.remove()
})

describe('ToggleField', () => {
  it('keeps title, description, and switch in one accessible setting row', () => {
    host = document.createElement('div')
    document.body.appendChild(host)
    const [checked, setChecked] = createSignal(false)
    dispose = render(
      () => (
        <ToggleField
          title="Autopay"
          description="Indicate that this bill is handled automatically."
          checked={checked}
          onChange={setChecked}
          data-test-id="autopay-toggle"
        />
      ),
      host
    )

    const toggle = host.querySelector<HTMLButtonElement>('[role="switch"]')!
    const title = document.getElementById(toggle.getAttribute('aria-labelledby')!)
    const description = document.getElementById(toggle.getAttribute('aria-describedby')!)

    expect(title?.textContent).toBe('Autopay')
    expect(description?.textContent).toBe('Indicate that this bill is handled automatically.')
    expect(toggle.getAttribute('aria-checked')).toBe('false')

    toggle.click()
    expect(toggle.getAttribute('aria-checked')).toBe('true')
  })

  it('flips from anywhere on its row, once per tap', () => {
    const { toggle, row, words, changes } = mountRow()
    words('Autopay').click()
    words('Indicate that this bill is handled automatically.').click()
    row.click()
    toggle.click()
    expect(changes).toEqual([true, false, true, false])
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    expect(row.tagName).toBe('LABEL')
  })

  it('takes no tap anywhere on its row while the switch is disabled', () => {
    const { toggle, row, words, changes } = mountRow({ disabled: true })
    words('Autopay').click()
    words('Indicate that this bill is handled automatically.').click()
    row.click()
    toggle.click()
    expect(changes).toEqual([])
    expect(toggle.getAttribute('aria-checked')).toBe('false')
  })
})
