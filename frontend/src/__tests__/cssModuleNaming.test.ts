/**
 * Two class names in one CSS module that differ only in kebab-vs-camel are a silent bug.
 *
 * `vite.config.ts` sets `css.modules.localsConvention: 'camelCase'`, which exports a camelCase
 * ALIAS alongside every original name. So `.form-input` and `.formInput` in the same file both
 * arrive in the JS as `styles.formInput`, one key overwrites the other, and whichever rule loses
 * is dead CSS — while the element that asked for it renders with no rule at all.
 *
 * That is not hypothetical. `BudgetsPage.module.css` had exactly this: a late `.iconField
 * .formInput` block hijacked `styles.formInput` away from `.form-input`, so all six form controls
 * in Budgets.tsx rendered with no background, no border and no padding. In dark mode a transparent
 * `<select>` is what Chrome paints its option list white behind, under text that is still light —
 * white on white, and unreadable.
 *
 * Nothing about that fails a build, a type check or a lint. This test is the only thing that
 * catches it, which is why it reads the stylesheets off disk rather than testing a component.
 */
/* eslint-disable security/detect-non-literal-fs-filename -- every path is walked from src/, not
   supplied by anything outside this file. */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = resolve(__dirname, '..')

function cssModules(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) cssModules(full, found)
    else if (entry.endsWith('.module.css')) found.push(full)
  }
  return found
}

const toCamel = (name: string) => name.replace(/-(\w)/g, (_, c: string) => c.toUpperCase())

/**
 * Every class name a stylesheet defines or references.
 *
 * Comments are stripped first, and not as a nicety: a comment explaining a naming rule tends to
 * quote the very names it is about, and a scanner that reads them reports the explanation as the
 * problem. This one did exactly that on its own first run.
 */
function classNames(css: string): Set<string> {
  const code = css.replace(/\/\*[\s\S]*?\*\//g, ' ')
  return new Set(code.match(/\.-?[_a-zA-Z]+[_a-zA-Z0-9-]*/g)?.map((m) => m.slice(1)) ?? [])
}

/** Groups of names in one file that collapse to the same `styles.<key>`. */
function collisions(css: string): { key: string; names: string[] }[] {
  const byKey = new Map<string, Set<string>>()
  for (const name of classNames(css)) {
    const key = toCamel(name)
    if (!byKey.has(key)) byKey.set(key, new Set())
    byKey.get(key)!.add(name)
  }
  return [...byKey]
    .filter(([, names]) => names.size > 1)
    .map(([key, names]) => ({ key, names: [...names].sort() }))
}

/**
 * Collisions that were already here when this test was written, each one a latent bug of the same
 * shape: one of the two rule sets is dead, and the element using `styles.<key>` is getting the
 * other one. They are listed rather than fixed because unpicking each needs the affected page
 * looked at — merging them changes how something renders, and that is a separate, visible change.
 *
 * This list must only ever shrink. A NEW collision fails the test.
 */
const KNOWN: Record<string, string[]> = {
  'components/Layout.module.css': ['sidebarNav'],
  'features/BillsPage.module.css': ['billsSection'],
  'features/BudgetsPage.module.css': ['categoriesSection', 'categoryChartSection'],
  'features/LoansPage.module.css': ['loansPage'],
  'features/TransactionsPage.module.css': ['modalFooter', 'modalTitle'],
}

describe('CSS modules do not define one class name two ways', () => {
  const files = cssModules(SRC).sort()

  it('finds stylesheets to check', () => {
    expect(files.length).toBeGreaterThan(20)
  })

  it('has no collision that is not already known about', () => {
    const unexpected: string[] = []
    for (const file of files) {
      const rel = relative(SRC, file)
      const known = KNOWN[rel] ?? []
      for (const { key, names } of collisions(readFileSync(file, 'utf8'))) {
        if (!known.includes(key)) unexpected.push(`${rel}: ${names.join(' / ')} -> styles.${key}`)
      }
    }
    // Named in the failure so the fix is obvious: pick one spelling and merge the rules.
    expect(unexpected).toEqual([])
  })

  it('no longer has the one that made the budget form unreadable', () => {
    const css = readFileSync(join(SRC, 'features/BudgetsPage.module.css'), 'utf8')
    const keys = collisions(css).map((c) => c.key)
    expect(keys).not.toContain('formInput')
    // And the rule the form controls actually need is still there.
    expect(css).toContain('.form-input {')
  })

  it('keeps the known list honest — every entry is still a real collision', () => {
    // A stale allowlist is how a guard rots into decoration. If one of these is fixed, this fails
    // until it is taken off the list.
    for (const [rel, keys] of Object.entries(KNOWN)) {
      const found = collisions(readFileSync(join(SRC, rel), 'utf8')).map((c) => c.key)
      for (const key of keys) {
        expect(found, `${rel} no longer collides on ${key} — remove it from KNOWN`).toContain(key)
      }
    }
  })
})
