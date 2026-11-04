/**
 * Words in a brand colour must read 4.5:1 in every theme.
 *
 * The 3 Nov design review (D1) measured the light theme's brand colours used as text: the azure
 * #3b6fe0 on the button tint at 3.8:1, the money green #14985a at 3.5:1 on the page and the red
 * #d64550 at 4.1:1, the warm accent at 2.6:1 on its own tag, the indigo of a subscription's letter
 * at 3.7:1, and the sidebar's group labels at 4.3:1 in both themes. A colour that has to hold 3:1
 * as a fill or a mark is not dark enough for 12px words.
 *
 * So each hue has a text token beside it, the way `--success-text` sits beside `--success`
 * (successTextContrast.test.ts): `--primary-text`, `--income-text`, `--expense-text`,
 * `--warning-text`, `--avatar-letter`, and the retuned `--text-positive` and `--text-negative`.
 * Fills, chart colours and icons keep the brand colour.
 *
 * Three kinds of check:
 * - each text token measured on the grounds and tints the review found it on, in every theme;
 * - the named rules read the token, not the brand colour;
 * - no stylesheet sets `color:` from a brand colour except the icon rules listed in ICONS, and a
 *   listed rule that no longer exists fails, so the list cannot go stale.
 */
/* eslint-disable security/detect-non-literal-fs-filename -- every path is a theme file, a named
   stylesheet, or walked from src/; nothing comes from outside this file. */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = resolve(__dirname, '..')
const THEMES = resolve(SRC, 'styles/themes')

type Tokens = Record<string, string>

/** Every `--name: value;` in the file. A token declared twice would make this ambiguous, so fail. */
function tokens(file: string): Tokens {
  const css = readFileSync(resolve(THEMES, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const found: Tokens = {}
  for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    const [, name, value] = m
    if (name in found) throw new Error(`${file} declares ${name} twice`)
    found[name] = value.trim()
  }
  return found
}

type Rgb = [number, number, number]

function rgb(hex: string): Rgb {
  const m = /^#([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(hex)
  if (!m) throw new Error(`not a hex colour: ${hex}`)
  const full = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1]
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as Rgb
}

/** `top` at `alpha` over the opaque `under`, as a tint or a translucent label paints. */
function over(top: string, alpha: number, under: string): string {
  const [t, u] = [rgb(top), rgb(under)]
  return `#${t
    .map((v, i) => Math.round(v * alpha + u[i] * (1 - alpha)))
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')}`
}

