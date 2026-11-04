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
  return (
    `#${ 
    t
      .map((v, i) => Math.round(v * alpha + u[i] * (1 - alpha)))
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('')}`
  )
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
      if (/(?<![-\w])color:\s*var\(--(primary|income|expense|success|warning)\s*[,)]/.test(m[2]))
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
