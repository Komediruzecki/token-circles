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
import ts from 'typescript'
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

/** The tag a JSX element names: `button`, `form`, `Field`. */
const tagOf = (node: ts.JsxOpeningElement | ts.JsxSelfClosingElement): string =>
  node.tagName.getText()

/** Is `node` inside a `<form>` element, at any depth? */
function insideAForm(node: ts.Node): boolean {
  for (let up = node.parent as ts.Node | undefined; up; up = up.parent) {
    if (ts.isJsxElement(up) && tagOf(up.openingElement) === 'form') return true
  }
  return false
}

/**
 * Every `<button>` inside a form whose attributes do not include `type`, by the line it opens on.
 *
 * Read with the TypeScript parser, so a tag's attributes are all of them, up to the `>` that
 * closes it. The scan before this read from `<button` to the first `>`, which an arrow function's
 * `=>` in an attribute supplies: the tag ended there, and a `type` after it went unseen.
 */
function submitsByAccident(source: string): number[] {
  const file = ts.createSourceFile(
    'scan.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  )
  const bad: number[] = []
  const visit = (node: ts.Node) => {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      tagOf(node) === 'button' &&
      insideAForm(node) &&
      !node.attributes.properties.some((p) => ts.isJsxAttribute(p) && p.name.getText() === 'type')
    ) {
      bad.push(file.getLineAndCharacterOfPosition(node.getStart()).line + 1)
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
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

  it('reads the whole tag, past an arrow function before `type`', () => {
    // `=>` has a `>` in it. Read only to the first `>`, this tag ended at the arrow, the `type`
    // after it went unseen, and a button that states its type was flagged: slice 4b moved
    // `type="button"` to the front in ProfileModal to get past it.
    const typed = `
      <form onSubmit={save}>
        <button
          onClick={() => setOpen(false)}
          type="button"
        >
          Cancel
        </button>
        <button type="submit">Save</button>
      </form>`
    expect(submitsByAccident(typed)).toEqual([])
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
