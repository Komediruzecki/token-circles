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
import { THEMES } from '../core/theme'

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

/**
 * Every dialog's edge is measured, in every theme.
 *
 * A dialog opens over a backdrop that dims the page, so its edge has to stand out from the dimmed
 * page beside it, not from the page at rest. `var(--border)` is the hairline between cards: on 19
 * Nov it measured 1.59:1 beside Add transaction in Orbit and 1.25:1 beside the day detail in the
 * deck, and Create Profile's navy box stood 1.01:1 on its dimmed page. So every dialog takes its edge
 * from `--border-dialog`, which each theme (and the deck, which re-grounds Orbit) sets where it sets
 * its grounds, with 3:1 against the dimmed page in a dark ground and 2:1 in a light one, and still
 * visible on the dialog's own surface. The two dialogs painted in the sidebar's navy in both themes
 * take `--border-dialog-sidebar` instead: on navy, Dawn's light hairline would draw a white frame.
 */
const SIDEBAR_PALETTE: Record<string, string> = {
  'components/LoginModal.module.css .modal': 'sign-in, painted in the sidebar navy',
  'components/ProfileModal.module.css .modal': 'Create Profile, painted in the sidebar navy',
}

/** Against the page under the backdrop: UI-28's numbers, as the floating edge has them. */
const MIN_BESIDE = { light: 2, dark: 3 } as const
/**
 * On the dialog's own surface. Dawn's edge has to be nearly as light as its white surface to clear
 * 2:1 on the dimmed page, so it is a hairline there, as `--border` is on a card (1.27:1).
 */
const MIN_ON_SURFACE = { light: 1.2, dark: 2 } as const

/** The grounds a dialog can open over, as the floating edge counts them. */
const GROUNDS = [
  '--bg',
  '--bg-secondary',
  '--surface',
  '--card-bg',
  '--stat-bg',
  '--table-header-bg',
]

type Rgba = [number, number, number, number]

/** A backdrop's colour and opacity, in the forms the dialog stylesheets write them. */
function backdropColour(value: string, overlay: string | undefined): Rgba | null {
  const fallback = /^var\(--modal-overlay,\s*(.+)\)$/.exec(value)
  if (fallback) return backdropColour(overlay ?? fallback[1], undefined)
  const rgba = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)\s*[,/]\s*([\d.]+)(%?)\s*\)$/.exec(value)
  if (rgba) {
    const alpha = Number(rgba[4]) / (rgba[5] ? 100 : 1)
    return [Number(rgba[1]), Number(rgba[2]), Number(rgba[3]), alpha]
  }
  const mix = /^color-mix\(in oklab,\s*#([0-9a-f]{6})\s+([\d.]+)%,\s*transparent\)$/i.exec(value)
  if (mix) {
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(mix[1].slice(i, i + 2), 16))
    return [r, g, b, Number(mix[2]) / 100]
  }
  return null
}

/** Every backdrop rule beside a dialog surface, as written; or only those in the given files. */
function backdrops(only?: string[]): string[] {
  const found = new Set<string>()
  for (const file of cssModules(SRC)) {
    if (only && !only.includes(relative(SRC, file))) continue
    const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ')
    if (!surfaces(file).some((s) => s.background)) continue
    for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const last =
        selectors
          .trim()
          .split(/[\s>+~]+/)
          .pop() ?? ''
      const background = /(?:^|[;\s])background(?:-color)?\s*:\s*([^;]+)/.exec(body)?.[1]?.trim()
      if (/overlay|backdrop/i.test(last) && background) found.add(background)
    }
  }
  return [...found]
}

function hex(value: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16)) as [number, number, number]
}

/** A ground seen through a backdrop, composited as the browser does, in sRGB. */
function dimmed(ground: string, [r, g, b, a]: Rgba): string {
  const mixed = hex(ground).map((c, i) => Math.round(c * (1 - a) + [r, g, b][i] * a))
  return `#${mixed.map((c) => c.toString(16).padStart(2, '0')).join('')}`
}