function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((c) => {
    const v = c / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const orbitDark = tokens('orbit-dark.css')
const dawnLight = tokens('dawn-light.css')
// instrument-deck is a scoped variant inside the dark theme: it overrides some tokens and
// inherits the rest from orbit-dark.
const instrumentDeck = { ...orbitDark, ...tokens('instrument-deck.css') }

const themes: [string, Tokens][] = [
  ['orbit-dark', orbitDark],
  ['dawn-light', dawnLight],
  ['instrument-deck', instrumentDeck],
]

/** A token's value, following one `var(--other)` indirection. */
function value(t: Tokens, name: string): string {
  const v = t[name]
  if (v === undefined) throw new Error(`no ${name}`)
  const ref = /^var\((--[a-z0-9-]+)\)$/.exec(v)
  return ref ? value(t, ref[1]) : v
}

const PAGE_GROUNDS = ['--card-bg', '--surface', '--bg', '--bg-secondary']

/**
 * Each text token and the tints it sits on, beyond the page grounds. A tint is the brand colour at
 * the alpha the stylesheet paints it, over --surface (the review measured it there).
 */
const TINTS: Record<string, [string, string, number][]> = {
  // A tinted primary button at rest (--primary-bg is the azure at 0.1-0.12) and the Import
  // "Account" pill (12%).
  '--primary-text': [['primary button', '--primary', 0.12]],
  // The Income chip and the import's Income pill: the green at 12%.
  '--income-text': [['Income pill', '#22c55e', 0.12]],
  '--text-positive': [['Income pill', '#22c55e', 0.12]],
  '--success-text': [['Income pill', '#22c55e', 0.12]],
  // The Expense chip and the import's Expense pill: the red at 12%.
  '--expense-text': [['Expense pill', '#ef4444', 0.12]],
  '--text-negative': [['Expense pill', '#ef4444', 0.12]],
  '--danger-text': [['Expense pill', '#ef4444', 0.12]],
  // "PDF reports moved to Exports": the warm accent at 14%.
  '--warning-text': [['moved tag', '--accent-warm', 0.14]],
  // A subscription with no brand: the indigo at 14%.
  '--avatar-letter': [['avatar', '#6366f1', 0.14]],
}

describe('brand text tokens', () => {
  for (const [theme, t] of themes) {
    for (const [token, tints] of Object.entries(TINTS)) {
      for (const ground of PAGE_GROUNDS) {
        it(`${token} reaches 4.5:1 on ${ground} in ${theme}`, () => {
          expect(contrast(value(t, token), value(t, ground))).toBeGreaterThanOrEqual(4.5)
        })
      }
      for (const [name, hue, alpha] of tints) {
        it(`${token} reaches 4.5:1 on the ${name} in ${theme}`, () => {
          const tint = over(
            hue.startsWith('--') ? value(t, hue) : hue,
            alpha,
            value(t, '--surface')
          )
          expect(contrast(value(t, token), tint)).toBeGreaterThanOrEqual(4.5)
        })
      }
    }
  }

  // The sidebar is dark in both themes; its group labels are --sidebar-text at an opacity.
  for (const [theme, t] of [
    ['orbit-dark', orbitDark],
    ['dawn-light', dawnLight],
  ] as const) {
    it(`the sidebar's group labels reach 4.5:1 in ${theme}`, () => {
      const rule = ruleIn(resolve(SRC, 'components/Layout.module.css'), '.sidebarGroupHeader')
      const opacity = Number(/opacity:\s*([\d.]+)/.exec(rule)?.[1] ?? 1)
      const ground = value(t, '--sidebar-bg')
      const label = over(value(t, '--sidebar-text'), opacity, ground)
      expect(contrast(label, ground)).toBeGreaterThanOrEqual(4.5)
    })
  }
})

/** The declarations of the rule in `file` whose selector is exactly `selector`, or '' when none is. */
function ruleIn(file: string, selector: string): string {
  const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const at = css.indexOf(`${selector} {`)
  return at < 0 ? '' : css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at))
}

describe('the rules the review named read the text token', () => {
  const cases: [string, string, RegExp][] = [
    // Every tinted primary button: Refresh, Fetch, Add Account, Add Bill, Continue to preview,
    // Import selected, Scan for subscriptions, Mark Paid.
    ['styles/index.css', ':root', /--btn-primary-fg:\s*var\(--primary-text\)/],
    ['features/Import.module.css', '.tab.active', /(?<![-\w])color:\s*var\(--primary-text\)/],
    [
      'features/Import.module.css',
      '.pill.accountActive',
      /(?<![-\w])color:\s*var\(--primary-text\)/,
    ],
    [
      'features/Import.module.css',
      '.pill.incomeActive',
      /(?<![-\w])color:\s*var\(--success-text\)/,
    ],
    [
      'features/Import.module.css',
      '.pill.expenseActive',
      /(?<![-\w])color:\s*var\(--danger-text\)/,
    ],
    ['features/Import.module.css', '.mappingLabel .required', /color:\s*var\(--danger-text\)/],
    [
      'components/Dashboard/OverviewDeck.module.css',
      '.up',
      /(?<![-\w])color:\s*var\(--text-positive\)/,
    ],
    [
      'components/Dashboard/OverviewDeck.module.css',
      '.down',
      /(?<![-\w])color:\s*var\(--text-negative\)/,
    ],
    [
      'features/DashboardPage.module.css',
      '.metric-value.positive',
      /(?<![-\w])color:\s*var\(--income-text\)/,
    ],
    [
      'features/AccountsPage.module.css',
      '.summary-value.negative',
      /(?<![-\w])color:\s*var\(--expense-text\)/,
    ],
    [
      'components/TransactionTable.module.css',
      '.amount.expense',
      /(?<![-\w])color:\s*var\(--expense-text\)/,
    ],
    ['features/SettingsPage.module.css', '.move-tag', /(?<![-\w])color:\s*var\(--warning-text\)/],
    ['components/SubscriptionScan.module.css', '.badge > b', /color:\s*var\(--avatar-letter\)/],
    ['components/Profile.module.css', '.primaryTag', /color:\s*var\(--primary-text\)/],
  ]
  for (const [file, selector, want] of cases) {
    it(`${file} ${selector}`, () => {
      expect(ruleIn(resolve(SRC, file), selector)).toMatch(want)
    })
  }

  it("the light theme's gain and loss text is the darker green and red", () => {
    expect(contrast(value(dawnLight, '--text-positive'), value(dawnLight, '--bg'))).toBeGreaterThan(
      4.5
    )
    expect(contrast(value(dawnLight, '--text-negative'), value(dawnLight, '--bg'))).toBeGreaterThan(
      4.5
    )
  })

  it("the sign-in footer's version is not faded", () => {
    const rule = ruleIn(resolve(SRC, 'components/LoginScreen.module.css'), '.version')
    expect(rule).not.toMatch(/opacity/)
    expect(rule).toMatch(/color:\s*var\(--text-secondary\)/)
  })
})

