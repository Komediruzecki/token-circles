/**
 * Small text in the success hue must be readable in every theme.
 *
 * A circle check that is met says "Met" (shared/guidance/circleView.ts) in 12px type. It was set
 * in `--success`, and the light theme's #14985a on the check's white card is 3.70:1, under the
 * 4.5:1 WCAG AA asks of text (3 Nov test run). `--success` stays for the check's mark, a graphic,
 * which needs 3:1; the word takes `--success-text`. This reads the theme files and measures
 * `--success-text` on the grounds a check sits on, and reads CircleView.module.css for the rule
 * that sets the word, so a retuned token or a rule back on `--success` fails here.
 *
 * A badge's toast has the same small green text: its "See badges" or "See my prints" button, 12px
 * on the toast's surface, was 3.7:1 in `--success` (review D1). Toast.module.css sets it in
 * `--toast-accent-text`, which a success toast points at `--success-text`.
 */
/* eslint-disable security/detect-non-literal-fs-filename -- the paths are the theme files and the
   one stylesheet named below, not anything supplied from outside this file. */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const THEMES = resolve(__dirname, '../styles/themes')
const CIRCLE_VIEW_CSS = resolve(__dirname, '../components/guidance/CircleView.module.css')
const TOAST_CSS = resolve(__dirname, '../components/Toast.module.css')

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

function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(hex)
  if (!m) throw new Error(`not a hex colour: ${hex}`)
  const full = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1]
  const [r, g, b] = [0, 2, 4].map((i) => {
    const v = parseInt(full.slice(i, i + 2), 16) / 255
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

describe('--success-text', () => {
  for (const [theme, t] of themes) {
    for (const ground of ['--card-bg', '--surface', '--bg']) {
      it(`reaches 4.5:1 on ${ground} in ${theme}`, () => {
        expect(t['--success-text'], `${theme} has no --success-text`).toBeDefined()
        expect(contrast(t['--success-text'], t[ground])).toBeGreaterThanOrEqual(4.5)
      })
    }
  }
})

/** The declarations of the rule in `file` whose selector is exactly `selector`, or '' when none is. */
function ruleIn(file: string, selector: string): string {
  const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const at = css.indexOf(`${selector} {`)
  return at < 0 ? '' : css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at))
}

describe("a met circle check's word", () => {
  it('is set in --success-text, and the mark beside it in --success', () => {
    const rule = (selector: string) => ruleIn(CIRCLE_VIEW_CSS, selector)
    expect(rule(".check[data-state='met'] .check-state")).toMatch(/color:\s*var\(--success-text\)/)
    expect(rule(".check[data-state='met'] .mark")).toMatch(/color:\s*var\(--success\)/)
  })
})

describe("a success toast's button", () => {
  it('is set in --success-text, and the icon and border keep --success', () => {
    const rule = (selector: string) => ruleIn(TOAST_CSS, selector)
    expect(rule('.actionBtn')).toMatch(/(?<![-\w])color:\s*var\(--toast-accent-text\)/)
    expect(rule('.toast.success')).toMatch(/--toast-accent-text:\s*var\(--success-text\)/)
    expect(rule('.toast.success')).toMatch(/--toast-accent:\s*var\(--success\)/)
  })
})
