/**
 * The benchmarks load as a chunk of their own (design.md 2.2, "Loading"): benchmarks.json is 130 KB,
 * and the cards that read it are held behind the benchmarks gate. So neither the entry module nor
 * the pages that show the circles may import them statically; the circle view loads the cards with
 * `import()` when the first card is due, which also keeps them unfetched while the gate is closed.
 *
 * This walks the static import graph from each starting module, following relative imports and
 * skipping type-only ones, which the build erases.
 */
/* eslint-disable security/detect-non-literal-fs-filename -- every path is resolved from src/ and
   shared/ of this repo, not from input */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = resolve(__dirname, '..')
const SHARED = resolve(SRC, '../../shared')

const HELD = [
  resolve(SHARED, 'guidance/benchmarks.json'),
  resolve(SHARED, 'guidance/benchmarks.ts'),
  resolve(SHARED, 'guidance/cards.ts'),
]

/** Static, value imports and re-exports of a module: no `import type`, no `import()`. */
function importsOf(file: string): string[] {
  const text = readFileSync(file, 'utf8')
  const out: string[] = []
  const pattern =
    // eslint-disable-next-line security/detect-unsafe-regex -- runs over this repo's own sources
    /(?:^|[\n;])\s*(import|export)\s+(type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g
  for (const match of text.matchAll(pattern)) {
    if (match[2]) continue
    out.push(match[3])
  }
  return out
}

function resolveImport(from: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null
  const base = resolve(dirname(from), spec.replace(/\?.*$/, ''))
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    base.replace(/\.js$/, '.ts'),
    base.replace(/\.js$/, '.tsx'),
    resolve(base, 'index.ts'),
    resolve(base, 'index.tsx'),
  ]
  return candidates.find((path) => existsSync(path) && !path.endsWith('/')) ?? null
}

/** Every module reachable from `start` by static imports. */
function reachable(start: string): Set<string> {
  const seen = new Set<string>()
  const queue = [start]
  while (queue.length > 0) {
    const file = queue.pop()!
    if (seen.has(file)) continue
    seen.add(file)
    if (!/\.(ts|tsx)$/.test(file)) continue
    for (const spec of importsOf(file)) {
      const next = resolveImport(file, spec)
      if (next && !seen.has(next)) queue.push(next)
    }
  }
  return seen
}

describe('the benchmarks chunk', () => {
  it('is not in the entry chunk', () => {
    const graph = reachable(resolve(SRC, 'index.tsx'))
    // The walk reaches the app, so a miss below means something.
    expect(graph.has(resolve(SRC, 'App.tsx'))).toBe(true)
    for (const held of HELD) expect(graph.has(held), held).toBe(false)
  })

  it('is not in the chunks of the pages that show the circles', () => {
    for (const page of ['features/Progress.tsx', 'features/Dashboard.tsx']) {
      const graph = reachable(resolve(SRC, page))
      expect(graph.has(resolve(SRC, 'components/guidance/CircleView.tsx'))).toBe(
        page === 'features/Progress.tsx'
      )
      for (const held of HELD) expect(graph.has(held), `${page} -> ${held}`).toBe(false)
    }
  })

  it('is loaded by the circle view with import()', () => {
    const view = readFileSync(resolve(SRC, 'components/guidance/CircleView.tsx'), 'utf8')
    expect(view).toContain("import('../../../../shared/guidance/cards')")
  })
})
