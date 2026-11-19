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
  ['components/PasskeyNudge.module.css', '.nudge', 'the passkey offer after a sign-in'],
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
  'components/BadgeTimeline.module.css .dot::after': "a badge's dot on the timeline",
  'components/OrbitalToggle.module.css .knob': "the toggle's knob",
  'components/PeriodOrbit.module.css .monthBtn': "a month's button on the period orbit",
  'components/PeriodOrbit.module.css .core': "the period orbit's centre disc",
  'components/TokenOrbitLink.module.css .token': 'the dot that orbits a link',
  'components/guidance/BenchmarkCards.module.css .mark': "the marker on a benchmark's scale",
  'components/onboarding/Onboarding.module.css .doneSatellite::after': "a finished step's dot",
  'features/NotFound.module.css .dot': "the dot on the not-found page's orbit",
  'features/loans/Loans.module.css .card-handle': "the pull on a loan card's bottom edge",
}

/**
 * Styles written in script that position and paint a box, by file: a JSX style object, a style
 * string or a cssText. A floating surface belongs in a stylesheet, where the checks below read it;
 * these are the ones that stay, and why.
 */
const INLINE: Record<string, string> = {
  'components/D3HeatmapChart.tsx':
    "the heatmap's tooltip, built by D3 outside Solid: the last test of the next block checks its pair",
  'components/BillingPlans.tsx': "the badge on a plan card's top edge, not a surface over content",
}

/** Every script in src/ but the tests. */
function scriptFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry !== '__tests__') scriptFiles(full, found)
    } else if (/\.tsx?$/.test(entry) && !/\.(?:test|d)\.tsx?$/.test(entry)) found.push(full)
  }
  return found
}

/** The text between the braces around `at`, nested braces and all. */
function enclosingBraces(source: string, at: number): string {
  let start = at
  for (let depth = 0; start > 0; start--) {
    const c = source.charAt(start - 1)
    if (c === '}') depth++
    else if (c === '{' && depth-- === 0) break
  }
  let end = at
  for (let depth = 0; end < source.length; end++) {
    const c = source.charAt(end)
    if (c === '{') depth++
    else if (c === '}' && depth-- === 0) break
  }
  return source.slice(start, end)
}

/**
 * Each style a script writes inline that positions its box: a CSS string (`style="..."` or a
 * cssText), or an object around a `position: 'fixed'` or `'absolute'` (a JSX style, a style
 * signal, a constant). An object's values are read up to the first comma, which is enough to tell
 * a background from none.
 */
