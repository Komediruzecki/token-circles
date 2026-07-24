import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, describe, expect, it } from 'vitest'
import ToggleField from '../ToggleField'

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
})
