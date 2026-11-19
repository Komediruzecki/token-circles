/**
 * Every floating surface draws its own edge (UI-28).
 *
 * A menu, dropdown, popover, tooltip or toast opens over a page painted much like itself: a white
 * dropdown over a white card in Dawn, a navy one over a navy card in Orbit. Its edge is the only
 * thing that says where it ends. Measured on 19 Nov 2026, most of them drew that edge in
 * `--border`, the hairline between cards: 1.27:1 against the card under them in Dawn and 1.32:1
 * in Orbit. Chart tooltips drew none, and in Orbit their 80% black sat 1.22:1 on the card.
 *
 * So every floating surface paints itself from one pair of theme tokens, `--surface-floating`
 * and `--border-floating`, which each theme sets where it sets its grounds, at values its own
 * grounds can see: an edge of at least 2:1 against them in a light theme and 3:1 in a dark one.
 * The pair is the card menu's (OverflowMenu), measured at 2.35:1 and 3.07:1 on the card.
 *
 * This file checks both halves: each theme's pair meets the numbers, and each floating surface
 * uses the pair. Dialogs are checked in dialogEdges.test.ts.
 */
/* eslint-disable security/detect-non-literal-fs-filename -- every path is walked from src/, not
   supplied by anything outside this file. */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { THEME_SCOPES, THEMES } from '../core/theme'

const SRC = resolve(__dirname, '..')

/** Every floating surface, by the stylesheet and selector that paint it. */
const FLOATING: ReadonlyArray<readonly [file: string, selector: string, what: string]> = [
  [
    'components/OverflowMenu.module.css',
    '.menu',
    'the card menu on Loans and the other card lists',
  ],
  ['components/FilterBar.module.css', '.dropdownContent', 'the filter dropdowns'],
  ['features/BillCalendar.module.css', '.popover', "the bill calendar's day popover"],
  ['components/InfoTip.module.css', '.panel', 'the explanation behind an (i)'],
  ['components/Spotlight.module.css', '.tooltip', "a guided tour's step"],
  ['components/Profile.module.css', '.profileDropdownMenu.visible', 'the profile switcher'],
  ['components/Toast.module.css', '.toast', 'toasts, in every kind'],
  ['components/SectionRail.module.css', '.rail', 'the section rail down the right edge'],
  ['components/SectionRail.module.css', '.tip', "the section rail's labels"],
  // Neither of these two is rendered today (PeriodNavigator is imported nowhere, and nothing takes
  // BudgetsPage's .dropdown); they keep the pair so that bringing one back brings its edge too.
  ['components/Dashboard/PeriodNavigator.module.css', '.dropdown', 'an unused period dropdown'],
  ['features/BudgetsPage.module.css', '.dropdown', 'an unused dropdown'],
]

/**
 * Positioned, stacked and painted, yet not a surface floating over content. Backdrops are not
 * listed: a rule pinned to all four edges of the screen is a backdrop or a screen, not a surface.
 */
const NOT_FLOATING: Record<string, string> = {
  'components/Layout.module.css .sidebar': 'the app frame the content sits beside',
  'components/Layout.module.css .mobile-toggle': 'a button',
  'components/Layout.module.css .fab': 'a button filled with --primary',
  'features/RetirementPage.module.css .zoom-reset': 'a button over the chart',
  'features/AnalyticsPage.module.css .dialog':
    "the heatmap's day detail, a dialog: dialogEdges.test.ts checks its edge",
  'styles/index.css body::before': 'the strip under the phone status bar, painted in --bg',
}

/** The grounds a floating surface opens over at rest. The hover grounds are under the pointer. */
const GROUNDS = [
  '--bg',
  '--bg-secondary',
  '--surface',
  '--card-bg',
  '--stat-bg',
  '--table-header-bg',
]

/** The edge each colour scheme needs against every ground: UI-28's numbers. */
const MIN_EDGE = { light: 2, dark: 3 } as const

function cssFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) cssFiles(full, found)
    else if (entry.endsWith('.css')) found.push(full)
  }
  return found
}

interface Rule {
  file: string
  selector: string
  decls: Map<string, string>
}

/**
 * Every selector in a stylesheet with its declarations merged across the file, later ones
 * winning: a mobile override that changes only the background keeps the border of its base
 * rule. Comments are stripped first, so one that quotes a rule is not read as the rule.
 */
function rules(file: string): Rule[] {
  const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ')
  const bySelector = new Map<string, Rule>()
  for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    for (const raw of selectors.split(',')) {
      const selector = raw.trim().replace(/\s+/g, ' ')
      if (!selector || selector.startsWith('@')) continue
      const rule = bySelector.get(selector) ?? {
        file: relative(SRC, file),
        selector,
        decls: new Map(),
      }
      for (const [, name, value] of body.matchAll(/(?:^|;)\s*(-{0,2}[\w-]+)\s*:\s*([^;]+)/g)) {
        rule.decls.set(name.trim(), value.trim())
      }
      bySelector.set(selector, rule)
    }
  }
  return [...bySelector.values()]
}

/** Strips every bracketed group, so `transparent` inside a colour function is not read as one. */
function outside(value: string): string {
  let rest = value
  while (/\([^()]*\)/.test(rest)) rest = rest.replace(/\([^()]*\)/g, '')
  return rest
}

/** A border someone can see: not `none`, not zero wide, not the bare `transparent` keyword. */
function isVisible(border: string | undefined): boolean {
  if (border === undefined || /^(?:none|0)(?:\s|$)/.test(border)) return false
  return !/\btransparent\b/.test(outside(border))
}

function background(rule: Rule): string | undefined {
  return rule.decls.get('background') ?? rule.decls.get('background-color')
}

