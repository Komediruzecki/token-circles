/* eslint-disable security/detect-non-literal-fs-filename -- reads this repo's own package.json and pnpm-workspace.yaml */
/**
 * The pnpm overrides are listed twice, and the two lists must stay identical.
 *
 * WHY THIS GUARD EXISTS. Dependabot writes lockfiles with pnpm 11, which reads overrides only from
 * pnpm-workspace.yaml. CI installs with pnpm 10, frozen, and in worker/ it runs with
 * --ignore-workspace, where pnpm 10 reads them only from package.json's "pnpm.overrides". A lockfile
 * whose overrides block differs from what the installing pnpm is configured with is refused with
 * ERR_PNPM_LOCKFILE_CONFIG_MISMATCH. Until both files carried the list, every lockfile Dependabot
 * wrote came without the block and every one of its PRs failed CI for that reason alone.
 *
 * An override added to one file only brings that back. This test fails when the lists drift, at
 * the root and in worker/.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(import.meta.dirname, '..', '..', '..')

function packageJsonOverrides(dir: string): Record<string, string> {
  const pkg = JSON.parse(readFileSync(join(ROOT, dir, 'package.json'), 'utf8')) as {
    pnpm?: { overrides?: Record<string, string> }
  }
  return pkg.pnpm?.overrides ?? {}
}

/**
 * Reads the top-level `overrides:` map of a pnpm-workspace.yaml. The files hold one
 * `"selector": "version"` pair per line, so this stays a line reader rather than a YAML
 * dependency; anything else inside the block fails loudly instead of being skipped.
 */
function workspaceYamlOverrides(dir: string): Record<string, string> {
  const lines = readFileSync(join(ROOT, dir, 'pnpm-workspace.yaml'), 'utf8').split('\n')
  const start = lines.findIndex((l) => l === 'overrides:')
  if (start === -1) return {}
  const out: Record<string, string> = {}
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue
    if (!line.startsWith(' ')) break
    const m = /^ {2}(["'])(.+?)\1: (["'])(.+?)\3$/.exec(line)
    if (!m) throw new Error(`${dir}/pnpm-workspace.yaml: unreadable override line: ${line}`)
    out[m[2]] = m[4]
  }
  return out
}

describe('pnpm overrides', () => {
  for (const dir of ['.', 'worker']) {
    it(`${dir}: pnpm-workspace.yaml lists the same overrides as package.json`, () => {
      const fromPackageJson = packageJsonOverrides(dir)
      expect(Object.keys(fromPackageJson).length).toBeGreaterThan(0)
      expect(workspaceYamlOverrides(dir)).toEqual(fromPackageJson)
    })
  }
})
