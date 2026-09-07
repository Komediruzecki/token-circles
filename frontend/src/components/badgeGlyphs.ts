/** Glyphs in a 48x48 box (centre 24,24), stroke 2.2 round, dots filled. One per badge. */
import type { AchievementId } from '../core/achievements/definitions'

const dots = (r: number, angles: number[], size = 2.2): string =>
  angles
    .map((a) => {
      const t = (a * Math.PI) / 180
      return `<circle cx="${(24 + r * Math.cos(t)).toFixed(2)}" cy="${(24 + r * Math.sin(t)).toFixed(2)}" r="${size}" fill="currentColor" stroke="none"/>`
    })
    .join('')

export const BADGE_GLYPHS: Record<AchievementId, string> = {
  'first-entry': '<path d="M24 12v24M12 24h24"/>',
  'first-import':
    '<path d="M10 28v8a2 2 0 0 0 2 2h24a2 2 0 0 0 2-2v-8"/><path d="M24 8v20M16 20l8 8 8-8"/>',
  'first-budget':
    '<path d="M10.84 19.21A14 14 0 0 1 34.72 15"/><path d="M37.16 19.21A14 14 0 0 1 26.43 37.79"/><path d="M21.57 37.79A14 14 0 0 1 10 24"/><circle cx="24" cy="24" r="2.2" fill="currentColor" stroke="none"/>',
  'named-everything':
    '<path d="M12 10h12l14 14-12 12L12 22z"/><circle cx="18" cy="16" r="2.2" fill="currentColor" stroke="none"/>',
  'goal-in-sight': '<path d="M14 40V8"/><path d="M14 10h20l-5 6 5 6H14"/>',
  'one-month':
    '<rect x="10" y="12" width="28" height="26" rx="3"/><path d="M10 20h28M17 8v8M31 8v8"/>',
  'a-quarter': `<path d="M10.21 21.57A14 14 0 0 1 37.79 21.57"/>${dots(14, [210, 270, 330], 2.6)}`,
  'saver-x3':
    '<circle cx="24" cy="30" r="8"/><circle cx="24" cy="30" r="3.4"/><path d="M24 18V6M18 12l6-6 6 6"/>',
  'held-the-line':
    '<path d="M8 32h32"/><rect x="17" y="17" width="14" height="8" rx="4"/><circle cx="24" cy="21" r="1.7" fill="currentColor" stroke="none"/>',
  'goal-reached':
    '<path d="M8 38l10-16 6 9 5-7 11 14z"/><path d="M29 24V11"/><path d="M29 11h7l-2.5 3.5 2.5 3.5h-7"/>',
  'half-a-year': `<path d="M10 24A14 14 0 0 1 38 24"/>${dots(14, [195, 225, 255, 285, 315, 345])}`,
  'a-year': `<circle cx="24" cy="24" r="14" opacity=".35"/>${dots(14, [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330])}`,
  'saver-x6': [10, 15, 20, 25, 30, 35]
    .map((y) => `<rect x="13" y="${y}" width="22" height="4.4" rx="2.2"/>`)
    .join(''),
  'two-years': '<circle cx="18" cy="24" r="10"/><circle cx="30" cy="24" r="10"/>',
  'three-years':
    '<circle cx="16" cy="24" r="8.5"/><circle cx="24" cy="24" r="8.5"/><circle cx="32" cy="24" r="8.5"/>',
  'five-years': `<circle cx="24" cy="24" r="13" opacity=".3"/>${dots(13, [234, 306, 18, 90, 162], 3)}`,
  'ten-years':
    '<path d="M24 8l4.4 9.6 10.6 1.3-7.8 7.2 2 10.4-9.2-5-9.2 5 2-10.4-7.8-7.2 10.6-1.3z"/>',
  'twenty-years': `<circle cx="24" cy="24" r="15" opacity=".25"/><circle cx="24" cy="24" r="9" opacity=".45"/>${dots(15, [270, 342, 54, 126, 198], 2.8)}${dots(9, [306, 18, 90, 162, 234], 2)}`,
  'hundred-entries': '<path d="M11 33h26M11 26h26M11 19h18"/>',
  'thousand-entries':
    '<path d="M10 36h28M10 29h28M10 22h28M10 15h20"/><circle cx="34" cy="15" r="2.4" fill="currentColor" stroke="none"/>',
  'five-thousand-entries':
    '<rect x="9" y="13" width="30" height="22" rx="3"/><path d="M9 20h30M9 27h30M19 13v22M29 13v22"/>',
  'ten-thousand-entries':
    '<rect x="8" y="11" width="26" height="26" rx="3"/><path d="M8 18h26M8 25h26M8 32h26M15 11v26M22 11v26"/><path d="M38 15v18"/>',
  'twenty-thousand-entries':
    '<rect x="7" y="10" width="24" height="28" rx="3"/><path d="M7 17h24M7 24h24M7 31h24M14 10v28M21 10v28"/><path d="M35 13v22M40 17v14"/>',
  'own-the-stack': `<rect x="10" y="9" width="28" height="9" rx="2"/><rect x="10" y="19.5" width="28" height="9" rx="2"/><rect x="10" y="30" width="28" height="9" rx="2"/>${['13.5', '24', '34.5'].map((y) => `<circle cx="15" cy="${y}" r="1.5" fill="currentColor" stroke="none"/>`).join('')}`,
}
