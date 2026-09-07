import { render } from 'solid-js/web'
import { afterEach, describe, expect, it } from 'vitest'
import { ACHIEVEMENTS } from '../../core/achievements/definitions'
import { BADGE_GLYPHS, GLYPH_OFFSET } from '../badgeGlyphs'
import BadgeMedallion, { medallionSvg } from '../BadgeMedallion'
import type { JSX } from 'solid-js'

let host: HTMLDivElement
let dispose: (() => void) | undefined
afterEach(() => {
  dispose?.()
  host?.remove()
})
const mount = (el: () => JSX.Element): HTMLDivElement => {
  host = document.createElement('div')
  document.body.appendChild(host)
  dispose = render(el, host)
  return host
}

describe('BadgeMedallion', () => {
  it('has a glyph for every badge', () => {
    for (const a of ACHIEVEMENTS) expect(BADGE_GLYPHS[a.id], a.id).toMatch(/<(path|circle|rect)/)
  })
  it('only carries centring offsets for badges that exist', () => {
    // A typo'd key here is silent: the lookup misses and the glyph quietly renders off centre.
    const ids = new Set(ACHIEVEMENTS.map((a) => a.id))
    for (const id of Object.keys(GLYPH_OFFSET)) expect(ids.has(id as never), id).toBe(true)
  })
  it('places the glyph by its measured ink, not by its box', () => {
    // half-a-year is an arc across the top of its box with dots under it, so its ink sits high
    // and the medallion has to push it down. The number comes from scripts/measure-badge-glyphs.
    const [dx, dy] = GLYPH_OFFSET['half-a-year']!
    expect(dy).toBeGreaterThan(1)
    expect(medallionSvg('half-a-year', 'mastery', 220)).toContain(
      `translate(${dx - 24} ${dy - 24})`
    )
    // A glyph with no entry is drawn on the box centre, unshifted.
    expect(GLYPH_OFFSET['two-years']).toBeUndefined()
    expect(medallionSvg('two-years', 'mastery', 220)).toContain('translate(-24 -24)')
  })
  it('draws one, two or three rings by band and marks unlit', () => {
    const c = mount(() => (
      <BadgeMedallion id="a-year" band="mastery" size={96} lit={false} face="plain" />
    ))
    const el = c.querySelector('[data-band="mastery"]') as HTMLElement
    expect(el.querySelectorAll('[data-ring]')).toHaveLength(3)
    expect(el.dataset.lit).toBe('false')
    expect(el.style.getPropertyValue('--size')).toBe('96px')
    dispose?.()
    host.remove()
    const c2 = mount(() => <BadgeMedallion id="first-entry" band="beginnings" face="plain" />)
    expect(c2.querySelectorAll('[data-ring]')).toHaveLength(1)
    expect((c2.firstElementChild as HTMLElement).dataset.lit).toBe('true')
  })
  it('uses the generated face per band by default and the drawn one on request', () => {
    const c = mount(() => <BadgeMedallion id="a-year" band="mastery" size={120} />)
    expect((c.firstElementChild as HTMLElement).dataset.face).toBe('art')
    expect(c.querySelector('img')?.getAttribute('src')).toBe('/badges/face-mastery.webp')
    expect(c.querySelectorAll('[data-ring]')).toHaveLength(0)
    dispose?.()
    host.remove()
    const c2 = mount(() => <BadgeMedallion id="a-year" band="mastery" face="plain" />)
    expect(c2.querySelector('img')).toBeNull()
    expect(c2.querySelectorAll('[data-ring]')).toHaveLength(3)
  })

  it('renders a static SVG string for the share card with no raster', () => {
    const svg = medallionSvg('a-year', 'mastery', 400)
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg).not.toMatch(/<image/)
    expect(svg).toContain('data-ring')
  })
})
