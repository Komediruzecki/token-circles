/**
 * Hygiene guardrails for CSS modules.
 *
 * Two failure modes have shipped in this codebase already, both invisible in review
 * because the pages still rendered correctly:
 *   1. Whole blocks of rules pasted twice into the same file. CategoriesPage carried 279
 *      duplicated lines, BudgetsPage 141 — every edit then had to be made in each copy or
 *      the copies silently diverged.
 *   2. A stylesheet left behind with nothing importing it. It never reaches the bundle, so
 *      it looks like live styling while being dead weight.
 *
 * A rule repeated with *different* declarations is a deliberate override (a later rule
 * winning the cascade) and is allowed here. Only byte-identical repeats are flagged.
 */
import { describe, expect, it } from 'vitest'

// `?raw` on a stylesheet only yields source because vitest.config.ts sets `css: true`;
// under the default it resolves to an empty string and these checks would pass vacuously.
const cssModules = import.meta.glob('../../**/*.module.css', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const sources = import.meta.glob(['../../**/*.ts', '../../**/*.tsx'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

interface Rule {
  sel: string
  body: string
  line: number
}

/**
 * Top-level rules only. Comments are blanked out (preserving newlines) so a selector is
 * never confused with the comment above it, and rules nested inside @media/@supports are
 * left alone — they live in their own cascade context.
 */
function topLevelRules(raw: string): Rule[] {
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  const rules: Rule[] = []
  let depth = 0
  let braceStart = 0
  let prevEnd = 0
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (c === '{') {
      if (depth === 0) braceStart = i
      depth++
    } else if (c === '}') {
      depth--
      if (depth === 0) {
        rules.push({
          sel: src.slice(prevEnd, braceStart).trim(),
          body: src
            .slice(braceStart + 1, i)
            .replace(/\s+/g, ' ')
            .trim(),
          line: src.slice(0, braceStart).split('\n').length,
        })
        prevEnd = i + 1
      }
    }
  }
  return rules
}

describe('css modules', () => {
  it('the test fixtures parsed correctly', () => {
    expect(Object.keys(cssModules).length).toBeGreaterThan(10)
    expect(Object.keys(sources).length).toBeGreaterThan(100)
    // Guards the vacuous-pass trap above: every stylesheet must arrive as real source.
    for (const [path, raw] of Object.entries(cssModules)) {
      expect(typeof raw, `${path} arrived as source`).toBe('string')
    }
    expect(Object.values(cssModules).join('').length).toBeGreaterThan(10000)
  })

  it('no rule is repeated verbatim inside the same file', () => {
    const dupes: string[] = []
    for (const [path, raw] of Object.entries(cssModules)) {
      const bySelector = new Map<string, Rule[]>()
      for (const rule of topLevelRules(raw)) {
        if (rule.sel.startsWith('@')) continue
        const seen = bySelector.get(rule.sel) ?? []
        seen.push(rule)
        bySelector.set(rule.sel, seen)
      }
      for (const [sel, rules] of bySelector) {
        if (rules.length < 2) continue
        // Same selector, different declarations: an intentional override, left alone.
        if (new Set(rules.map((r) => r.body)).size !== 1) continue
        dupes.push(`${path}: "${sel}" repeated at lines ${rules.map((r) => r.line).join(', ')}`)
      }
    }
    expect(dupes, `identical rules duplicated within one file:\n${dupes.join('\n')}`).toEqual([])
  })

  it('every css module is imported by some source file', () => {
    // Whole filenames only: a substring match makes Button.module.css look referenced by
    // ExportChartButton.module.css. This file is skipped so its own comments do not count
    // as references.
    const imported = new Set<string>()
    for (const [path, src] of Object.entries(sources)) {
      if (path.includes('cssModuleHygiene')) continue
      for (const m of src.matchAll(/[\w-]+\.module\.css/g)) imported.add(m[0])
    }
    const orphans = Object.keys(cssModules).filter((path) => !imported.has(path.split('/').pop()!))
    expect(
      orphans,
      `css modules nothing imports (dead weight, never bundled):\n${orphans.join('\n')}`
    ).toEqual([])
  })
})
