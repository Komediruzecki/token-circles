/**
 * The seal's marks must be seen in every theme (WCAG 1.4.11 asks 3:1 of a graphical object that
 * carries meaning). The plate on Progress is drawn in the theme's `--seal-*` tokens on the card; a
 * finished print in PAPER, on its own cream sheet. Ink draws the petals and the hour marks, the
 * band each month's woven stretch, and copper a month that spent more than came in. `--seal-rule`
 * draws hairlines only (the border rules and the fine rings), so it has no floor here.
 *
 * In the light theme `--accent-warm` (#d97f2e) is 2.99:1 on white, which is why the light copper is
 * a darker tone of its own.
 */
/* eslint-disable security/detect-non-literal-fs-filename -- the paths are the two theme files
   named below, not anything supplied from outside this file. */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PAPER, THEME } from '../../../shared/prints/seal'

const THEMES = resolve(__dirname, '../styles/themes')

type Tokens = Record<string, string>

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

/** A token's colour, following `var(--other)` within the same theme. */
function colour(t: Tokens, value: string, depth = 0): string {
  const ref = /^var\((--[a-z0-9-]+)\)$/.exec(value)
  if (!ref) return value
  if (depth > 5 || t[ref[1]] === undefined) throw new Error(`cannot resolve ${value}`)
  return colour(t, t[ref[1]], depth + 1)
}

function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) throw new Error(`not a six-digit hex colour: ${hex}`)
  const [r, g, b] = [0, 2, 4].map((i) => {
    const v = parseInt(m[1].slice(i, i + 2), 16) / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const MARKS = ['ink', 'band', 'copper'] as const

describe('the seal on the card, in each theme', () => {
  for (const file of ['orbit-dark.css', 'dawn-light.css']) {
    const t = tokens(file)
    it(`${file}: names every colour the THEME palette reads`, () => {
      for (const value of Object.values(THEME)) {
        if (value === null) continue
        expect(() => colour(t, value), `${file} resolves ${value}`).not.toThrow()
      }
    })
    for (const mark of MARKS) {
      it(`${file}: ${mark} holds 3:1 on --card-bg`, () => {
        const fg = colour(t, THEME[mark])
        const bg = colour(t, t['--card-bg'])
        const ratio = contrast(fg, bg)
        expect(ratio, `${mark} ${fg} on ${bg} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(3)
      })
    }
  }
})

describe('a finished print, on its paper', () => {
  for (const mark of MARKS) {
    it(`${mark} holds 3:1 on the sheet`, () => {
      const ratio = contrast(PAPER[mark], PAPER.ground!)
      expect(
        ratio,
        `${PAPER[mark]} on ${PAPER.ground} is ${ratio.toFixed(2)}:1`
      ).toBeGreaterThanOrEqual(3)
    })
  }
})
