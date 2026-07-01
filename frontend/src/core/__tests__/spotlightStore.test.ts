/**
 * Guardrails for the guided-tour system.
 *
 * These tests statically enforce the targeting contract so a tour step can never again
 * silently point at a missing element:
 *   1. Every step targets a `[data-tour="..."]` anchor — never a CSS class, tag,
 *      placeholder, or `data-test-id` (those drift and were the original breakage).
 *   2. Every `requiredPage` (and tour `page`) is a real route in `router.tsx`.
 *   3. Every `data-tour` key a step references actually exists in the component source,
 *      so renamed/removed anchors fail CI instead of the user's onboarding.
 */
import { describe, expect, it } from 'vitest'
import routerSrc from '../../router.tsx?raw'
import { SPOTLIGHT_TOURS } from '../spotlightStore'

// Raw source of every component that can host a tour anchor.
const componentSources = import.meta.glob(
  ['../../features/**/*.tsx', '../../components/**/*.tsx'],
  {
    query: '?raw',
    import: 'default',
    eager: true,
  }
) as Record<string, string>

// All `data-tour="key"` anchors actually present in the component tree.
const domKeys = new Set<string>()
for (const src of Object.values(componentSources)) {
  for (const m of src.matchAll(/data-tour="([a-z0-9-]+)"/g)) domKeys.add(m[1])
}

// Valid route names, parsed straight from the router's `pages` map.
const routeNames = new Set<string>()
for (const m of routerSrc.matchAll(/^\s+([A-Za-z0-9]+):\s*lazy\(/gm)) routeNames.add(m[1])

const allSteps = SPOTLIGHT_TOURS.flatMap((t) => t.steps.map((s) => ({ tour: t.id, ...s })))
const keyOf = (sel: string) => sel.match(/^\[data-tour="([a-z0-9-]+)"\]$/)?.[1]

describe('spotlight tours', () => {
  it('the test fixtures parsed correctly', () => {
    expect(routeNames.size).toBeGreaterThan(10)
    expect(domKeys.size).toBeGreaterThan(10)
    expect(allSteps.length).toBeGreaterThan(10)
  })

  it('every tour has a unique id, a real page, and at least one step', () => {
    const ids = new Set<string>()
    for (const tour of SPOTLIGHT_TOURS) {
      expect(tour.steps.length, `tour "${tour.id}" has steps`).toBeGreaterThan(0)
      expect(routeNames.has(tour.page), `tour "${tour.id}" page "${tour.page}" is a route`).toBe(
        true
      )
      expect(ids.has(tour.id), `tour id "${tour.id}" is unique`).toBe(false)
      ids.add(tour.id)
    }
  })

  it('every step targets a data-tour anchor (no magic CSS / label / test-id selectors)', () => {
    const bad = allSteps
      .filter((s) => !/^\[data-tour="[a-z0-9-]+"\]$/.test(s.targetSelector))
      .map((s) => `${s.tour} / "${s.title}" -> ${s.targetSelector}`)
    expect(bad, `non-data-tour selectors:\n${bad.join('\n')}`).toEqual([])
  })

  it('every step navigates to a real route', () => {
    const bad = allSteps
      .filter((s) => !routeNames.has(s.requiredPage ?? ''))
      .map((s) => `${s.tour} / "${s.title}" -> requiredPage=${s.requiredPage}`)
    expect(bad, `steps with an unknown requiredPage:\n${bad.join('\n')}`).toEqual([])
  })

  it('every step anchor exists in the component source', () => {
    const missing = allSteps
      .filter((s) => {
        const key = keyOf(s.targetSelector)
        return !key || !domKeys.has(key)
      })
      .map((s) => `${s.tour} / "${s.title}" -> ${s.targetSelector}`)
    expect(
      missing,
      `anchors referenced by a step but missing in the DOM:\n${missing.join('\n')}`
    ).toEqual([])
  })

  it('every step has a meaningful title and description', () => {
    for (const s of allSteps) {
      expect(s.title.trim().length, `${s.tour} / step title`).toBeGreaterThan(0)
      expect(s.description.trim().length, `${s.tour} / "${s.title}" description`).toBeGreaterThan(
        10
      )
    }
  })

  it('no two steps in the same tour reuse the same anchor', () => {
    for (const tour of SPOTLIGHT_TOURS) {
      const keys = tour.steps.map((s) => keyOf(s.targetSelector))
      expect(new Set(keys).size, `tour "${tour.id}" has distinct anchors`).toBe(keys.length)
    }
  })
})