function walk(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry !== '__tests__') walk(full, found)
    } else if (entry.endsWith('.css')) found.push(full)
  }
  return found
}

/** `file:selector` for every rule whose `color:` is a brand colour rather than its text token. */
function brandColourText(): string[] {
  const found: string[] = []
  for (const file of walk(SRC)) {
    if (file.startsWith(THEMES)) continue
    const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (
        /(?<![-\w])color:\s*var\(--(primary|income|expense|success|warning|danger|info)\s*[,)]/.test(
          m[2]
        )
      )
        found.push(`${relative(SRC, file)}:${m[1].trim().replace(/\s+/g, ' ')}`)
    }
  }
  return found
}

/** Rules that colour an icon, a glyph or a mark, which needs 3:1 and keeps the brand colour. */
const ICONS = [
  'components/AutoCategorizeModal.module.css:.spinnerIcon',
  'components/CommandBar.module.css:.caret',
  'components/Dashboard/OverviewDeck.module.css:.txIcon',
  "components/InfoTip.module.css:.trigger:hover, .trigger:focus-visible, .trigger[aria-expanded='true']",
  'components/InstallAppButton.module.css:.icon',
  'components/Layout.module.css:.sidebarNavActive svg',
  'components/VerifyEmailBanner.module.css:.icon',
  'components/onboarding/Onboarding.module.css:.pickGlyph',
  'features/CategoriesPage.module.css:.icon-browse-btn:hover',
  'features/RetirementPage.module.css:.derived-note svg',
  'features/RetirementPage.module.css:.runway-chip svg',
  'features/SettingsPage.module.css:.halo',
  'features/import/ConnectedSources.module.css:.glyph',
  'components/TourSelectionModal.module.css:.completed .tourBadge',
  "components/guidance/CircleView.module.css:.check[data-state='met'] .mark",
  'features/RentBuyCalculator.module.css:.breakeven-icon',
  'features/RetirementPage.module.css:.runway-chip-warn svg',
  'features/BillCalendar.module.css:.popoverPaidCheck',
]

describe('words take the text token', () => {
  const found = brandColourText()

  it('no stylesheet sets color from a brand colour except an icon rule', () => {
    expect(found.filter((f) => !ICONS.includes(f))).toEqual([])
  })

  it('every listed icon rule still exists', () => {
    expect(ICONS.filter((i) => !found.includes(i))).toEqual([])
  })
})

/** Every `.tsx` under src/, tests aside. */
function walkTsx(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry !== '__tests__') walkTsx(full, found)
    } else if (entry.endsWith('.tsx')) found.push(full)
  }
  return found
}

/**
 * `file: line` for every `color:` in a component's source that names a brand colour: an inline
 * style object (`color: 'var(--primary)'`) or a style string (`style="color: var(--primary)"`).
 * The stylesheet scan above cannot see these.
 */
