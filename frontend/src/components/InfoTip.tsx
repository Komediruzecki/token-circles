/**
 * InfoTip — a circled-i that reveals a short explanation.
 *
 * The first version leaned on the native `title` attribute. That is hover-only: on a
 * phone there is no hover, so every explanation in the app was simply unreachable, and
 * on desktop it arrived after a second's delay in the browser's own styling. This one
 * opens on hover or keyboard focus for a mouse, on tap for touch, and can be pinned
 * open with a click so the text stays put while you read it.
 *
 * The panel is `position: fixed`, placed from the trigger's measured box. Anchoring it
 * absolutely inside the field would have been simpler, but these sit in a narrow form
 * column and would be clipped by the first `overflow` ancestor.
 *
 * Nothing here occupies layout: the point of the rewrite is that an explanation no
 * longer pushes the control it explains out of line with its neighbour.
 */
import { createSignal, createUniqueId, onCleanup, Show } from 'solid-js'
import styles from './InfoTip.module.css'

interface InfoTipProps {
  /** The explanation. Plain text — keep it to a sentence or two. */
  text: string
  testId?: string
  /**
   * Screen-reader name for the trigger. Defaults to the explanation itself: the tip is
   * the only place some copy lives — the Budgets page states its whole model in one —
   * and a generic name would leave that reachable by sighted pointer alone.
   */
  label?: string
}

/** Keeps the panel inside the viewport with a margin, whichever edge it runs at. */
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

export default function InfoTip(props: InfoTipProps) {
  const panelId = createUniqueId()
  const [open, setOpen] = createSignal(false)
  const [pos, setPos] = createSignal({ top: 0, left: 0 })
  // A click pins the panel; hovering away then leaves it alone. Without this, reading a
  // tip on a touch-and-mouse laptop means keeping the pointer perfectly still.
  let pinned = false
  // Escape has to hand focus back to the trigger, and focus is also what opens the panel.
  // Without this the panel closed and reopened in the same tick, so Escape did nothing.
  let suppressFocusOpen = false
  let trigger!: HTMLButtonElement
  let panel: HTMLDivElement | undefined

  const place = () => {
    const box = trigger.getBoundingClientRect()
    const margin = 8
    const width = panel?.offsetWidth ?? 280
    const height = panel?.offsetHeight ?? 0
    // Centred under the icon, then pulled back inside whichever edge it overhangs.
    const left = clamp(
      box.left + box.width / 2 - width / 2,
      margin,
      Math.max(margin, window.innerWidth - width - margin)
    )
    // Below by default; above when there is no room below but there is above.
    const below = box.bottom + 6
    const fitsBelow = below + height + margin <= window.innerHeight
    const top = fitsBelow || box.top - height - 6 < margin ? below : box.top - height - 6
    setPos({ top, left })
  }

  const show = () => {
    setOpen(true)
    // Place once from the fallback size so the panel never paints at the origin, then
    // again next frame once it exists and can be measured for real.
    place()
    requestAnimationFrame(place)
  }

  const hide = () => {
    pinned = false
    setOpen(false)
  }

  const onDocumentPointerDown = (e: Event) => {
    if (!open()) return
    const target = e.target as Node | null
    if (target && (trigger.contains(target) || panel?.contains(target))) return
    hide()
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && open()) {
      hide()
      suppressFocusOpen = true
      trigger.focus()
      // When focus was already on the trigger no focus event fires to clear the flag;
      // the eventual blur does.
    }
  }

  // Reposition rather than close: a tip read while the page scrolls should follow its
  // icon, not vanish. Capture phase so scrolling containers count, not just the window.
  const onReflow = () => {
    if (open()) place()
  }

  document.addEventListener('pointerdown', onDocumentPointerDown, true)
  document.addEventListener('keydown', onKeyDown)
  window.addEventListener('scroll', onReflow, true)
  window.addEventListener('resize', onReflow)
  onCleanup(() => {
    document.removeEventListener('pointerdown', onDocumentPointerDown, true)
    document.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('scroll', onReflow, true)
    window.removeEventListener('resize', onReflow)
  })

  return (
    <>
      <button
        ref={trigger}
        type="button"
        class={styles.trigger}
        data-test-id={props.testId}
        aria-label={props.label ?? props.text}
        aria-expanded={open()}
        aria-describedby={open() ? panelId : undefined}
        onPointerEnter={(e) => {
          if (e.pointerType === 'mouse') show()
        }}
        onPointerLeave={(e) => {
          if (e.pointerType === 'mouse' && !pinned) setOpen(false)
        }}
        onFocus={() => {
          if (suppressFocusOpen) {
            suppressFocusOpen = false
            return
          }
          show()
        }}
        onBlur={() => {
          suppressFocusOpen = false
          if (!pinned) setOpen(false)
        }}
        onClick={() => {
          if (open() && pinned) {
            hide()
            return
          }
          pinned = true
          show()
        }}
      >
        <svg
          width="12"
          height="12"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="10" />
          <path stroke-linecap="round" d="M12 16v-4m0-4h.01" />
        </svg>
      </button>
      <Show when={open()}>
        <div
          ref={panel}
          id={panelId}
          role="tooltip"
          class={styles.panel}
          data-test-id={props.testId ? `${props.testId}-panel` : undefined}
          style={{ top: `${pos().top}px`, left: `${pos().left}px` }}
        >
          {props.text}
        </div>
      </Show>
    </>
  )
}
