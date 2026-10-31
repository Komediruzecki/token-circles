/**
 * Every print's thumbnail as an image (phase 4 design, section 7). A finished print is drawn in
 * `PAPER`'s literal colours, so its SVG stands alone as a `data:` image, which a page of 26 prints
 * keeps far cheaper than 26 inline drawings. The plate is drawn in the theme's colours, which an
 * image cannot read, so it stays inline.
 *
 * Drawing and inserting happen in turn, two per task, so a long shelf never holds the main thread
 * for long. In the prototype at 4x CPU, the whole shelf in one task held it for 69 ms; with the
 * thumbnails two per task, no task went over 50 ms (frontend/scripts/prints-perf.mjs measures
 * the built app).
 */
import { drawSeal, PAPER } from '../../../../shared/prints/seal'
import type { SealSlot } from '../../../../shared/prints/seal'

/** Thumbnails drawn so far, by their shares: an unchanged print is never drawn twice. */
const drawn = new Map<string, string>()
const KEEP = 200

/** A finished print as a `data:` image at thumbnail detail. */
export function thumbSrc(slots: readonly SealSlot[]): string {
  const key = JSON.stringify(slots)
  const known = drawn.get(key)
  if (known !== undefined) return known
  const src = `data:image/svg+xml;utf8,${encodeURIComponent(drawSeal(slots, { palette: PAPER, detail: 'thumb' }))}`
  if (drawn.size >= KEEP) drawn.delete(drawn.keys().next().value!)
  drawn.set(key, src)
  return src
}

/** How many queued jobs run in one task. */
export const PER_TASK = 2

const queue: Array<() => void> = []
let pending: ReturnType<typeof setTimeout> | undefined

function runSome(): void {
  pending = undefined
  for (const job of queue.splice(0, PER_TASK)) job()
  if (queue.length > 0) pending = setTimeout(runSome, 0)
}

/** Runs `job` in a later task, at most `PER_TASK` to a task, in order. Returns a cancel. */
export function inTurn(job: () => void): () => void {
  queue.push(job)
  pending ??= setTimeout(runSome, 0)
  return () => {
    const at = queue.indexOf(job)
    if (at >= 0) queue.splice(at, 1)
    if (queue.length === 0) {
      clearTimeout(pending)
      pending = undefined
    }
  }
}
