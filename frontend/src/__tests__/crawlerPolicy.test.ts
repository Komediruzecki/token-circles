/**
 * Only the production build is indexable — pinned at the unit level here, and at the build level
 * by the `build:dev` smoke in CI, because this is the kind of thing that fails silently: a dev
 * host that starts ranking is discovered by a search, not by a test.
 */
/* eslint-disable security/detect-non-literal-fs-filename -- every path is under a mkdtemp of this
   test's own making. */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  crawlerPolicyPlugin,
  isIndexable,
  NOINDEX_HEADERS_BLOCK,
  NOINDEX_META,
  noindexFiles,
  withNoindexMeta,
} from '../crawlerPolicy'

const HTML = '<!doctype html>\n<html>\n  <head>\n    <meta charset="utf-8" />\n  </head>\n</html>'

describe('withNoindexMeta', () => {
  it('puts the robots meta directly inside <head>', () => {
    const out = withNoindexMeta(HTML)
    expect(out).toContain(NOINDEX_META)
    expect(out.indexOf(NOINDEX_META)).toBeGreaterThan(out.indexOf('<head>'))
    expect(out.indexOf(NOINDEX_META)).toBeLessThan(out.indexOf('<meta charset'))
  })

  it('does not double up when a robots meta is already present', () => {
    const once = withNoindexMeta(HTML)
    expect(withNoindexMeta(once)).toBe(once)
  })
})

describe('isIndexable', () => {
  it('is true for production and nothing else', () => {
    expect(isIndexable('production')).toBe(true)
    // The dev deploy and PR previews build with --mode dev; `vite dev` runs as development.
    for (const mode of ['dev', 'development', 'preview', 'test', '']) {
      expect(isIndexable(mode)).toBe(false)
    }
  })
})

describe('noindexFiles', () => {
  it('writes a robots.txt that disallows everything and never allows', () => {
    const robots = noindexFiles('')['robots.txt']
    expect(robots).toMatch(/^User-agent: \*$/m)
    expect(robots).toMatch(/^Disallow: \/$/m)
    expect(robots).not.toMatch(/^Allow:/m)
  })

  it('appends the header block to an existing _headers without losing what was there', () => {
    const existing = '/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n'
    const out = noindexFiles(existing)._headers
    expect(out.startsWith(existing.trimEnd())).toBe(true)
    expect(out.endsWith(NOINDEX_HEADERS_BLOCK)).toBe(true)
    // One blank line between the two blocks — Cloudflare's parser wants rules separated.
    expect(out).toContain('immutable\n\n/*\n')
  })

  it('still writes _headers when there was none to append to', () => {
    expect(noindexFiles('')._headers).toBe(NOINDEX_HEADERS_BLOCK)
  })
})

describe('crawlerPolicyPlugin', () => {
  let root: string
  let dist: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'crawler-policy-'))
    dist = join(root, 'dist')
    mkdirSync(dist)
    // What Vite's public/ copy leaves behind before closeBundle runs: prod's Allow.
    writeFileSync(join(dist, 'robots.txt'), 'User-agent: *\nAllow: /\n')
    writeFileSync(join(dist, '_headers'), '/*\n  X-Frame-Options: DENY\n')
  })
  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  type Hooks = {
    configResolved: (c: unknown) => void
    transformIndexHtml: (html: string) => string
    closeBundle: () => void
  }
  const hooks = (mode: string) => crawlerPolicyPlugin(mode) as unknown as Hooks

  it('non-indexable: rewrites robots.txt, appends the header, injects the meta', () => {
    const p = hooks('dev')
    p.configResolved({ root, build: { outDir: 'dist' } })
    expect(p.transformIndexHtml(HTML)).toContain(NOINDEX_META)
    p.closeBundle()
    expect(readFileSync(join(dist, 'robots.txt'), 'utf8')).toMatch(/^Disallow: \/$/m)
    expect(readFileSync(join(dist, 'robots.txt'), 'utf8')).not.toMatch(/^Allow:/m)
    const headers = readFileSync(join(dist, '_headers'), 'utf8')
    expect(headers).toContain('X-Frame-Options: DENY')
    expect(headers).toContain('X-Robots-Tag: noindex, nofollow')
  })

  it('indexable: touches nothing — prod keeps public/robots.txt as the single source', () => {
    const p = hooks('production')
    p.configResolved({ root, build: { outDir: 'dist' } })
    expect(p.transformIndexHtml(HTML)).toBe(HTML)
    p.closeBundle()
    expect(readFileSync(join(dist, 'robots.txt'), 'utf8')).toMatch(/^Allow: \/$/m)
    expect(readFileSync(join(dist, '_headers'), 'utf8')).not.toContain('X-Robots-Tag')
  })

  it('only runs at build time, so `vite dev` is untouched', () => {
    expect(crawlerPolicyPlugin('dev').apply).toBe('build')
  })
})
