/**
 * Spotlight Component
 * Full-screen walkthrough overlay with target highlighting and tooltip
 */
import { createEffect, createMemo, createSignal, onCleanup } from 'solid-js'
import {
  endSpotlight,
  nextSpotlightStep,
  prevSpotlightStep,
  skipSection,
  spotlightActive,
  spotlightStep,
  tourSteps
} from '../core/spotlightStore'
import styles from './Spotlight.module.css'
import type {SpotlightStep} from '../core/spotlightStore';

const GAP = 8
const TOOLTIP_WIDTH = 320

function bestPlacement(
  step: SpotlightStep,
  targetRect: DOMRect
): { placement: string; top: number; left: number } {
  const pref = step.placement || 'bottom'
  const vw = window.innerWidth
  const vh = window.innerHeight
  const tw = TOOLTIP_WIDTH
  const th = 140

  const placements = [pref, 'bottom', 'top', 'right', 'left'].filter(
    (v, i, a) => a.indexOf(v) === i
  )

  for (const p of placements) {
    let top = 0
    let left = 0

    switch (p) {
      case 'bottom':
        top = targetRect.bottom + GAP
        left = targetRect.left + targetRect.width / 2 - tw / 2
        break
      case 'top':
        top = targetRect.top - th - GAP
        left = targetRect.left + targetRect.width / 2 - tw / 2
        break
      case 'right':
        top = targetRect.top + targetRect.height / 2 - th / 2
        left = targetRect.right + GAP
        break
      case 'left':
        top = targetRect.top + targetRect.height / 2 - th / 2
        left = targetRect.left - tw - GAP
        break
    }

    // Clamp to viewport
    if (left < 12) left = 12
    if (left + tw > vw - 12) left = vw - tw - 12
    if (top < 12) top = 12
    if (top + th > vh - 12) top = vh - th - 12

    // Check if it fits reasonably
    if (top > 0 && left > 0 && top + th < vh && left + tw < vw) {
      return { placement: p, top, left }
    }
  }

  // Fallback: center
  return { placement: 'center', top: vh / 2 - th / 2, left: vw / 2 - tw / 2 }
}

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

  let tooltipRef: HTMLDivElement | undefined

  const steps = createMemo(() => tourSteps())
  const stepIdx = createMemo(() => spotlightStep())
  const currentStep = createMemo(() => steps()[stepIdx()])

  const isFirst = createMemo(() => stepIdx() === 0)
  const isLast = createMemo(() => stepIdx() === steps().length - 1)

  const waitForTarget = (selector: string, maxRetries = 30): Promise<HTMLElement | null> => {
    return new Promise((resolve) => {
      let attempts = 0
      const check = () => {
        const el = document.querySelector(selector) as HTMLElement
        if (el) {
          resolve(el)
          return
        }
        attempts++
        if (attempts >= maxRetries) {
          resolve(null)
          return
        }
        setTimeout(check, 100)
      }
      check()
    })
  }

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
      setTargetMissing(true)
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

    const tp = bestPlacement(step, rect)
    setTooltip(tp)
    setTooltipReady(true)

    // Scroll target into view if needed
    const margin = 80
    if (rect.top < margin || rect.bottom > window.innerHeight - margin) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }

  // Effect: when step changes, wait for target then update positions
  createEffect(() => {
    const step = currentStep()
    if (!step || !spotlightActive()) return

    const selector = step.targetSelector
    if (!selector) {
      updatePositions()
      return
    }

    waitForTarget(selector).then(() => {
      updatePositions()
    })
  })

  // Effect: reposition on resize/scroll
  createEffect(() => {
    if (!spotlightActive()) return

    const onResize = () => { updatePositions(); }
    window.addEventListener('resize', onResize)
    window.addEventListener('scroll', onResize, { passive: true })

    // Initial position after render
    setTimeout(() => { updatePositions(); }, 100)

    onCleanup(() => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('scroll', onResize)
    })
  })

  // Keyboard navigation
  createEffect(() => {
    if (!spotlightActive()) return

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'Enter') {
        nextSpotlightStep()
      } else if (e.key === 'ArrowLeft') {
        prevSpotlightStep()
      } else if (e.key === 'Escape') {
        endSpotlight()
      }
    }
    window.addEventListener('keydown', onKey)
    onCleanup(() => { window.removeEventListener('keydown', onKey); })
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
      <svg class={styles.backdropSvg} viewBox={`0 0 ${window.innerWidth} ${window.innerHeight}`}>
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

      {/* Tooltip */}
      <div
        ref={tooltipRef}
        class={styles.tooltip}
        classList={{
          [styles.visible]: tooltipReady(),
          [styles.bottom]: tooltip().placement === 'bottom',
          [styles.top]: tooltip().placement === 'top',
          [styles.center]: tooltip().placement === 'center',
        }}
        style={tooltipStyle()}
      >
        {targetMissing() && currentStep().targetSelector && (
          <div class={styles.targetMissing}>
            Navigate to this feature's page to continue the tour.
          </div>
        )}

        <div class={styles.stepCounter}>
          Step {stepIdx() + 1} of {steps().length}
        </div>

        <h3 class={styles.title}>{currentStep().title}</h3>
        <p class={styles.description}>{currentStep().description}</p>

        <div class={styles.actions}>
          <button class={styles.btnGhost} onClick={endSpotlight}>
            Skip Tour
          </button>
          <div class={styles.navActions}>
            <button class={styles.btnGhost} onClick={skipSection} disabled={isFirst()}>
              Skip Section
            </button>
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
