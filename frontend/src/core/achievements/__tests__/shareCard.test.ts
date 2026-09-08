import { describe, expect, it } from 'vitest'
import { ACHIEVEMENTS } from '../definitions'
import { shareCardSvg, wrapShare } from '../shareCard'

describe('shareCardSvg', () => {
  it('is a 1200x630 SVG carrying the badge name, the share line and the URL, no raster', () => {
    const svg = shareCardSvg('a-year')
    expect(svg).toMatch(/^<svg[^>]*width="1200"[^>]*height="630"/)
    expect(svg).toContain('A year')
    expect(svg).toContain('Tracked my money for a year.')
    expect(svg).toContain('tokencircles.com')
    expect(svg).not.toMatch(/<image/)
    expect(svg).toContain('data-ring')
  })

  /*
   * The card is rasterised by handing this string to an `<img>`. Both rules below were broken at
   * once and every Share ended in "Could not build the share card": a valueless `data-ring`
   * made the document invalid XML so the image never loaded, and a `<foreignObject>` tainted the
   * canvas so `toBlob` threw. Neither is visible until someone actually presses the button.
   */
  it('is well-formed XML for every badge', () => {
    const parser = new DOMParser()
    for (const a of ACHIEVEMENTS) {
      const doc = parser.parseFromString(shareCardSvg(a.id), 'image/svg+xml')
      expect(doc.querySelector('parsererror'), a.id).toBeNull()
    }
  })

  it('carries no foreignObject, which would taint the canvas', () => {
    for (const a of ACHIEVEMENTS) expect(shareCardSvg(a.id), a.id).not.toContain('<foreignObject')
  })
})

describe('wrapShare', () => {
  it('breaks on words and keeps every one of them', () => {
    const line = 'A month with the whole picture, not just the spending.'
    const lines = wrapShare(line)
    expect(lines.length).toBeGreaterThan(1)
    expect(lines.join(' ')).toBe(line)
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(34)
  })

  it('leaves a short line alone', () => {
    expect(wrapShare('Reached a savings goal.')).toEqual(['Reached a savings goal.'])
  })

  it('fits every share line in at most two lines', () => {
    for (const a of ACHIEVEMENTS) expect(wrapShare(a.share).length, a.id).toBeLessThanOrEqual(2)
  })
})
