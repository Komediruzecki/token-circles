import { render } from 'solid-js/web'
import { afterEach, describe, expect, it } from 'vitest'
import { ACHIEVEMENTS } from '../../core/achievements/definitions'
import { BADGE_GLYPHS } from '../badgeGlyphs'
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
  it('draws one, two or three rings by band and marks unlit', () => {
    const c = mount(() => <BadgeMedallion id="a-year" band="mastery" size={96} lit={false} />)
    const el = c.querySelector('[data-band="mastery"]') as HTMLElement
    expect(el.querySelectorAll('[data-ring]')).toHaveLength(3)
    expect(el.dataset.lit).toBe('false')
    expect(el.style.getPropertyValue('--size')).toBe('96px')
    dispose?.()
    host.remove()
    const c2 = mount(() => <BadgeMedallion id="first-entry" band="beginnings" />)
    expect(c2.querySelectorAll('[data-ring]')).toHaveLength(1)
    expect((c2.firstElementChild as HTMLElement).dataset.lit).toBe('true')
  })
  it('renders a static SVG string for the share card with no raster', () => {
    const svg = medallionSvg('a-year', 'mastery', 400)
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg).not.toMatch(/<image/)
    expect(svg).toContain('data-ring')
  })
})
