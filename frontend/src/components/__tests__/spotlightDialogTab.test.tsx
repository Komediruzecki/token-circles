/**
 * A running tour's card is a layer of its own: with a dialog open under it, Tab from the card's
 * buttons stays the browser's, and the dialog does not pull focus back into itself
 * (utils/dialogFocus.ts keeps Tab inside the dialog on top, but not while focus is in a layer).
 */
import { createSignal, Show } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  endSpotlight,
  setSpotlightActive,
  setSpotlightStep,
  setTourSteps,
} from '../../core/spotlightStore'
import { dialogFocus } from '../../utils/dialogFocus'
import Spotlight from '../Spotlight'

const settle = () => new Promise((r) => setTimeout(r, 0))

let host: HTMLDivElement
let dispose: (() => void) | undefined
beforeEach(() => {
  Element.prototype.scrollIntoView = () => {}
})
afterEach(() => {
  dispose?.()
  dispose = undefined
  host.remove()
  endSpotlight()
  setSpotlightActive(false)
  setTourSteps([])
})

describe("a running tour's card over a dialog", () => {
  it('keeps its own Tab', async () => {
    setTourSteps([
      {
        target: 'add',
        targetSelector: '[data-test-id="opener"]',
        title: 'Add a transaction',
        description: 'Each one counts.',
        placement: 'bottom',
      },
    ])
    setSpotlightStep(0)
    setSpotlightActive(true)
    const [open, setOpen] = createSignal(false)
    host = document.createElement('div')
    document.body.appendChild(host)
    dispose = render(
      () => (
        <>
          <button data-test-id="opener">Add transaction</button>
          <Show when={open()}>
            <div role="dialog" aria-modal="true" ref={dialogFocus}>
              <input data-test-id="amount" />
              <button>Save</button>
            </div>
          </Show>
          <Spotlight />
        </>
      ),
      host
    )
    setOpen(true)
    await settle()
    expect(document.activeElement).toBe(host.querySelector('[data-test-id="amount"]'))

    const end = [...host.querySelectorAll('button')].find((b) => b.textContent === 'End Tour')!
    end.focus()
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    end.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    expect(document.activeElement).toBe(end)
  })
})
