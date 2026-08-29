/**
 * The iOS standalone status bar, pinned from three files that have to agree.
 *
 * On a home-screen install iOS tints the status bar from `<meta name="theme-color">`. The app has
 * to stamp that before first paint — by the time `core/theme.ts` runs the bar is already painted —
 * so `public/theme-init.js` carries the two background colours as LITERALS. It has no choice: that
 * script runs before any stylesheet has loaded, so there is no `--bg` to read.
 *
 * Duplicated colours drift. When they do the failure is quiet and only visible on a real device:
 * the light theme gets a dark navy strip above it, or the dark theme a white one. Nothing in a
 * build, a type check or a browser test sees it. This is what sees it.
 *
 * It also pins the meta tag itself, because the bug that started this was not drift but
 * `apple-mobile-web-app-status-bar-style: black-translucent` — which runs the web view under the
 * status bar and forces WHITE glyphs whatever the theme, so on the light theme the clock and
 * battery washed out into a near-white page and iOS glassed the strip over the top.
 */
/* eslint-disable security/detect-non-literal-fs-filename -- every path is resolved from __dirname,
   none comes from outside this file. */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const FRONTEND = resolve(__dirname, '../..')
const read = (rel: string) => readFileSync(resolve(FRONTEND, rel), 'utf8')

/** The `--bg` a theme file declares — the colour the page actually paints behind everything. */
function themeBg(rel: string): string {
  const match = /--bg:\s*(#[0-9a-fA-F]{3,8})\s*;/.exec(read(rel))
  if (!match) throw new Error(`no --bg token found in ${rel}`)
  return match[1].toLowerCase()
}

/** The literals `theme-init.js` stamps before the stylesheets exist. */
function initColors(): Record<string, string> {
  const src = read('public/theme-init.js')
  const match =
    /var BG = \{\s*dark:\s*'(#[0-9a-fA-F]{3,8})',\s*light:\s*'(#[0-9a-fA-F]{3,8})'\s*\}/.exec(src)
  if (!match) {
    throw new Error(
      'could not find the `var BG = { dark: ..., light: ... }` map in public/theme-init.js. ' +
        'If it was renamed or reshaped, update this test to match — do not delete it.'
    )
  }
  return { dark: match[1].toLowerCase(), light: match[2].toLowerCase() }
}

describe('iOS status bar colour', () => {
  it('stamps the dark theme with the same background the dark theme paints', () => {
    expect(initColors().dark).toBe(themeBg('src/styles/themes/orbit-dark.css'))
  })

  it('stamps the light theme with the same background the light theme paints', () => {
    expect(initColors().light).toBe(themeBg('src/styles/themes/dawn-light.css'))
  })

  it('keeps a theme-color meta tag for those stamps to land on', () => {
    // theme-init.js and core/theme.ts both `querySelector` it; without the tag both no-op
    // silently and the status bar falls back to whatever iOS picks.
    expect(read('index.html')).toMatch(/<meta name="theme-color" content="#[0-9a-fA-F]{3,8}" \/>/)
  })

  it('does not run the web view under the status bar', () => {
    const html = read('index.html')
    expect(html).toContain('name="apple-mobile-web-app-status-bar-style" content="default"')
    // Guard the exact regression, not just the current value: a future edit that reaches for
    // "edge to edge" has to come back here and read why this is not it.
    expect(html).not.toMatch(/content="black-translucent"/)
  })
})
