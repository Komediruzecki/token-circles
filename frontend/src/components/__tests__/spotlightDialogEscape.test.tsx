/**
 * Escape during a running tour with a dialog open ends the tour and leaves the dialog open: the
 * tour is drawn over the page (z-index 10000 against 1000 to 9999 for the dialogs), so only the
 * tour acts. The next Escape is the dialog's.
 *
 * Measured on 26 Nov 2026: with a tour started from Take a Tour and the shortcuts list opened with
 * "?", one Escape ended the tour and shut the list. The dialogs' Escape (utils/dialogFocus.ts) was
 * listening from Take a Tour on, before the tour was, so it shut the list first, and the tour's
 * listener does not ask whether Escape was spent.
 */
import { createSignal, Show } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  endSpotlight,
  setSpotlightActive,
  setSpotlightStep,
  setTourSteps,
  spotlightActive,
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

const escape = () => {
  const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
  ;(document.activeElement ?? document.body).dispatchEvent(event)
}

describe('Escape during a running tour with a dialog open', () => {
  it('ends the tour only, and the next Escape shuts the dialog', async () => {
    const [open, setOpen] = createSignal(false)
    host = document.createElement('div')
    document.body.appendChild(host)
    dispose = render(
      () => (
        <>
          <button data-test-id="opener">Add transaction</button>
          <Show when={open()}>
            <div
              role="dialog"
              aria-modal="true"
              ref={(el) => {
                dialogFocus(el, {
                  onEscape: () => {
                    setOpen(false)
                  },
                })
              }}
            >
              <input data-test-id="amount" />
            </div>
          </Show>
          <Show when={spotlightActive()}>
            <Spotlight />
          </Show>
        </>
      ),
      host
    )
    // The dialog's Escape listens first, as it does once Take a Tour has been open.
    setOpen(true)
    await settle()
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
    await settle()
    expect(host.querySelector('[data-tour-card]')).not.toBeNull()

    escape()
    expect(spotlightActive()).toBe(false)
    expect(open()).toBe(true)

    escape()
    expect(open()).toBe(false)
  })

  it('leaves a layer under it that hears Escape itself open too, such as the command bar', async () => {
    host = document.createElement('div')
    document.body.appendChild(host)
    dispose = render(
      () => (
        <>
          <button data-test-id="opener">Add transaction</button>
          <Show when={spotlightActive()}>
            <Spotlight />
          </Show>
        </>
      ),
      host
    )
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
    await settle()
    // Opened after the tour, and shut on any Escape the page hears, as the command bar is.
    let barOpen = true
    const shutBar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') barOpen = false
    }
    document.addEventListener('keydown', shutBar)
    try {
      escape()
      expect(spotlightActive()).toBe(false)
      expect(barOpen).toBe(true)
    } finally {
      document.removeEventListener('keydown', shutBar)
    }
  })
})
