/**
 * Progress's addresses: `#progress` for the page, `#progress/<n>` for circle n's own view
 * (design.md 1.8, circles part 2), which reload, back and forward all keep. A query after the path
 * (the period) is not part of the route.
 */
import { hashRouteName } from './hashRoute'
import type { CircleNumber } from '../../../shared/guidance/circles'

/** Whether the address is Progress's, with or without a circle. */
export function isProgressHash(hash: string): boolean {
  return hashRouteName(hash).split('/')[0] === 'progress'
}

/** The circle `#progress/<n>` opens; null for the page itself, or for a circle that is not 1 to 7. */
export function circleFromHash(hash: string): CircleNumber | null {
  const [page, circle, ...rest] = hashRouteName(hash).split('/')
  if (page !== 'progress' || circle === undefined || rest.length > 0) return null
  return /^[1-7]$/.test(circle) ? (Number(circle) as CircleNumber) : null
}

/** The address of a circle's view, or of the page. */
export const circleHash = (circle: CircleNumber | null): string =>
  circle === null ? '#progress' : `#progress/${circle}`