/** WCAG contrast between two opaque colours written as #rrggbb. */
function contrast(a: string, b: string): number {
  const luminance = (value: string) => {
    const [r, g, bl] = hex(value)
      .map((v) => v / 255)
      .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl
  }
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** Each theme stylesheet's declarations, by selector. */
function themeBlocks(): Map<string, Map<string, string>> {
  const blocks = new Map<string, Map<string, string>>()
  for (const entry of readdirSync(join(SRC, 'styles/themes'))) {
    if (!entry.endsWith('.css')) continue
    const css = readFileSync(join(SRC, 'styles/themes', entry), 'utf8').replace(
      /\/\*[\s\S]*?\*\//g,
      ' '
    )
    for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const decls = new Map(
        [...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(([, k, v]) => [k, v.trim()])
      )
      for (const raw of selectors.split(',')) {
        const selector = raw.trim().replace(/\s+/g, ' ')
        blocks.set(selector, new Map([...(blocks.get(selector) ?? []), ...decls]))
      }
    }
  }
  return blocks
}

describe("every dialog's edge is measured, in every theme", () => {
  const all = cssModules(SRC).sort().flatMap(surfaces)
  const painted = all.filter((s) => s.background)
  const blocks = themeBlocks()
  // A block that sets --card-bg grounds a theme or re-grounds part of one (.instrument-deck).
  // `:root` repeats the light theme's block as the no-JS fallback and is checked as that block.
  const grounded = [...blocks].filter(([selector, d]) => d.has('--card-bg') && selector !== ':root')
  const themeOf = (selector: string) =>
    THEMES.find((t) => t.id === /\[data-theme='([\w-]+)'\]/.exec(selector)?.[1])
  const merged = (selector: string) =>
    new Map([
      ...(blocks.get(`[data-theme='${themeOf(selector)?.id}']`) ?? []),
      ...(blocks.get(selector) ?? []),
    ])

  it('takes every dialog edge from --border-dialog', () => {
    const off = painted
      .filter((s) => !(`${s.file} ${s.selector}` in SIDEBAR_PALETTE))
      .filter((s) => !/var\(--border-dialog\)/.test(s.border ?? ''))
      .map((s) => `${s.file}: ${s.selector} (${s.border})`)
    expect(off).toEqual([])
  })

  it.each(Object.keys(SIDEBAR_PALETTE))('%s takes its edge from --border-dialog-sidebar', (key) => {
    const surface = painted.find((s) => `${s.file} ${s.selector}` === key)
    expect(surface?.border).toMatch(/var\(--border-dialog-sidebar\)/)
  })

  it('reads every backdrop a dialog opens over', () => {
    const unread = backdrops().filter((b) => backdropColour(b, 'rgba(0, 0, 0, 0.5)') === null)
    expect(backdrops().length).toBeGreaterThan(5)
    expect(unread).toEqual([])
  })

  it('finds a grounded block for every theme, and the deck', () => {
    for (const theme of THEMES)
      expect(blocks.has(`[data-theme='${theme.id}']`), theme.id).toBe(true)
    expect(grounded.length).toBeGreaterThan(THEMES.length)
  })

  it.each(grounded.map(([selector]) => [selector]))(
    '%s sets --border-dialog, 3:1 (dark) or 2:1 (light) beside every dialog',
    (selector) => {
      const theme = themeOf(selector)
      expect(theme, `${selector} names no theme in THEMES`).toBeDefined()
      const edge = blocks.get(selector)?.get('--border-dialog')
      expect(edge, `${selector} sets no --border-dialog of its own`).toMatch(/^#[0-9a-f]{6}$/i)
      const decls = merged(selector)
      const scheme = theme!.scheme
      const weak = GROUNDS.flatMap((ground) =>
        backdrops().map((b) => {
          const page = dimmed(decls.get(ground)!, backdropColour(b, decls.get('--modal-overlay'))!)
          return [`${ground} under ${b}`, Math.round(contrast(edge!, page) * 100) / 100] as const
        })
      ).filter(([, ratio]) => ratio < MIN_BESIDE[scheme])
      expect(weak).toEqual([])
      for (const surface of ['--card-bg', '--surface'])
        expect(contrast(edge!, decls.get(surface)!), `on ${surface}`).toBeGreaterThanOrEqual(
          MIN_ON_SURFACE[scheme]
        )
    }
  )

  it.each(THEMES.map((t) => [t.id, t.scheme] as const))(
    "%s sets --border-dialog-sidebar, measured on the sidebar's navy",
    (id, scheme) => {
      const decls = blocks.get(`[data-theme='${id}']`)!
      const edge = decls.get('--border-dialog-sidebar')
      expect(edge).toMatch(/^#[0-9a-f]{6}$/i)
      // Only these two dialogs paint navy, so only their own backdrops are beside it.
      const own = Object.keys(SIDEBAR_PALETTE).map((key) => key.split(' ')[0])
      expect(backdrops(own).length).toBeGreaterThan(0)
      const weak = GROUNDS.flatMap((ground) =>
        backdrops(own).map((b) => {
          const page = dimmed(decls.get(ground)!, backdropColour(b, decls.get('--modal-overlay'))!)
          return [`${ground} under ${b}`, Math.round(contrast(edge!, page) * 100) / 100] as const
        })
      ).filter(([, ratio]) => ratio < MIN_BESIDE[scheme])
      expect(weak).toEqual([])
      expect(contrast(edge!, decls.get('--sidebar-bg')!)).toBeGreaterThanOrEqual(
        MIN_ON_SURFACE[scheme]
      )
    }
  )
})
