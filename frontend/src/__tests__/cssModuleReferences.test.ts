/**
 * `styles.somethingNobodyDeclared` is `undefined`, and nothing anywhere says so.
 *
 * A CSS module exports only the classes its stylesheet declares. Ask for one it does not and you
 * get `undefined` back: the element renders `class="undefined"`, or `class=""`, or — inside a
 * template literal next to a real class — `class="_alertItem_x undefined"`. `css-modules.d.ts`
 * types the import as `{ [key: string]: string }`, so `tsc` is happy; eslint has no opinion; the
 * build emits it without a word. The page just quietly looks wrong.
 *
 * Thirty-four of these had accumulated by the time anyone asked the bundler. Six empty states on
 * Analytics rendered as bare text in a panel's corner; the Goals category modal showed a native
 * grey button and a browser-default colour swatch beside an identical Bills modal that looked
 * finished; seven transaction-table headers shipped a literal `undefined` in their class list.
 *
 * This test is the only thing that catches the thirty-fifth, which is why — like its sibling
 * cssModuleNaming.test.ts — it reads the files off disk rather than testing a component.
 */
/* eslint-disable security/detect-non-literal-fs-filename -- every path is walked from src/, not
   supplied by anything outside this file. */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = resolve(__dirname, '..')

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) sourceFiles(full, found)
    else if (/\.tsx?$/.test(entry) && !/\.d\.ts$/.test(entry)) found.push(full)
  }
  return found
}

const toCamel = (name: string) => name.replace(/-(\w)/g, (_, c: string) => c.toUpperCase())

/**
 * The keys a stylesheet actually exports. `vite.config.ts` sets
 * `css.modules.localsConvention: 'camelCase'`, so every declared name arrives under BOTH its own
 * spelling and a camelCase alias — which is why a kebab-case rule is reachable as `styles.fooBar`
 * and why grepping the stylesheet for the camel spelling proves nothing.
 */
function exportedKeys(css: string): Set<string> {
  const code = css.replace(/\/\*[\s\S]*?\*\//g, ' ')
  const keys = new Set<string>()
  for (const m of code.match(/\.-?[_a-zA-Z]+[_a-zA-Z0-9-]*/g) ?? []) {
    const name = m.slice(1)
    keys.add(name)
    keys.add(toCamel(name))
  }
  return keys
}

/** `styles.foo` and `styles['foo-bar']`, for one import identifier. Dynamic keys are not checked. */
function referencedKeys(code: string, ident: string): { key: string; line: number }[] {
  // `ident` is the default-import name this repo's own source declares, matched as \w+ — nothing
  // outside the tree reaches it.
  // eslint-disable-next-line security/detect-non-literal-regexp
  const pattern = new RegExp(
    `\\b${ident}\\.([A-Za-z_$][\\w$]*)|\\b${ident}\\[\\s*['"]([^'"]+)['"]\\s*\\]`,
    'g'
  )
  const out: { key: string; line: number }[] = []
  for (const m of code.matchAll(pattern)) {
    out.push({
      key: (m[1] ?? m[2])!,
      line: code.slice(0, m.index).split('\n').length,
    })
  }
  return out
}

/**
 * References that are deliberate rather than broken.
 *
 * `TwofaSettings` asks for a danger button the shared Layout module has never had, and falls back
 * with `?? layoutStyles.btnSecondary`, so it renders correctly today. Whether the button system
 * should grow a danger variant is a design decision, not a typo.
 *
 * This list must only ever shrink. A NEW unresolved reference fails the test.
 */
const KNOWN: Record<string, string[]> = {
  'components/TwofaSettings.tsx': ['btnDanger'],
}

describe('every styles.* reference resolves to a class its module declares', () => {
  const files = sourceFiles(SRC).sort()

  it('finds sources to check', () => {
    expect(files.length).toBeGreaterThan(100)
  })

  it('has no unresolved reference that is not already known about', () => {
    const unresolved: string[] = []

    for (const file of files) {
      const raw = readFileSync(file, 'utf8')
      if (!raw.includes('.module.css')) continue
      const rel = relative(SRC, file)
      const known = KNOWN[rel] ?? []

      // Comments come out for the same reason the sibling test strips them: prose about one of
      // these bugs quotes the very names it is about, and a scanner that reads it reports the
      // explanation as the problem. This file is its own best example — it is scanned too.
      const commentless = raw.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, '')
      // References are then looked for with the imports removed as well, so that a specifier like
      // './ChartContainer.module.css' does not read as a reference to `ChartContainer.module`.
      const code = commentless.replace(/^\s*import\b[^\n]*$/gm, '')

      for (const m of commentless.matchAll(/import\s+(\w+)\s+from\s+'([^']*\.module\.css)'/g)) {
        const [, ident, spec] = m
        const stylesheet = spec!.startsWith('@/')
          ? resolve(SRC, spec!.slice(2))
          : resolve(dirname(file), spec!)
        const keys = exportedKeys(readFileSync(stylesheet, 'utf8'))

        for (const { key, line } of referencedKeys(code, ident!)) {
          if (keys.has(key) || known.includes(key)) continue
          unresolved.push(`${rel}:${line} ${ident}.${key} -> not in ${relative(SRC, stylesheet)}`)
        }
      }
    }

    // Named in the failure so the fix is obvious: either the class name is wrong, or the rule was
    // never written.
    expect([...new Set(unresolved)].sort()).toEqual([])
  })

  it('keeps the known list honest — every entry is still a real gap', () => {
    // A stale allowlist is how a guard rots into decoration.
    for (const [rel, keys] of Object.entries(KNOWN)) {
      const raw = readFileSync(join(SRC, rel), 'utf8')
      const commentless = raw.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, '')
      for (const m of commentless.matchAll(/import\s+(\w+)\s+from\s+'([^']*\.module\.css)'/g)) {
        const [, ident, spec] = m
        const declared = exportedKeys(readFileSync(resolve(dirname(join(SRC, rel)), spec!), 'utf8'))
        for (const key of keys) {
          if (!referencedKeys(raw, ident!).some((r) => r.key === key)) continue
          expect(declared, `${rel} now declares ${key} — remove it from KNOWN`).not.toContain(key)
        }
      }
    }
  })

  it('still catches the shapes that shipped', () => {
    // A guard nobody has watched fail is a guard nobody knows works. These are three of the real
    // thirty-four, reconstructed against a stylesheet that does not declare them.
    const css = '.alert-item { color: red; }\n.over { color: red; }\n'
    const keys = exportedKeys(css)
    expect(keys.has('alertItem')).toBe(true) // the camelCase alias is reachable
    expect(keys.has('alert-item')).toBe(true) // and so is the original
    expect(keys.has('ok')).toBe(false) // the budget-alert "ok" state
    expect(keys.has('col')).toBe(false) // the transaction-table header base class
    expect(keys.has('emptyState')).toBe(false) // Analytics' six empty states
  })
})
