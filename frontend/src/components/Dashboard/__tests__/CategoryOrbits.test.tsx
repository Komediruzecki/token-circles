import { render } from 'solid-js/web'
import { afterEach, describe, expect, it } from 'vitest'
import CategoryOrbits from '../CategoryOrbits'

type Cat = { category_name: string; category_color?: string | null; amount: number }

const NAMES = 'Alpha Bravo Charlie Delta Echo Foxtrot Golf Hotel India Juliet'.split(' ')
const mkCats = (amounts: number[]): Cat[] =>
  amounts.map((a, i) => ({
    category_name: NAMES[i] ?? `X${i}`,
    category_color: '#123456',
    amount: a,
  }))

const hosts: HTMLElement[] = []

function mount(cats: Cat[], maxRings?: number) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  hosts.push(host)
  const dispose = render(() => <CategoryOrbits categories={cats} maxRings={maxRings} />, host)
  return { host, dispose }
}

afterEach(() => {
  hosts.splice(0).forEach((h) => {
    h.remove()
  })
})

// Collect, per orbit <svg>: the ids of the <filter>/<radialGradient> it defines, and
// every url(#…) reference its children make (arc filters + core fill).
function svgDefsAndRefs(svg: SVGSVGElement) {
  const defIds = new Set(Array.from(svg.querySelectorAll('filter,radialGradient')).map((n) => n.id))
  const refs: string[] = []
  svg.querySelectorAll('[filter],[fill]').forEach((el) => {
    for (const attr of ['filter', 'fill']) {
      const v = el.getAttribute(attr) || ''
      const m = v.match(/^url\(#(.+)\)$/)
      if (m) refs.push(m[1])
    }
  })
  return { defIds, refs }
}

describe('CategoryOrbits — SVG defs are per-instance and self-contained', () => {
  // Regression: the keep-alive page host keeps every visited page (and its orbit)
  // mounted at once. Hardcoded `#co-glow`/`#co-core` ids made every orbit define the
  // same ids, so an arc's `url(#co-glow)` resolved to the first match in the document —
  // often a def inside a `display:none` page — producing a degenerate filter region
  // that clipped the arc to a stub in real browsers (the spending-by-category orbit
  // "lost" its colored circles after navigating between period views).
  it('gives two concurrently-mounted orbits distinct filter/gradient ids', () => {
    const a = mount(mkCats([100, 50, 25, 10]))
    const b = mount(mkCats([100, 50, 25, 10]))
    const svgA = a.host.querySelector('svg') as SVGSVGElement
    const svgB = b.host.querySelector('svg') as SVGSVGElement
    const idsA = svgDefsAndRefs(svgA).defIds
    const idsB = svgDefsAndRefs(svgB).defIds

    expect(idsA.size).toBeGreaterThan(0)
    expect(idsB.size).toBeGreaterThan(0)
    // No id is shared between the two instances — so a reference can never resolve
    // into the other (possibly hidden) orbit's <defs>.
    for (const id of idsA) expect(idsB.has(id)).toBe(false)
  })

  it('references only ids defined within its own svg (no cross-instance url refs)', () => {
    // Two instances live in the same document, exactly as the keep-alive host mounts them.
    mount(mkCats([4283, 2536, 2219, 1773, 545, 514, 502, 300, 200, 150]), 7)
    mount(mkCats([100, 50]))
    for (const svg of Array.from(document.querySelectorAll('svg'))) {
      const { defIds, refs } = svgDefsAndRefs(svg as SVGSVGElement)
      expect(refs.length).toBeGreaterThan(0) // arcs + core actually use url() refs
      for (const ref of refs) expect(defIds.has(ref)).toBe(true)
    }
  })
})

describe('CategoryOrbits — arc sweeps stay in sync with the legend', () => {
  it('keeps every arc sweep proportional to its legend percentage across data changes', () => {
    // The arc sweep (dash length / circumference) must always equal the legend row's %.
    const sequences = [
      [100, 50, 25],
      [4283, 2536, 2219, 1773, 545, 514, 502, 300, 200, 150],
      [1000, 900, 800, 700, 600, 500, 400, 300],
    ]
    for (const seq of sequences) {
      const { host } = mount(mkCats(seq), 7)
      const svg = host.querySelector('svg[aria-label^="Spending by category"]') as SVGSVGElement
      const arcShares = Array.from(svg.querySelectorAll('circle[transform]')).map((c) => {
        const [len, circ] = (c.getAttribute('stroke-dasharray') || '').split(/\s+/).map(Number)
        return circ ? (len / circ) * 100 : NaN
      })
      const legendShares = Array.from(host.querySelectorAll('li')).map((li) => {
        const m = li.textContent?.match(/(\d[\d.]*)%/)
        return m ? Number(m[1]) : NaN
      })
      expect(arcShares.length).toBe(legendShares.length)
      arcShares.forEach((s, i) => {
        expect(Math.abs(s - legendShares[i])).toBeLessThan(1.5)
      })
    }
  })
})
