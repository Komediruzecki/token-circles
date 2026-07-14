/**
 * Shared Chart.js option helpers for small screens. Chart configs are inlined
 * per feature; these keep long category labels from overlapping on the x-axis
 * and keep legends compact on narrow screens.
 */

const isNarrow = () => typeof window !== 'undefined' && window.innerWidth <= 640

/**
 * Mobile-friendly x-axis tick options: rotate + auto-skip crowded labels, and
 * truncate long ones (e.g. "Conservative") on narrow screens so they don't
 * overlap. Full text stays in the tooltip. Pass extra tick options to merge.
 */
export function mobileXTicks(color: string, extra: Record<string, unknown> = {}) {
  return {
    color,
    maxRotation: 45,
    minRotation: 0,
    autoSkip: true,
    autoSkipPadding: 6,
    callback(this: { getLabelForValue(v: number): string }, value: string | number) {
      const label = this.getLabelForValue(typeof value === 'number' ? value : Number(value))
      return isNarrow() && label.length > 12 ? `${label.slice(0, 11)}…` : label
    },
    ...extra,
  }
}

/** Compact legend labels — smaller swatch + font so many series don't squish. */
export function compactLegendLabels(color: string) {
  return { usePointStyle: true, padding: 8, font: { size: 10 }, boxWidth: 8, color }
}