function inlineBrandColourText(): string[] {
  const found: string[] = []
  const brand =
    /(?<![-\w])color['"]?\s*:\s*['"]?var\(--(primary|income|expense|success|warning|danger|info)\s*[,)]/
  for (const file of walkTsx(SRC)) {
    for (const line of readFileSync(file, 'utf8').split('\n'))
      if (brand.test(line)) found.push(`${relative(SRC, file)}: ${line.trim()}`)
  }
  return found
}

/** Brand colours in a component's source that are not words, each with why. */
const INLINE_EXCEPTIONS: [string, string][] = [
  // The series colours of the overview's sparklines: a line, handed to <Sparkline color>.
  ["components/Dashboard/OverviewDeck.tsx: color: 'var(--primary)',", 'a sparkline stroke'],
  ["components/Dashboard/OverviewDeck.tsx: color: 'var(--income)',", 'a sparkline stroke'],
  ["components/Dashboard/OverviewDeck.tsx: color: 'var(--expense)',", 'a sparkline stroke'],
  [
    "components/BillingPlans.tsx: style={{ color: 'var(--primary, #4f46e5)', 'flex-shrink': 0 }}",
    "the plan list's check mark, an svg drawn in currentColor",
  ],
]

describe("a component's inline words take the text token", () => {
  const found = inlineBrandColourText()
  const allowed = INLINE_EXCEPTIONS.map(([line]) => line)

  it('no inline style sets color from a brand colour except a listed mark', () => {
    expect(found.filter((f) => !allowed.includes(f))).toEqual([])
  })

  it('every listed exception still exists', () => {
    expect(allowed.filter((a) => !found.includes(a))).toEqual([])
  })
})

/**
 * A solid fill that carries words: "On Track", "Fully Allocated", an account's "savings", the
 * import's "dup" and "err", the transaction form's Expense and Income. White on the light theme's
 * green was 3.7:1. Each hue has a fill token for words and `--on-fill` for the words on it.
 */
const FILLS = ['--success-fill', '--danger-fill', '--warning-fill', '--info-fill']

describe('fills that carry words', () => {
  for (const [theme, t] of themes) {
    for (const fill of FILLS) {
      it(`--on-fill reaches 4.5:1 on ${fill} in ${theme}`, () => {
        expect(contrast(value(t, '--on-fill'), value(t, fill))).toBeGreaterThanOrEqual(4.5)
      })
    }
  }

  /** `file:selector` for each rule with a solid fill and words on it, and what it sets. */
  function solidFillsWithWords(): { at: string; bg: string; color: string }[] {
    const out: { at: string; bg: string; color: string }[] = []
    for (const file of walk(SRC)) {
      if (file.startsWith(THEMES)) continue
      const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
      for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const bg = /(?<![-\w])background(?:-color)?:\s*([^;]+)/.exec(m[2])?.[1].trim()
        const color = /(?<![-\w])color:\s*([^;]+)/.exec(m[2])?.[1].trim()
        if (!bg || !color) continue
        const solid =
          /^var\(--(success|income|expense|danger|warning|info)(-fill)?\s*[,)]/.test(bg) &&
          !bg.includes('color-mix')
        if (solid)
          out.push({ at: `${relative(SRC, file)}:${m[1].trim().replace(/\s+/g, ' ')}`, bg, color })
      }
    }
    return out
  }

  it('a solid semantic fill with words is a fill token under --on-fill', () => {
    const wrong = solidFillsWithWords()
      .filter(({ bg, color }) => !/^var\(--[a-z]+-fill\)$/.test(bg) || color !== 'var(--on-fill)')
      .map(({ at, bg, color }) => `${at} (${bg} / ${color})`)
    expect(wrong).toEqual([])
  })

  it('finds the badges the review measured', () => {
    const at = solidFillsWithWords().map((f) => f.at)
    for (const rule of [
      'components/Badge.module.css:.badge-ok',
      'components/Badge.module.css:.badgeSuccess',
      'features/Import.module.css:.dupBadge',
    ])
      expect(at).toContain(rule)
  })
})

/**
 * A colour as written in a stylesheet, as hex in `theme`: a hex literal, `white` or `black`, or a
 * `var(--token, fallback)` followed through the theme. Anything else (a mix, a gradient, an alpha,
 * inherit) is undefined: this check cannot measure it.
 */
