/**
 * `vite build --outDir X` must put every file the build writes itself into X. The export
 * documents and version.json were written to a hard-coded `dist/`: the build failed with ENOENT
 * when there was no dist/, and when there was one, X shipped without them.
 */
/* eslint-disable security/detect-non-literal-fs-filename -- every path is under a mkdtemp of this
   test's own making. */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { STANDALONE_FILES, standaloneFilesPlugin, versionJsonPlugin } from '../buildOutputFiles'

type Hooks = {
  apply: string
  configResolved: (c: unknown) => void
  writeBundle: () => void
}
const hooks = (p: unknown) => p as Hooks

describe('build output files', () => {
  let tmp: string
  let source: string
  let root: string
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'build-output-files-'))
    // The frontend folder the export documents are copied from, and the build's root. Kept apart
    // so a write to either one's dist/ shows up.
    source = join(tmp, 'frontend')
    root = join(tmp, 'root')
    mkdirSync(source)
    mkdirSync(join(root, 'custom-out'), { recursive: true })
    for (const file of STANDALONE_FILES) writeFileSync(join(source, file), `contents of ${file}`)
  })
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  /** Run both plugins as `vite build --outDir custom-out` would: configResolved, then writeBundle. */
  function build(outDir: string) {
    const plugins = [
      hooks(standaloneFilesPlugin(source)),
      hooks(versionJsonPlugin({ version: '9.9.9', gitSha: 'abc1234' })),
    ]
    for (const p of plugins) p.configResolved({ root, build: { outDir } })
    for (const p of plugins) p.writeBundle()
  }

  it('writes all four files into a custom outDir and nothing into dist/', () => {
    // The silent case: a dist/ left by an earlier build, which the old code wrote into instead.
    mkdirSync(join(root, 'dist'))
    mkdirSync(join(source, 'dist'))
    build('custom-out')
    const out = join(root, 'custom-out')
    for (const file of STANDALONE_FILES) {
      expect(readFileSync(join(out, file), 'utf8')).toBe(`contents of ${file}`)
    }
    const version = JSON.parse(readFileSync(join(out, 'version.json'), 'utf8'))
    expect(version).toMatchObject({ version: '9.9.9', gitSha: 'abc1234' })
    expect(Number.isNaN(Date.parse(version.builtAt))).toBe(false)
    expect(readdirSync(join(root, 'dist'))).toEqual([])
    expect(readdirSync(join(source, 'dist'))).toEqual([])
  })

  it('needs no dist/ to exist, and takes an absolute outDir as it is', () => {
    const absolute = join(tmp, 'elsewhere')
    mkdirSync(absolute)
    build(absolute)
    expect(existsSync(join(absolute, 'export.html'))).toBe(true)
    expect(existsSync(join(absolute, 'version.json'))).toBe(true)
    expect(existsSync(join(root, 'custom-out', 'version.json'))).toBe(false)
    expect(existsSync(join(root, 'dist'))).toBe(false)
    expect(existsSync(join(source, 'dist'))).toBe(false)
  })

  it('only runs at build time', () => {
    expect(hooks(standaloneFilesPlugin(source)).apply).toBe('build')
    expect(hooks(versionJsonPlugin({ version: '', gitSha: '' })).apply).toBe('build')
  })
})
