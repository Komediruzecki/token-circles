/**
 * A `<button>` inside a `<form>` with no `type` submits the form.
 *
 * That is the HTML default — `type="submit"` — and it is the single easiest way to build a form
 * control that saves and closes the dialog the moment it is touched. It looks completely correct
 * in the diff: the handler does the one thing it should, and nothing anywhere says "and also
 * submit". Solid does not warn, TypeScript cannot see it, and eslint's JSX rules do not cover it.
 *
 * It shipped twice. Picking a colour for a category — on the Categories page and again in the
 * Budgets page's category form — saved the category and closed the modal, which read as the form
 * mysteriously auto-closing rather than as a swatch that was secretly a Save button.
 *
 * This is a source scan rather than a component test because the bug is a missing attribute, and
 * the only reliable way to find every instance of a missing attribute is to look at every one.
 */
/* eslint-disable security/detect-non-literal-fs-filename -- every path is walked from src/, not
   supplied by anything outside this file. */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = resolve(__dirname, '..')

function tsxFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) tsxFiles(full, found)
    else if (entry.endsWith('.tsx')) found.push(full)
  }
  return found
}

/*
 * `(?![-\w])` and not `[\s>]`: attributes usually start on the NEXT line, so `<button` is very
 * often the whole line, with no following character to match. A scanner that misses that misses
 * the exact shape the bug ships in.
 */

/** Line spans covered by a `<form>`, counting nesting so a second form does not close the first. */
function formSpans(lines: string[]): [number, number][] {
  const spans: [number, number][] = []
  let depth = 0
  let start = 0
  lines.forEach((line, i) => {
    if (/<form(?![-\w])/.test(line)) {
      if (depth === 0) start = i
      depth += 1
    }
    if (line.includes('</form>')) {
      depth -= 1
      if (depth === 0) spans.push([start, i])
    }
  })
  return spans
}

/**
 * Every `<button>` opened inside a form whose attributes do not include `type`.
 *
 * The attribute list runs from `<button` to the first `>`, which may be several lines down — so
 * the scan reads forward from the opening tag rather than looking at that line alone.
 */
function submitsByAccident(source: string): number[] {
  const lines = source.split('\n')
  const spans = formSpans(lines)
  const bad: number[] = []

  lines.forEach((line, i) => {
    if (!/<button(?![-\w])/.test(line)) return
    if (!spans.some(([a, b]) => i >= a && i <= b)) return

    const rest = lines.slice(i).join('\n')
    const attrs = rest.slice(rest.indexOf('<button')).split('>')[0] ?? ''
    if (!/\stype=/.test(attrs)) bad.push(i + 1)
  })
  return bad
}

describe('no button inside a form submits it by accident', () => {
  const files = tsxFiles(SRC)

  it('finds components to check', () => {
    expect(files.length).toBeGreaterThan(50)
    expect(files.some((f) => f.endsWith('Categories.tsx'))).toBe(true)
  })

  it('every button inside a form states its type', () => {
    const offenders: string[] = []
    for (const file of files) {
      for (const line of submitsByAccident(readFileSync(file, 'utf8'))) {
        offenders.push(`${relative(SRC, file)}:${line}`)
      }
    }
    // Named in the failure so the fix is obvious: add type="button", or type="submit" if it really
    // is the one that saves.
    expect(offenders).toEqual([])
  })

  it('detects the bug it was written for', () => {
    // A scanner that cannot fail is not a guard. This is the Categories colour swatch as it
    // shipped, with the attribute removed again.
    const regression = `
      <form onSubmit={handleSubmit}>
        <div class={styles.colorPicker}>
          <button
            class={styles.colorPickerBtn}
            onClick={() => setFormData({ ...formData(), color })}
          />
        </div>
        <button type="submit">Save</button>
      </form>`
    expect(submitsByAccident(regression)).toEqual([4])
  })

  it('does not flag a button outside any form', () => {
    const fine = `
      <div>
        <button onClick={close} />
      </div>
      <form>
        <button type="button" onClick={pick} />
      </form>`
    expect(submitsByAccident(fine)).toEqual([])
  })
})
