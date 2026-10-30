/**
 * Text on a primary fill must be readable in every theme.
 *
 * Buttons, active pills, badges and the floating add button paint `--primary` and set their label
 * in `--on-primary`. Before that token existed they all set white, and white on the dark theme's
 * azure (#6e9bff) is 2.69:1, on its hover (#93b4ff) 2.06:1, well under the 4.5:1 WCAG AA asks of
 * text. This reads the three theme files and measures `--on-primary` against every primary shade
 * a fill in the app uses, so a retuned `--primary` or a new `--on-primary` cannot quietly undo it.
 *
 * `primaryFillText.test.ts` is the other half: it fails when a rule sets a primary fill with a
 * hardcoded text colour instead of reading this token.
 */
/* eslint-disable security/detect-non-literal-fs-filename -- the paths are the three theme files
   named below, not anything supplied from outside this file. */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const THEMES = resolve(__dirname, '../styles/themes')

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
// inherits the rest (--primary-strong among them) from orbit-dark.
const instrumentDeck = { ...orbitDark, ...tokens('instrument-deck.css') }

const themes: [string, Tokens][] = [
  ['orbit-dark', orbitDark],
  ['dawn-light', dawnLight],
  ['instrument-deck', instrumentDeck],
]

/**
 * The fills `--on-primary` sits on, with the ratio each must reach.
 *
 * --primary and --primary-hover carry button labels: 4.5:1. --primary-strong carries no text. Its
 * one fill with a foreground is ConnectedSources' `.sync`, an icon-only button whose gradient runs
 * from --primary down to --primary-strong, so its glyph is a graphical object and needs 3:1 (WCAG
 * 1.4.11). In the dark theme --primary-strong is #3b6fe0, where the night ink measures 4.15:1 and
 * white 4.63:1: a text label on that shade would need white, not this token.
 */
const FILLS: [token: string, min: number][] = [
  ['--primary', 4.5],
  ['--primary-hover', 4.5],
  ['--primary-strong', 3],
]

describe('--on-primary on primary fills', () => {
  for (const [theme, t] of themes) {
    for (const [fill, min] of FILLS) {
      it(`${theme}: --on-primary on ${fill} reaches ${min}:1`, () => {
        expect(t['--on-primary'], `${theme} has no --on-primary`).toBeDefined()
        expect(t[fill], `${theme} has no ${fill}`).toBeDefined()
        const ratio = contrast(t['--on-primary'], t[fill])
        expect(
          ratio,
          `${theme}: ${t['--on-primary']} on ${fill} ${t[fill]} is ${ratio.toFixed(2)}:1`
        ).toBeGreaterThanOrEqual(min)
      })
    }
  }
})