function inlineStyles(file: string): Array<Map<string, string>> {
  const source = readFileSync(file, 'utf8')
  const strings = [...source.matchAll(/(?:cssText\s*=\s*'|style=")([^'"]*)['"]/g)].map(([, css]) =>
    [...css.matchAll(/([\w-]+)\s*:\s*([^;]+)/g)].map(([, k, v]) => [k, v.trim()] as const)
  )
  const objects = [...source.matchAll(/position:\s*['"](?:fixed|absolute)['"]/g)].map((match) =>
    [...enclosingBraces(source, match.index).matchAll(/['"]?([\w-]+)['"]?\s*:\s*([^,\n]+)/g)].map(
      ([, k, v]) => [k, v.trim().replace(/^['"`]|['"`]$/g, '')] as const
    )
  )
  return [...strings, ...objects]
    .map((entries) => new Map(entries))
    .filter((d) => /^(?:fixed|absolute)$/.test(d.get('position') ?? ''))
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

/**
 * Where the text on each floating surface is styled: the surface's stylesheet, and the rules in
 * it that paint inside the surface. A stylesheet that holds only its surface takes every rule but
 * the ones on the page (the trigger that opens a menu), so a rule added to it is checked; one
 * that also styles the page names the surface's rules. Dots, colour bars and dividers carry no
 * text and are left out.
 */
const TEXT_ON_FLOATING: ReadonlyArray<readonly [file: string, inside: RegExp]> = [
  ['components/OverflowMenu.module.css', /^\.(?!trigger\b)/],
  ['components/FilterBar.module.css', /^\.(?:dropdownContent|optionList|checkboxLabel)\b/],
  ['features/BillCalendar.module.css', /^\.(?:popover(?!Backdrop|BillColor)|amountOverdue)/],
  ['components/InfoTip.module.css', /^\.(?!trigger\b)/],
  ['components/Spotlight.module.css', /^\.(?!overlay\b|backdropSvg\b)/],
  ['components/Profile.module.css', /^\.profileDropdown(?:Menu|Item|Header)\b/],
  ['components/Toast.module.css', /^\.(?!toastContainer\b)/],
  ['components/SectionRail.module.css', /\.tip\b/],
  ['components/PasskeyNudge.module.css', /^\./],
]

/** Text needs 4.5:1 on whatever it is painted on (WCAG 1.4.3). */
const MIN_TEXT = 4.5

/**
 * Rules whose colour paints a mark, not text. A status mark keeps the status colour and the words
 * beside it take the text token, as a met circle check's do (successTextContrast.test.ts).
 */
const MARKS = new Set(['components/Toast.module.css .icon'])

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
      // Set apart from what is under it: stacked over it, shadowed, or edged.
      .filter(
        (r) =>
          r.decls.has('z-index') || r.decls.has('box-shadow') || isVisible(r.decls.get('border'))
      )
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

  it('finds no style written in script that positions and paints a box it does not know', () => {
    const found = scriptFiles(SRC)
      .filter((file) =>
        inlineStyles(file).some((d) => {
          const bg = d.get('background') ?? d.get('background-color')
          return bg !== undefined && !/^(?:none|transparent)$/.test(bg) && !coversScreen(d)
        })
      )
      .map((file) => relative(SRC, file))
      .sort()
    // A menu, card or tooltip styled inline lands here, out of reach of every check in this file.
    // Move it to a stylesheet and paint it from the pair; if it is not a surface over content,
    // say what it is in INLINE.
    expect(found).toEqual(Object.keys(INLINE).sort())
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

/** A colour as sRGB channels from 0 to 255 and an alpha from 0 to 1. */
type Rgba = readonly [r: number, g: number, b: number, a: number]

/**
 * The colour a CSS value paints, its custom properties read from `props`: a hex or rgb() colour,
 * `transparent`, a var() with its fallback, or a color-mix() of one colour with transparent.
 * Anything else, such as a gradient, is not one flat colour and gives undefined.
 */
function paint(value: string, props: ReadonlyMap<string, string>, depth = 0): Rgba | undefined {
  const v = value.trim()
  if (depth > 8) return undefined
  if (v === 'transparent') return [0, 0, 0, 0]
  const inside = (fn: string) =>
    v.startsWith(`${fn}(`) && v.endsWith(')') ? v.slice(fn.length + 1, -1) : undefined
  const ref = inside('var')
  if (ref !== undefined) {
    const comma = ref.indexOf(',')
    const name = (comma < 0 ? ref : ref.slice(0, comma)).trim()
    const next = props.get(name) ?? (comma < 0 ? undefined : ref.slice(comma + 1))
    return next === undefined ? undefined : paint(next, props, depth + 1)
  }
  const mix =
    /^color-mix\(\s*in\s+[\w-]+\s*,\s*([\s\S]+?)\s+([\d.]+)%\s*,\s*transparent\s*\)$/.exec(v)
  if (mix) {
    const colour = paint(mix[1], props, depth + 1)
    return colour && [colour[0], colour[1], colour[2], (colour[3] * Number(mix[2])) / 100]
  }
  const hex = /^#([0-9a-f]{6})$/i.exec(v)?.[1]
  if (hex) {
    const channel = (i: number) => parseInt(hex.slice(i, i + 2), 16)
    return [channel(0), channel(2), channel(4), 1]
  }
  const rgb = (inside('rgb') ?? inside('rgba'))?.split(',').map(Number)
  if (rgb && (rgb.length === 3 || rgb.length === 4) && rgb.every(Number.isFinite)) {
    return [rgb[0], rgb[1], rgb[2], rgb[3] ?? 1]
  }
  return undefined
}

/** `top` laid over an opaque `under`, as the browser composites them. */
function over(top: Rgba, under: Rgba): Rgba {
  const channel = (i: 0 | 1 | 2) => top[i] * top[3] + under[i] * (1 - top[3])
  return [channel(0), channel(1), channel(2), 1]
}

/** WCAG contrast of `ink` laid over the opaque `ground`. */
function ratio(ink: Rgba, ground: Rgba): number {
  const luminance = (c: Rgba) => {
    const [r, g, b] = [c[0], c[1], c[2]]
      .map((v) => v / 255)
      .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const [hi, lo] = [luminance(over(ink, ground)), luminance(ground)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** WCAG contrast between two opaque colours written as #rrggbb. */
function contrast(a: string, b: string): number {
  return ratio(paint(a, new Map())!, paint(b, new Map())!)
}

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

/** A block's tokens: a variant only overrides some, and the rest are its theme's. */
const tokensOf = (selector: string, id: string | undefined) =>
  new Map([...(block(`[data-theme='${id}']`) ?? []), ...(block(selector) ?? [])])

describe("each theme's floating pair meets UI-28's numbers on its own grounds", () => {
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
    const decls = tokensOf(selector, id)
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

/** A hover or focus state: it repaints a rule that is already there. */
const STATE = /:(?:hover|focus-visible|focus|active)\b/
const painted = (value: string | undefined): value is string =>
  value !== undefined && !/^(?:none|transparent)$/.test(value)

interface TextPair {
  where: string
  ink: string
  /** What the text sits on, laid over the floating surface; the surface itself when undefined. */
  ground?: string
}

/**
 * Each colour of text in a scope with what it is painted on. A rule that paints its own
 * background is measured on it. Text that does not is measured on the surface and on every block
 * in the scope that paints one under text, such as a popover's header band. A hover that only
 * changes the background is measured with the text of the rule it repaints. A class that only
 * recolours another rule's element, such as the card menu's `.danger`, is measured on the surface
 * but not on that rule's hover tint: a stylesheet does not say which elements wear both.
 */
function textPairs(scope: readonly Rule[]): TextPair[] {
  const bands = scope.filter(
    (r) =>
      painted(background(r)) &&
      !r.decls.has('color') &&
      !STATE.test(r.selector) &&
      !r.selector.includes('::')
  )
  const pairs: TextPair[] = []
  for (const rule of scope) {
    const ink = rule.decls.get('color')
    const own = background(rule)
    if (ink === undefined) {
      if (!painted(own) || !STATE.test(rule.selector)) continue
      const base = rule.selector.split(STATE).join('')
      const text = scope.find((r) => r.selector === base)?.decls.get('color')
      if (text !== undefined) pairs.push({ where: rule.selector, ink: text, ground: own })
    } else if (/^(?:inherit|currentColor)$/i.test(ink)) {
      continue
    } else if (painted(own)) {
      pairs.push({ where: rule.selector, ink, ground: own })
    } else {
      pairs.push({ where: rule.selector, ink })
      for (const band of bands) {
        pairs.push({ where: `${rule.selector} on ${band.selector}`, ink, ground: background(band) })
      }
    }
  }
  return pairs
}

/**
 * The custom properties a scope sets for itself, one set per rule that sets them, each over the
 * first: a toast's kinds each give its accent and ink.
 */
function kindsOf(
  scope: readonly Rule[]
): Array<readonly [kind: string, props: Map<string, string>]> {
  const own = (r: Rule) => [...r.decls].filter(([name]) => name.startsWith('--'))
  const setters = scope.filter((r) => own(r).length > 0)
  if (setters.length === 0) return [['', new Map()]]
  return setters.map((r) => [r.selector, new Map([...own(setters[0]), ...own(r)])] as const)
}

describe('text on a floating surface reads 4.5:1 on it, in every theme', () => {
  it('scopes the text of every floating surface, and each scope finds text', () => {
    const files = [...new Set(FLOATING.map(([file]) => file))].sort()
    expect(TEXT_ON_FLOATING.map(([file]) => file).sort()).toEqual(files)
    for (const [file, inside] of TEXT_ON_FLOATING) {
      const scope = all.filter((r) => r.file === file && inside.test(r.selector))
      expect(
        scope.some((r) => r.decls.has('color')),
        `${file}: its scope paints no text`
      ).toBe(true)
    }
  })

  it.each(cases)('%s: every text colour on a floating surface', (selector, id) => {
    const theme = tokensOf(selector, id)
    const grounds = GROUNDS.map((g) => paint(`var(${g})`, theme)).filter(
      (c): c is Rgba => c !== undefined
    )
    const weak: string[] = []
    const measure = (where: string, pair: TextPair, props: ReadonlyMap<string, string>): void => {
      const surface = paint('var(--surface-floating)', props)!
      const ink = paint(pair.ink, props)
      const ground = pair.ground === undefined ? undefined : paint(pair.ground, props)
      if (ink === undefined || (pair.ground !== undefined && ground === undefined)) {
        weak.push(`${where}: cannot read ${pair.ink} on ${pair.ground}`)
        return
      }
      // The rail's labels are the floating surface itself, see-through over the page.
      const under = pair.ground?.includes('--surface-floating') ? grounds : [surface]
      const worst = Math.min(...under.map((u) => ratio(ink, ground ? over(ground, u) : u)))
      if (worst < MIN_TEXT) weak.push(`${where}: ${pair.ink} at ${worst.toFixed(2)}:1`)
    }
    for (const [file, inside] of TEXT_ON_FLOATING) {
      const scope = all.filter((r) => r.file === file && inside.test(r.selector))
      for (const [kind, local] of kindsOf(scope)) {
        const props = new Map([...theme, ...local])
        for (const pair of textPairs(scope).filter((p) => !MARKS.has(`${file} ${p.where}`))) {
          measure(`${file} ${pair.where}${kind ? ` (${kind})` : ''}`, pair, props)
        }
      }
    }
    // Two surfaces are painted from script, not a stylesheet.
    const heatmap = /tooltipEl\.style\.cssText\s*=\s*'[^']*;color:([^;']+);/.exec(
      readFileSync(join(SRC, 'components/D3HeatmapChart.tsx'), 'utf8')
    )?.[1]
    const chart = /const ink = \([^)]*\) => token\(context, '(--[\w-]+)'/.exec(
      readFileSync(join(SRC, 'components/chartFloatingTooltip.ts'), 'utf8')
    )?.[1]
    expect(heatmap).toBeDefined()
    expect(chart).toBeDefined()
    measure("the heatmap's tooltip", { where: '', ink: heatmap! }, theme)
    measure("a chart's tooltip", { where: '', ink: `var(${chart!})` }, theme)
    expect(weak).toEqual([])
  })
})
