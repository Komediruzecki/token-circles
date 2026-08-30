/**
 * Direct access to the local D1 the e2e Worker serves from.
 *
 * `wrangler dev` and `wrangler d1 execute --local` share the same state directory, so specs can
 * arrange fixture state the API deliberately refuses to expose — clearing rate-limit counters,
 * resetting a fixture user's 2FA between runs, planting a login code whose raw value the spec
 * knows. Same mechanism global.setup.ts uses; kept here so auth specs don't each grow a copy.
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

function wranglerBin(): { wrangler: string; workerDir: string } {
  const workerDir = resolve(process.cwd(), '..', 'worker')
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- derived from cwd, not input
  if (!existsSync(workerDir)) throw new Error(`worker/ not found next to ${process.cwd()}`)
  // The worker's own wrangler, by path — not `npx wrangler`, which resolves off PATH.
  return { wrangler: resolve(workerDir, 'node_modules', '.bin', 'wrangler'), workerDir }
}

export function sql(command: string): void {
  const { wrangler, workerDir } = wranglerBin()
  execFileSync(wrangler, ['d1', 'execute', 'finance-manager', '--local', '--command', command], {
    cwd: workerDir,
    stdio: 'pipe',
  })
}

/** Run a SELECT and return its rows. */
export function sqlRows<T>(command: string): T[] {
  const { wrangler, workerDir } = wranglerBin()
  const out = execFileSync(
    wrangler,
    ['d1', 'execute', 'finance-manager', '--local', '--json', '--command', command],
    { cwd: workerDir, stdio: 'pipe' }
  ).toString()
  const parsed = JSON.parse(out) as { results: T[] }[]
  return parsed[0]?.results ?? []
}
