/**
 * Dark styles follow the theme attribute, never a `.dark-mode` class.
 *
 * The app picks its theme with `data-theme` on <html> (`[data-theme='dark']` in
 * `styles/themes/orbit-dark.css`). Nothing sets a `dark-mode` class, so a rule written as
 * `.dark-mode .x` never matches and the component keeps whatever its base rule paints.
 * AutoCategorizeModal stayed white in dark mode that way until it moved onto the theme's
 * variables, and the unused tag components still carried such rules until they were deleted
 * (19 Nov 2026).
 *
 * Style a component with the theme's variables (`--card-bg`, `--border`, `--text`, ...), which
 * both themes define, and it follows the theme with no dark-only rule at all.
 */
/* eslint-disable security/detect-non-literal-fs-filename -- every path is walked from src/, not
   supplied by anything outside this file. */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = resolve(__dirname, '..')

function stylesheets(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) stylesheets(full, found)
    else if (entry.endsWith('.css')) found.push(full)
  }
  return found
}

/**
 * Each line that styles `.dark-mode`, as `<line>: <text>`. Comments are blanked first, keeping
 * their line breaks so the numbers stay right: AutoCategorizeModal.module.css explains the class
 * in a comment, and an explanation is not a rule.
 */
function darkModeRules(css: string): string[] {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '))
    .split('\n')
    .flatMap((line, i) => (/\.dark-mode\b/.test(line) ? [`${i + 1}: ${line.trim()}`] : []))
}

describe('dark styles follow the theme attribute', () => {
  const files = stylesheets(SRC).sort()

  it('finds stylesheets to check', () => {
    expect(files.length).toBeGreaterThan(20)
  })

  it('reads a rule as a rule and a comment as a comment', () => {
    expect(darkModeRules('.a {}\n.dark-mode .b { color: #fff; }')).toEqual([
      '2: .dark-mode .b { color: #fff; }',
    ])
    expect(darkModeRules('/* the old `.dark-mode` class\n   never applied */\n.b {}')).toEqual([])
  })

  it('has no rule on a .dark-mode class, which nothing sets', () => {
    const found = files.flatMap((file) =>
      darkModeRules(readFileSync(file, 'utf8')).map((line) => `${relative(SRC, file)}:${line}`)
    )
    // Use the theme's variables instead; both themes in styles/themes/ define them.
    expect(found).toEqual([])
  })
})
