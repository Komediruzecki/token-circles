/**
 * Where the tour's tip goes, as a pure function of the screen, the target and the tip.
 *
 * The rule, in order:
 *   1. The step's preferred side, then bottom, top, right, left: the first side with room for
 *      the whole tip, measured against the tip's real size, wins. A tip on a side never touches
 *      the target.
 *   2. When no side has room, the tip has to sit over the target. It goes against whichever edge
 *      of the screen hides the least of the target, so most of it stays visible. A target taller
 *      than the screen has been scrolled to its start, and the top edge is not a candidate then:
 *      the tip would sit on the heading the scroll brought into view.
 *
 * This replaced a rule that assumed a 140px tip (a phone's is about 207px) and centred the tip on
 * the screen for any target wider than 75% of it before trying a side at all. On a phone that
 * put the tip over most targets; frontend/scripts/walk-tours.mjs measures it on every step.
 */
export type TipSide = 'top' | 'bottom' | 'left' | 'right'

export interface TipRect {
  top: number
  left: number
  width: number
  height: number
}

export interface TipPlacementInput {
  viewport: { width: number; height: number }
  target: TipRect
  tip: { width: number; height: number }
  preferred?: TipSide
  /**
   * Where the tip's left edge has to be, when the caller fixes it. On a phone the tip spans the
   * screen at a fixed inset, so it can only go above, below or over the target, never beside it.
   */
  pinnedLeft?: number
  /**
   * The target is taller than the screen, so Spotlight scrolled it to its start rather than its
   * centre. Covering it from the top edge would hide that start, its heading included, so the tip
   * covers it from another edge.
   */
  fromStart?: boolean
}

export interface TipPosition {
  /** A side of the target, or 'over' when the tip had to cover part of it. */
  placement: TipSide | 'over'
  top: number
  left: number
}

/** Between the tip and the target. */
export const TIP_GAP = 8
/** Between the tip and the edge of the screen. */
export const TIP_SCREEN_MARGIN = 12

const ORDER: readonly TipSide[] = ['bottom', 'top', 'right', 'left']

/** Slide a span so it stays on screen with the margin; centre it when it is too big for that. */
function clampSpan(start: number, size: number, extent: number): number {
  const max = extent - size - TIP_SCREEN_MARGIN
  if (max < TIP_SCREEN_MARGIN) return (extent - size) / 2
  return Math.min(Math.max(start, TIP_SCREEN_MARGIN), max)
}

/** The tip's left edge when lined up under or over the target's centre, and its top beside it. */
function alongTarget({ viewport, target, tip, pinnedLeft }: TipPlacementInput): {
  left: number
  top: number
} {
  return {
    left:
      pinnedLeft ??
      clampSpan(target.left + target.width / 2 - tip.width / 2, tip.width, viewport.width),
    top: clampSpan(target.top + target.height / 2 - tip.height / 2, tip.height, viewport.height),
  }
}

/** The tip on `side` of the target, or null when that side has no room for it. */
function besideTarget(side: TipSide, input: TipPlacementInput): TipPosition | null {
  const { viewport, target, tip } = input
  const along = alongTarget(input)
  switch (side) {
    case 'bottom': {
      const top = target.top + target.height + TIP_GAP
      const fits = top + tip.height <= viewport.height - TIP_SCREEN_MARGIN
      return fits ? { placement: side, top, left: along.left } : null
    }
    case 'top': {
      const top = target.top - TIP_GAP - tip.height
      return top >= TIP_SCREEN_MARGIN ? { placement: side, top, left: along.left } : null
    }
    case 'right': {
      const left = target.left + target.width + TIP_GAP
      const fits = left + tip.width <= viewport.width - TIP_SCREEN_MARGIN
      return fits ? { placement: side, top: along.top, left } : null
    }
    case 'left': {
      const left = target.left - TIP_GAP - tip.width
      return left >= TIP_SCREEN_MARGIN ? { placement: side, top: along.top, left } : null
    }
  }
}

/** The tip pushed against the screen edge on `side`, still lined up with the target. */
function againstScreenEdge(side: TipSide, input: TipPlacementInput): TipPosition {
  const { viewport, tip } = input
  const along = alongTarget(input)
  const far = (size: number, extent: number) => clampSpan(Infinity, size, extent)
  const near = (size: number, extent: number) => clampSpan(-Infinity, size, extent)
  switch (side) {
    case 'bottom':
      return { placement: 'over', top: far(tip.height, viewport.height), left: along.left }
    case 'top':
      return { placement: 'over', top: near(tip.height, viewport.height), left: along.left }
    case 'right':
      return { placement: 'over', top: along.top, left: far(tip.width, viewport.width) }
    case 'left':
      return { placement: 'over', top: along.top, left: near(tip.width, viewport.width) }
  }
}

/** How much of the target a tip at `pos` would hide, in square px. The tip is on screen, so this
 *  is only ever the part of the target the user could have seen. */
function hiddenArea(pos: TipPosition, { target, tip }: TipPlacementInput): number {
  const w =
    Math.min(pos.left + tip.width, target.left + target.width) - Math.max(pos.left, target.left)
  const h =
    Math.min(pos.top + tip.height, target.top + target.height) - Math.max(pos.top, target.top)
  return w > 0 && h > 0 ? w * h : 0
}

export function placeTip(input: TipPlacementInput): TipPosition {
  const sides = [input.preferred ?? 'bottom', ...ORDER].filter(
    (side, i, all) =>
      all.indexOf(side) === i &&
      // A pinned tip cannot move sideways, so it cannot sit beside the target either.
      (input.pinnedLeft === undefined || side === 'top' || side === 'bottom')
  )

  for (const side of sides) {
    const pos = besideTarget(side, input)
    if (pos) return pos
  }

  // No side has room, so the tip covers some of the target. Ties keep the side order. On a phone
  // the top edge hid less of a tall target than the bottom (the strip under the menu button is
  // not target), and so the tip sat on the heading that scrolling to the start had just shown.
  const edges = input.fromStart ? sides.filter((side) => side !== 'top') : sides
  let best = againstScreenEdge(edges[0], input)
  let bestHidden = hiddenArea(best, input)
  for (const side of edges.slice(1)) {
    const pos = againstScreenEdge(side, input)
    const hidden = hiddenArea(pos, input)
    if (hidden < bestHidden) {
      best = pos
      bestHidden = hidden
    }
  }
  return best
}
