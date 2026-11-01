/**
 * A real `vite build --outDir X`: everything the build writes lands in X, the service worker in X
 * precaches X's own files, and nothing is written to frontend/dist.
 *
 * buildOutputFiles.test.ts pins the two plugins this repo owns. This one covers what only a whole
 * build shows: the precache manifest. It is globbed by vite-plugin-pwa, and a hard-coded
 * `globDirectory: 'dist'` made X's sw.js list whatever dist/ held (nothing at all, or an older
 * build's hashed files) instead of X.
 */
/* eslint-disable security/detect-non-literal-fs-filename -- every path is this test's own mkdtemp
   or the frontend folder's dist/, joined with literal names. */
import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const FRONTEND = resolve(import.meta.dirname, '../..')
const DIST = join(FRONTEND, 'dist')
// The `vite` script itself; its package exports do not include bin/.
const VITE_BIN = join(FRONTEND, 'node_modules', 'vite', 'bin', 'vite.js')

/** What frontend/dist looked like: absent, or its entries and their modification times. */
function snapshotDist(): string {
  if (!existsSync(DIST)) return 'absent'
  return readdirSync(DIST)
    .sort()
    .map((name) => `${name}@${statSync(join(DIST, name)).mtimeMs}`)
    .join('\n')
}

describe('vite build --outDir', () => {
  let out: string
  let distBefore: string
  beforeAll(async () => {
    out = join(mkdtempSync(join(tmpdir(), 'build-outdir-')), 'out')
    distBefore = snapshotDist()
    // NODE_ENV=test (vitest's) would turn on the dev-only plugins and sourcemaps; build as deploys do.
    const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: 'production' }
    delete env.VITEST
    await promisify(execFile)(
      process.execPath,
      [VITE_BIN, 'build', '--outDir', out, '--logLevel', 'error'],
      { cwd: FRONTEND, env, maxBuffer: 64 * 1024 * 1024 }
    )
  }, 240_000)
  afterAll(() => {
    rmSync(resolve(out, '..'), { recursive: true, force: true })
  })

  it('writes the export documents and version.json into the outDir', () => {
    for (const file of ['export.html', 'export-monthly.html', 'chart.umd.min.js', 'version.json']) {
      expect(existsSync(join(out, file)), file).toBe(true)
    }
  })

  it("precaches the outDir's own assets, every one of them and nothing else", () => {
    const sw = readFileSync(join(out, 'sw.js'), 'utf8')
    const precached = [...sw.matchAll(/"url":"([^"]+)"/g)].map((m) => m[1])
    const built = readdirSync(join(out, 'assets'))
      .filter((name) => /\.(?:js|css)$/.test(name))
      .map((name) => `assets/${name}`)
    expect(built.length).toBeGreaterThan(0)
    for (const url of built) expect(precached, url).toContain(url)
    for (const url of precached) expect(existsSync(join(out, url)), url).toBe(true)
  })

  it('leaves frontend/dist as it was', () => {
    expect(snapshotDist()).toBe(distBefore)
  })
})
