/**
 * A colour that already carries its `#` must not be given a second one.
 *
 * Category and tag colours are stored with the hash at every write: the columns default to
 * `'#6b7280'` (`worker/migrations/0001_init.sql`), the seeded categories are `'#22C55E'`,
 * `'#F97316'` and the rest (`worker/src/profileData.ts`), the offline handler writes `'#6e9bff'`,
 * and the pickers are `<input type="color">`, which cannot emit anything else. Nothing strips it.
 *
 * `` style={{ background: `#${tag.color}` }} `` therefore builds `##6e9bff`. The CSS parser
 * rejects the declaration and drops it without a word — no console warning, no thrown error, and
 * a diff that looks exactly like every correct line beside it. Four of these shipped: a tag chip
 * on the transactions table (`.tag` sets `color: #fff` and no background of its own, so the label
 * rendered white on the table's own background), the category and tag swatches in the filter
 * dropdowns, and the budget-alert dot on the dashboard — the last three 10x10 circles that simply
 * were not there.
 *
 * This is a source scan and not a component test because the bug is one character in a template
 * literal, and the only reliable way to find every instance of that is to look at every one. The
 * rendered proof lives in src/components/__tests__/storedColours.test.tsx.
 */
/* eslint-disable security/detect-non-literal-fs-filename -- every path is walked from src/, not
   supplied by anything outside this file. */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = resolve(__dirname, '..')

function tsFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) tsFiles(full, found)
    else if (/\.tsx?$/.test(entry) && !/\.d\.ts$/.test(entry)) found.push(full)
  }
  return found
}

/**
 * `#` immediately before an interpolation, on a line that is talking about colour.
 *
 * The same shape is completely correct for a hash route — `href={`#${item.name}`}` in App.tsx,
 * `` `#${page}?${query}` `` in periodStore — so the scan is narrowed by what the line is for
 * rather than by an allowlist of files, which would go stale the moment a route moved.
 *
 * `url(#${id})` is excluded outright: an SVG paint server is referenced by fragment id, so that
 * `#` belongs to the reference and not to a colour. BadgeMedallion and CategoryOrbits both do it,
 * correctly, on lines that are unavoidably about `fill`.
 */
const INTERPOLATED_HASH = /(?<!url\()#\$\{/
/*
 * Substring and case-insensitive, deliberately. `\bcolor\b` matches neither `categoryColor` nor
 * `category_color` — the app's own two commonest names for exactly this value — so a word-boundary
 * test is blind to the shape it is looking for.
 */
const ABOUT_COLOUR = /(background|colou?r|fill|stroke|shadow|swatch|hue|tint|paint)/i

/*
 * A two-line window, because the offending interpolation and the word that identifies it as a
 * colour are routinely on different lines: Prettier splits a long style prop, and a template
 * literal that builds CSS puts `background: #${x}` on its own line with no backtick in sight.
 */
function offenders(code: string): { line: number; text: string }[] {
  const lines = code.split('\n')
  return lines
    .map((text, i) => ({
      line: i + 1,
      text: text.trim(),
      window: `${lines[i - 1] ?? ''}\n${text}`,
    }))
    .filter(({ text, window }) => INTERPOLATED_HASH.test(text) && ABOUT_COLOUR.test(window))
    .map(({ line, text }) => ({ line, text }))
}

describe('a stored colour is never given a second #', () => {
  const files = tsFiles(SRC).sort()

  it('finds sources to check', () => {
    expect(files.length).toBeGreaterThan(100)
  })

  it('has no colour built by pasting # in front of a stored value', () => {
    const found: string[] = []
    for (const file of files) {
      // This file quotes the very pattern it bans, and so does its rendered sibling.
      const rel = relative(SRC, file)
      if (rel === '__tests__/storedColourHash.test.ts') continue
      if (rel === 'components/__tests__/storedColours.test.tsx') continue
      for (const { line, text } of offenders(readFileSync(file, 'utf8'))) {
        found.push(`${rel}:${line} ${text}`)
      }
    }
    // Named in the failure so the fix is obvious: drop the `#`, and give the fallback its own.
    expect(found).toEqual([])
  })

  it('still recognises the four that shipped', () => {
    // A guard nobody has watched fail is a guard nobody knows works.
    expect(offenders('style={{ background: `#${tag.color}` }}')).toHaveLength(1)
    expect(
      offenders("style={{ 'background-color': `#${alert.categoryColor || 'ef4444'}` }}")
    ).toHaveLength(1)
    expect(
      offenders('<span class={styles.catDot} style={{ background: `#${cat.color}` }} />')
    ).toHaveLength(1)
    // …and leaves hash routes alone, which is why it reads the line rather than the filename.
    expect(offenders('href={`#${item.name}`}')).toHaveLength(0)
    expect(offenders('return query ? `#${page}?${query}` : `#${page}`')).toHaveLength(0)
    // …and SVG paint servers, which are referenced by fragment id on a `fill` line.
    expect(offenders('fill={`url(#${coreId})`}')).toHaveLength(0)
    expect(offenders('return `<circle fill="url(#${uid}-face)" stroke="${paint}"/>`')).toHaveLength(
      0
    )
  })

  it('sees the shapes a line-at-a-time word-boundary scan would miss', () => {
    // The two identifiers this codebase actually uses. `\bcolor\b` matches neither.
    expect(offenders('style={{ background: `#${categoryColor}` }}')).toHaveLength(1)
    expect(offenders("style={{ '--dot': `#${category_color}` }}")).toHaveLength(1)
    // Prettier splitting a long prop, so the colour word is on the line above.
    expect(offenders('        background:\n          `#${swatchHex}`,')).toHaveLength(1)
    // A template literal that builds CSS: the offending line carries no backtick at all.
    expect(offenders('const css = `\n  .dot { background: #${color}; }\n`')).toHaveLength(1)
    expect(offenders("style={{ 'text-shadow': `0 0 2px #${hex}` }}")).toHaveLength(1)
  })
})
