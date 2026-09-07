import { describe, expect, it } from 'vitest'
import { shareCardSvg } from '../shareCard'

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
})