function resolveColour(raw: string, t: Tokens, depth = 0): string | undefined {
  const v = raw.replace('!important', '').trim()
  if (v === 'white') return '#ffffff'
  if (v === 'black') return '#000000'
  if (/^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase()
  if (/^#[0-9a-f]{3}$/i.test(v)) return `#${v.slice(1).replace(/./g, '$&$&')}`.toLowerCase()
  if (!v.startsWith('var(') || !v.endsWith(')') || depth > 5) return undefined
  const inner = v.slice(4, -1)
  const comma = inner.indexOf(',')
  const name = (comma < 0 ? inner : inner.slice(0, comma)).trim()
  if (name in t) return resolveColour(t[name], t, depth + 1)
  return comma < 0 ? undefined : resolveColour(inner.slice(comma + 1), t, depth + 1)
}

/** Every rule that paints a background and sets the words on it, as `file:selector`. */
function fillsUnderWords(): { at: string; bg: string; color: string }[] {
  const out: { at: string; bg: string; color: string }[] = []
  for (const file of walk(SRC)) {
    if (file.startsWith(THEMES)) continue
    const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const bg = /(?<![-\w])background(?:-color)?:\s*([^;]+)/.exec(m[2])?.[1]
      const color = /(?<![-\w])color:\s*([^;]+)/.exec(m[2])?.[1]
      if (bg && color)
        out.push({ at: `${relative(SRC, file)}:${m[1].trim().replace(/\s+/g, ' ')}`, bg, color })
    }
  }
  return out
}

describe('words on any fill a rule paints', () => {
  const rules = fillsUnderWords()

  // Whatever colour the fill names: a semantic token, a surface, a legacy hex. White on the
  // tag filter's indigo #6366f1 was 4.47:1.
  it('read 4.5:1 in every theme, where both colours resolve', () => {
    const low: string[] = []
    let measured = 0
    for (const { at, bg, color } of rules) {
      for (const [theme, t] of themes) {
        const [b, c] = [resolveColour(bg, t), resolveColour(color, t)]
        if (!b || !c) continue
        measured += 1
        const ratio = contrast(b, c)
        if (ratio < 4.5) low.push(`${at} in ${theme}: ${c} on ${b}, ${ratio.toFixed(2)}:1`)
      }
    }
    expect(low).toEqual([])
    // A resolver that resolved nothing would pass; it measures hundreds of pairs.
    expect(measured).toBeGreaterThan(200)
  })
})

describe('the primary button, hovered', () => {
  const rule = ruleIn(resolve(SRC, 'styles/index.css'), ':root')
  const alpha =
    Number(
      /--btn-primary-bg-hover:\s*color-mix\(in oklab, var\(--primary\) ([\d.]+)%/.exec(rule)?.[1]
    ) / 100

  it('is a tint of --primary', () => {
    expect(alpha).toBeGreaterThan(0)
  })

  for (const [theme, t] of themes) {
    for (const ground of PAGE_GROUNDS) {
      it(`--primary-text reaches 4.5:1 on the hovered tint over ${ground} in ${theme}`, () => {
        const tint = over(value(t, '--primary'), alpha, value(t, ground))
        expect(contrast(value(t, '--primary-text'), tint)).toBeGreaterThanOrEqual(4.5)
      })
    }
  }
})

describe('muted words at full strength', () => {
  it("the savings rate's period is --text-secondary, not faded", () => {
    const rule = ruleIn(resolve(SRC, 'features/AnalyticsPage.module.css'), '.rate-hero-period')
    expect(rule).toMatch(/(?<![-\w])color:\s*var\(--text-secondary\)/)
    expect(rule).not.toMatch(/opacity/)
  })

  for (const [theme, t] of themes) {
    for (const ground of PAGE_GROUNDS) {
      it(`--text-secondary reaches 4.5:1 on ${ground} in ${theme}`, () => {
        expect(contrast(value(t, '--text-secondary'), value(t, ground))).toBeGreaterThanOrEqual(4.5)
      })
    }
  }
})

describe("a toast's title and action", () => {
  const TOAST = resolve(SRC, 'components/Toast.module.css')
  const kinds: [string, string][] = [
    ['.toast.info', '--primary-text'],
    ['.toast.success', '--success-text'],
    ['.toast.warning', '--warning-text'],
    ['.toast.error', '--danger-text'],
  ]

  for (const [kind, token] of kinds) {
    it(`${kind} sets its words in ${token}`, () => {
      expect(ruleIn(TOAST, kind)).toContain(`--toast-accent-text: var(${token});`)
    })
  }

  for (const selector of ['.title', '.actionBtn']) {
    it(`${selector} reads --toast-accent-text`, () => {
      expect(ruleIn(TOAST, selector)).toMatch(/(?<![-\w])color:\s*var\(--toast-accent-text\)/)
    })
  }
})
