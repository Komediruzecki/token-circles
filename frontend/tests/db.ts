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

const sleepSync = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

/**
 * Specs run in parallel and the dev Worker holds the same file, so a concurrent statement can
 * land on SQLITE_BUSY. That's contention, not failure — retry briefly before giving up.
 */
function execWithRetry(args: string[]): string {
  const { wrangler, workerDir } = wranglerBin()
  let lastErr: unknown
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      return execFileSync(wrangler, args, { cwd: workerDir, stdio: 'pipe' }).toString()
    } catch (err) {
      lastErr = err
      const text = String((err as { stderr?: Buffer; stdout?: Buffer }).stderr ?? '').concat(
        String((err as { stdout?: Buffer }).stdout ?? '')
      )
      if (!text.includes('SQLITE_BUSY') && !text.includes('database is locked')) throw err
      sleepSync(250 * (attempt + 1))
    }
  }
  throw lastErr
}

export function sql(command: string): void {
  execWithRetry(['d1', 'execute', 'finance-manager', '--local', '--command', command])
}

/** Run a SELECT and return its rows. */
export function sqlRows<T>(command: string): T[] {
  const out = execWithRetry([
    'd1',
    'execute',
    'finance-manager',
    '--local',
    '--json',
    '--command',
    command,
  ])
  const parsed = JSON.parse(out) as { results: T[] }[]
  return parsed[0]?.results ?? []
}
