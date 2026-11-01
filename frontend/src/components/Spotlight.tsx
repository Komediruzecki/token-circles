/**
 * Spotlight Component
 * Full-screen walkthrough overlay with target highlighting and tooltip
 */
import { createEffect, createMemo, createSignal, onCleanup } from 'solid-js'
import { isActivatableTarget, isEditableTarget } from '../core/domFocus'
import {
  endSpotlight,
  nextSpotlightStep,
  prevSpotlightStep,
  spotlightActive,
  spotlightStep,
  tourKeyAction,
  tourSteps,
} from '../core/spotlightStore'
import styles from './Spotlight.module.css'
import { placeTip } from './spotlightPlacement'

const TOOLTIP_WIDTH = 320
// What the tip measures when it cannot be measured (not laid out yet, or no layout at all as in
// jsdom). The tallest tip the tour walk measured on main on 2026-11-01, Settings tabs at both
// widths: erring tall only makes a side look too small, never lets the tip run over the target.
const TOOLTIP_FALLBACK_HEIGHT = 247
// At this width and under, the tip spans the screen this far in from each edge (its width is set
// to match in Spotlight.module.css), so it can go above, below or over a target, never beside it.
const PHONE_MAX_WIDTH = 480
const PHONE_TIP_INSET = 16

export default function Spotlight() {
  const [highlight, setHighlight] = createSignal({
    top: 0,
    left: 0,
    width: 0,
    height: 0,
    rx: 8,
    visible: false,
  })
  const [tooltip, setTooltip] = createSignal({ top: 0, left: 0, placement: 'bottom' })
  const [tooltipReady, setTooltipReady] = createSignal(false)
  const [targetMissing, setTargetMissing] = createSignal(false)
  const [viewport, setViewport] = createSignal({ w: window.innerWidth, h: window.innerHeight })

  let tooltipRef: HTMLDivElement | undefined

  const steps = createMemo(() => tourSteps())
  const stepIdx = createMemo(() => spotlightStep())
  const currentStep = createMemo(() => steps()[stepIdx()])

  const isFirst = createMemo(() => stepIdx() === 0)
  const isLast = createMemo(() => stepIdx() === steps().length - 1)

  // Wait for the target to appear. After a step change we may be navigating to a
  // different (lazy-loaded) page, so watch the DOM with a MutationObserver and give it a
  // generous timeout instead of a fixed poll count that can expire before the chunk mounts.
  const waitForTarget = (selector: string, timeout = 6000): Promise<HTMLElement | null> => {
    return new Promise((resolve) => {
      const existing = document.querySelector<HTMLElement>(selector)
      if (existing) {
        resolve(existing)
        return
      }
      let settled = false
      const finish = (el: HTMLElement | null) => {
        if (settled) return
        settled = true
        observer.disconnect()
        clearTimeout(timer)
        resolve(el)
      }
      const observer = new MutationObserver(() => {
        const el = document.querySelector<HTMLElement>(selector)
        if (el) finish(el)
      })
      observer.observe(document.body, { childList: true, subtree: true, attributes: true })
      const timer = setTimeout(() => {
        finish(null)
      }, timeout)
    })
  }

  // Whether this step has had its one chance to scroll its target into view. Reset when the step
  // starts; see the end of updatePositions.
  let revealed = false

  const updatePositions = () => {
    const step = currentStep()
    if (!step) return

    const selector = step.targetSelector

    if (!selector) {
      // No target — center tooltip
      setHighlight({ top: 0, left: 0, width: 0, height: 0, rx: 8, visible: false })
      const vw = window.innerWidth
      const vh = window.innerHeight
      setTooltip({
        top: vh / 2 - 100,
        left: vw / 2 - TOOLTIP_WIDTH / 2,
        placement: 'center',
      })
      setTargetMissing(false)
      setTooltipReady(true)
      return
    }

    const target = document.querySelector(selector) as HTMLElement
    if (!target) {
      // Absent, but not missing — not yet. This function runs from the resize/scroll handler
      // and from a 100ms timer, both of which fire while a lazily-loaded page is still
      // mounting. The step-change effect below owns that wait (6s, then showTargetMissing),
      // and it is the only thing that knows the budget has run out. Raising the banner from
      // here made every tour step that navigates to a lazy page flash "target missing" over a
      // step that resolved a moment later — which is what the tour gate caught on Settings.
      setHighlight({ top: 0, left: 0, width: 0, height: 0, rx: 8, visible: false })
      return
    }

    setTargetMissing(false)
    const rect = target.getBoundingClientRect()
    const pad = 6

    setHighlight({
      top: rect.top - pad,
      left: rect.left - pad,
      width: rect.width + pad * 2,
      height: rect.height + pad * 2,
      rx: Math.min(8, (rect.height + pad * 2) / 4),
      visible: true,
    })

    // Measured every time: the tip's height follows its copy, from 167px to 247px on the tours
    // as they are. offsetWidth/Height ignore the entry transform, so mid-animation is fine.
    const tip = {
      width: tooltipRef?.offsetWidth || TOOLTIP_WIDTH,
      height: tooltipRef?.offsetHeight || TOOLTIP_FALLBACK_HEIGHT,
    }
    const vw = window.innerWidth
    setTooltip(
      placeTip({
        viewport: { width: vw, height: window.innerHeight },
        target: rect,
        tip,
        preferred: step.placement,
        pinnedLeft: vw <= PHONE_MAX_WIDTH ? PHONE_TIP_INSET : undefined,
      })
    )
    setTooltipReady(true)

    // Bring the target into view once, when the step first finds it. This runs from the scroll
    // handler too, and checking there pulled the page back on every scroll: a target taller than
    // the screen can never sit 80px clear of both edges, so a user could not scroll through it.
    if (revealed) return
    revealed = true
    const margin = 80
    if (rect.top < margin || rect.bottom > window.innerHeight - margin) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }

  const showTargetMissing = () => {
    const vw = window.innerWidth
    const vh = window.innerHeight
    setHighlight({ top: 0, left: 0, width: 0, height: 0, rx: 8, visible: false })
    setTooltip({ top: vh / 2 - 100, left: vw / 2 - TOOLTIP_WIDTH / 2, placement: 'center' })
    setTargetMissing(true)
    setTooltipReady(true)
  }

  // Effect: when the step changes, wait for its target (we may be mid-navigation to
  // another page) then position the highlight. A per-run token drops stale resolutions
  // so a slow lookup from a previous step can't clobber the current one.
  createEffect(() => {
    const step = currentStep()
    if (!step || !spotlightActive()) return

    const selector = step.targetSelector
    const runStep = stepIdx()
    revealed = false
    setTargetMissing(false)
    setTooltipReady(false)

    if (!selector) {
      setTimeout(() => {
        if (stepIdx() === runStep) updatePositions()
      }, 50)
      return
    }

    // Try immediate match first (already on correct page)
    const immediate = document.querySelector(selector) as HTMLElement | null
    if (immediate) {
      updatePositions()
      return
    }

    // Wait for the element (navigation + lazy chunk + data render may still be in flight)
    waitForTarget(selector).then((el) => {
      if (stepIdx() !== runStep || !spotlightActive()) return // step advanced while waiting
      if (!el) {
        showTargetMissing()
        return
      }
      updatePositions()
    })
  })

  // Effect: reposition on resize/scroll
  createEffect(() => {
    if (!spotlightActive()) return

    const onResize = () => {
      setViewport({ w: window.innerWidth, h: window.innerHeight })
      updatePositions()
    }
    window.addEventListener('resize', onResize)
    window.addEventListener('scroll', onResize, { passive: true })

    // Initial position after render
    setTimeout(() => {
      updatePositions()
    }, 100)

    onCleanup(() => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('scroll', onResize)
    })
  })

  // Keyboard navigation
  createEffect(() => {
    if (!spotlightActive()) return

    const onKey = (e: KeyboardEvent) => {
      // `includeResting` because ←/→ are exactly the keys a range input and a radio group
      // drive themselves, and the tour overlay does not take focus.
      const action = tourKeyAction(e.key, {
        modifier: e.ctrlKey || e.metaKey || e.altKey,
        editableFocus: isEditableTarget(document.activeElement, { includeResting: true }),
        activatableFocus: isActivatableTarget(document.activeElement),
      })
      if (!action) return
      // preventDefault matters as much as the guard: without it, Enter on the tour's own Next
      // button both activated the button and advanced the step, skipping two at a time.
      e.preventDefault()
      if (action === 'next') nextSpotlightStep()
      else if (action === 'prev') prevSpotlightStep()
      else endSpotlight()
    }
    window.addEventListener('keydown', onKey)
    onCleanup(() => {
      window.removeEventListener('keydown', onKey)
    })
  })

  const tooltipStyle = () => {
    const t = tooltip()
    return {
      top: `${t.top}px`,
      left: `${t.left}px`,
    }
  }

  return (
    <div class={styles.overlay}>
      {/* Backdrop with cutout highlight */}
      <svg class={styles.backdropSvg} viewBox={`0 0 ${viewport().w} ${viewport().h}`}>
        <defs>
          <mask id="spotlight-mask">
            <rect width="100%" height="100%" fill="white" />
            <rect
              x={highlight().left}
              y={highlight().top}
              width={highlight().width}
              height={highlight().height}
              rx={highlight().rx}
              fill="black"
            />
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="rgba(0,0,0,0.55)" mask="url(#spotlight-mask)" />
        {/* Border glow around highlight */}
        {highlight().visible && (
          <rect
            x={highlight().left}
            y={highlight().top}
            width={highlight().width}
            height={highlight().height}
            rx={highlight().rx}
            fill="none"
            stroke="var(--primary, #3b82f6)"
            stroke-width="2"
            opacity="0.8"
          />
        )}
      </svg>

      {/* Tooltip. Placement comes out of tooltipStyle(), which computes the position outright,
          so there are no per-placement classes to toggle here. */}
      <div
        ref={tooltipRef}
        class={styles.tooltip}
        classList={{ [styles.visible]: tooltipReady() }}
        style={tooltipStyle()}
      >
        {targetMissing() && currentStep().targetSelector && (
          <div class={styles.targetMissing}>
            This step's feature isn't visible on the current page. Click Next to continue, or
            navigate to the relevant page and the highlight will appear.
          </div>
        )}

        <div class={styles.stepCounter}>
          Step {stepIdx() + 1} of {steps().length}
        </div>

        <h3 class={styles.title}>{currentStep().title}</h3>
        <p class={styles.description}>{currentStep().description}</p>

        <div class={styles.actions}>
          <button class={styles.btnGhost} onClick={endSpotlight}>
            End Tour
          </button>
          <div class={styles.navActions}>
            <button class={styles.btnGhost} onClick={prevSpotlightStep} disabled={isFirst()}>
              Back
            </button>
            <button class={styles.btnPrimary} onClick={nextSpotlightStep}>
              {isLast() ? 'Finish' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