/** Covers the screen from edge to edge: a backdrop, a boot screen, never a surface over content. */
function coversScreen(d: Map<string, string>): boolean {
  if (/^0(?:px)?$/.test(d.get('inset') ?? '')) return true
  const zero = (side: string) => /^0(?:px|%)?$/.test(d.get(side) ?? '')
  const full = (size: string) => /^100(?:%|vw|vh|dvh)$/.test(d.get(size) ?? '')
  return (
    zero('top') &&
    zero('left') &&
    (zero('right') || full('width')) &&
    (zero('bottom') || full('height'))
  )
}

const all = cssFiles(SRC).sort().flatMap(rules)
const find = (file: string, selector: string) =>
  all.find((r) => r.file === file && r.selector === selector)

describe('every floating surface draws its own edge', () => {
  it('finds no floating surface that is not on the list', () => {
    const listed = new Set(FLOATING.map(([file, selector]) => `${file} ${selector}`))
    const unlisted = all
      .filter((r) => /^(?:absolute|fixed)$/.test(r.decls.get('position') ?? ''))
      .filter((r) => r.decls.has('z-index'))
      .filter((r) => {
        const bg = background(r)
        return bg !== undefined && !/^(?:none|transparent)$/.test(bg)
      })
      .filter((r) => !coversScreen(r.decls))
      .map((r) => `${r.file} ${r.selector}`)
      .filter((key) => !listed.has(key) && !(key in NOT_FLOATING))
    // A new menu, popover or tooltip lands here. Paint it from the pair, as the ones on the
    // list are, and add it to FLOATING; if it is not a surface over content, say why in
    // NOT_FLOATING.
    expect(unlisted).toEqual([])
  })

  it.each(FLOATING)(
    '%s %s, %s, paints the floating surface and draws the floating edge',
    (file, selector) => {
      const rule = find(file, selector)
      expect(rule, `${file} has no ${selector}`).toBeDefined()
      expect(background(rule!)).toMatch(/var\(--surface-floating\)/)
      const border = rule!.decls.get('border')
      expect(isVisible(border)).toBe(true)
      expect(border).toMatch(/var\(--border-floating\)/)
    }
  )

  it("paints the heatmap's tooltip, styled inline, from the pair", () => {
    const source = readFileSync(join(SRC, 'components/D3HeatmapChart.tsx'), 'utf8')
    const style = /tooltipEl\.style\.cssText\s*=\s*'([^']+)'/.exec(source)?.[1]
    expect(style).toBeDefined()
    expect(style).toMatch(/background:var\(--surface-floating\)/)
    expect(style).toMatch(/border:1px solid var\(--border-floating\)/)
  })
})

/** WCAG contrast between two opaque colours written as #rrggbb. */
function contrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    const [r, g, bl] = [1, 3, 5]
      .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl
  }
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

describe("each theme's floating pair meets UI-28's numbers on its own grounds", () => {
  const themeRules = cssFiles(join(SRC, 'styles/themes')).flatMap(rules)
  const block = (selector: string) => themeRules.find((r) => r.selector === selector)?.decls

  // A block that sets --card-bg re-grounds the page: a theme, or a variant such as
  // .instrument-deck. Each must set its own pair, or it inherits one painted for other grounds.
  // `:root` repeats the light theme's block as the no-JS fallback; it is checked as that block.
  const grounded = themeRules.filter((r) => r.decls.has('--card-bg') && r.selector !== ':root')
  const cases = grounded.map((r) => {
    const id = /\[data-theme='([\w-]+)'\]/.exec(r.selector)?.[1]
    return [r.selector, id] as const
  })

  it('names every variant that re-grounds a theme in THEME_SCOPES, which portals carry along', () => {
    // An InfoTip's panel renders at the end of the page and wears these classes to keep the
    // tokens of the part of the page its icon sits in; a variant missing here loses them.
    const variants = grounded
      .map((r) => r.selector)
      .filter((selector) => !/^\[data-theme='[\w-]+'\]$/.test(selector))
      .flatMap((selector) => [...selector.matchAll(/\.([\w-]+)/g)].map(([, name]) => name))
    expect(variants.length).toBeGreaterThan(0)
    for (const name of variants) expect(THEME_SCOPES as readonly string[]).toContain(name)
  })

  it('finds a block for every theme the app offers', () => {
    for (const theme of THEMES) expect(block(`[data-theme='${theme.id}']`), theme.id).toBeDefined()
    expect(cases.length).toBeGreaterThan(THEMES.length)
  })

  it.each(cases)('%s sets an opaque pair with an edge it can see', (selector, id) => {
    const theme = THEMES.find((t) => t.id === id)
    expect(theme, `${selector} names no theme in THEMES`).toBeDefined()
    // A variant only overrides some grounds; the rest are its theme's.
    const decls = new Map([...(block(`[data-theme='${id}']`) ?? []), ...(block(selector) ?? [])])
    const surface = block(selector)?.get('--surface-floating')
    const edge = block(selector)?.get('--border-floating')
    expect(surface).toMatch(/^#[0-9a-f]{6}$/i)
    expect(edge).toMatch(/^#[0-9a-f]{6}$/i)
    const min = MIN_EDGE[theme!.scheme]
    const weak = GROUNDS.map((ground) => [ground, decls.get(ground)] as const)
      .filter(([, value]) => value !== undefined && /^#[0-9a-f]{6}$/i.test(value))
      .map(([ground, value]) => [ground, Math.round(contrast(edge!, value!) * 100) / 100] as const)
      .filter(([, ratio]) => ratio < min)
    expect(weak).toEqual([])
  })
})
