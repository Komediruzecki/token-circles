/**
 * Every dialog draws its own edge.
 *
 * Each modal here declares its own surface (`.modal`, `.dialog`, `.sheet`) in its own CSS module;
 * there is no shared dialog style. More than half of them were written without a border and left
 * their edge to a black box-shadow. Under a 50% black backdrop on a dark page that shadow is black
 * on near-black, and the edge is gone.
 *
 * The one that was reported (19 Nov 2026) is Create Profile. It is painted in the sidebar's navy
 * (`--sidebar-bg`, #070b16 in Orbit Dark) over the page (`--bg`, #0a0e1c) that the backdrop dims to
 * about #05070e: 2, 4 and 8 levels apart in red, green and blue. Its fields floated in the dark with
 * nothing around them.
 *
 * So a dialog surface that paints a background must also declare a border. A modal copied from an
 * old one learns that here rather than from someone remembering it.
 */
/* eslint-disable security/detect-non-literal-fs-filename -- every path is walked from src/, not
   supplied by anything outside this file. */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = resolve(__dirname, '..')

/** The class names this app gives a dialog's box: the surface itself, never its backdrop. */
const SURFACE_CLASSES = new Set(['modal', 'dialog', 'sheet'])

function cssModules(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) cssModules(full, found)
    else if (entry.endsWith('.module.css')) found.push(full)
  }
  return found
}

interface Surface {
  file: string
  selector: string
  background: boolean
  border: string | null
}

/**
 * Every selector in a stylesheet that ends on a surface class (`.modal`, `.goals-page .modal`),
 * with its rules merged across the file: a mobile override that changes only the background still
 * has the border its base rule declared. Comments are stripped first, so one that quotes a rule
 * is not read as the rule.
 */
function surfaces(file: string): Surface[] {
  const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ')
  const bySelector = new Map<string, Surface>()
  for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    for (const raw of selectors.split(',')) {
      const selector = raw.trim().replace(/\s+/g, ' ')
      const name = /^\.([\w-]+)$/.exec(selector.split(/[\s>+~]+/).pop() ?? '')?.[1]
      if (!name || !SURFACE_CLASSES.has(name)) continue
      const entry = bySelector.get(selector) ?? {
        file: relative(SRC, file),
        selector,
        background: false,
        border: null,
      }
      if (/(?:^|[;\s])background(?:-color)?\s*:/.test(body)) entry.background = true
      entry.border ??= /(?:^|[;\s])border\s*:\s*([^;]+)/.exec(body)?.[1]?.trim() ?? null
      bySelector.set(selector, entry)
    }
  }
  return [...bySelector.values()]
}

/** A border someone can see: not `none`, not zero wide, not the bare `transparent` keyword. */
function isVisible(border: string | null): boolean {
  if (border === null || /^(?:none|0)(?:\s|$)/.test(border)) return false
  // A colour function can mix transparent in and still paint: `color-mix(…, transparent)`.
  let outside = border
  while (/\([^()]*\)/.test(outside)) outside = outside.replace(/\([^()]*\)/g, '')
  return !/\btransparent\b/.test(outside)
}

describe('every dialog draws its own edge', () => {
  const all = cssModules(SRC).sort().flatMap(surfaces)
  const painted = all.filter((s) => s.background)

  it('finds the dialogs to check', () => {
    expect(painted.length).toBeGreaterThan(20)
  })

  it('gives every dialog surface that paints a background a visible border', () => {
    const edgeless = painted
      .filter((s) => !isVisible(s.border))
      .map((s) => `${s.file}: ${s.selector}`)
    // A black shadow is no edge on a dark backdrop. A card-coloured dialog takes
    // `border: 1px solid var(--border)`; one in another palette takes a border from that palette
    // (ProfileModal.module.css draws its edge from the sidebar's text colour).
    expect(edgeless).toEqual([])
  })

  it('covers the Create Profile dialog it was written for', () => {
    const profile = all.find(
      (s) => s.file === 'components/ProfileModal.module.css' && s.selector === '.modal'
    )
    expect(profile?.background).toBe(true)
    expect(isVisible(profile?.border ?? null)).toBe(true)
  })

  // Its box was styled inline in Analytics.tsx, where nothing here could read it. It now takes its
  // surface and edge from the page's stylesheet, so losing the edge fails the test above.
  it("covers Analytics' heatmap day detail, which once kept its box inline", () => {
    const day = all.find(
      (s) => s.file === 'features/AnalyticsPage.module.css' && s.selector === '.dialog'
    )
    expect(day?.background).toBe(true)
    expect(isVisible(day?.border ?? null)).toBe(true)
    expect(readFileSync(join(SRC, 'features/Analytics.tsx'), 'utf8')).toContain(
      'class={styles.dialog}'
    )
  })
})
