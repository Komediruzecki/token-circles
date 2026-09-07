/**
 * Crawler policy for a build: indexable, or not.
 *
 * Only the production build of the app is a page anyone should find in a search engine. The dev
 * deployment (`--mode dev`, dev.tokencircles.com) is a full copy of prod on another host, and it
 * was shipping prod's `robots.txt` — `Allow: /` plus prod's sitemap — so it was a second copy of
 * the app for Google to rank, dilute the first with, or serve to someone who then signs in to the
 * wrong environment. Search Console noticed the API hosts before anyone here did.
 *
 * Three signals, all three because they cover different consumers:
 *   - `<meta name="robots">`  — the document itself, honoured by every crawler that renders it.
 *   - `robots.txt`            — the crawl gate; also what a human checks first.
 *   - `X-Robots-Tag` header   — covers every non-HTML asset, which the meta tag cannot.
 *
 * Nothing is emitted for an indexable build, so prod's `public/robots.txt` stays the single
 * source of truth there.
 */
/* eslint-disable security/detect-non-literal-fs-filename -- every path is Vite's resolved outDir
   joined with a literal file name; nothing here comes from outside the build. */
import fs from 'node:fs'
import path from 'node:path'
import type { Plugin } from 'vite'

export const NOINDEX_META = '<meta name="robots" content="noindex, nofollow" />'

export const NOINDEX_ROBOTS_TXT =
  '# Not the product. This is a non-production deployment of Token Circles — the app lives at\n' +
  '# https://tokencircles.com/. Nothing here should be indexed.\n' +
  'User-agent: *\n' +
  'Disallow: /\n'

export const NOINDEX_HEADERS_BLOCK = '/*\n  X-Robots-Tag: noindex, nofollow\n'

/** The files a non-indexable build writes into `outDir`, keyed by name. */
export function noindexFiles(existingHeaders: string): Record<string, string> {
  const headers = existingHeaders.trimEnd()
  return {
    'robots.txt': NOINDEX_ROBOTS_TXT,
    _headers: headers ? `${headers}\n\n${NOINDEX_HEADERS_BLOCK}` : NOINDEX_HEADERS_BLOCK,
  }
}

/** Inject the noindex meta tag directly after `<head>`; a no-op if the tag is already there. */
export function withNoindexMeta(html: string): string {
  if (html.includes('name="robots"')) return html
  return html.replace('<head>', `<head>\n    ${NOINDEX_META}`)
}

/**
 * Only the production build is a page anyone should find. `--mode dev` (the dev deploy and PR
 * previews), `development` (`vite dev`) and anything else are not the product.
 */
export const isIndexable = (mode: string): boolean => mode === 'production'

export function crawlerPolicyPlugin(mode: string): Plugin {
  const indexable = isIndexable(mode)
  let outDir = ''
  return {
    name: 'crawler-policy',
    apply: 'build',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir)
    },
    transformIndexHtml(html) {
      return indexable ? html : withNoindexMeta(html)
    },
    // closeBundle, not writeBundle: it is the last hook to run, after Vite has copied public/
    // into outDir — and public/ holds prod's robots.txt, which is exactly the file this must win
    // over. An earlier hook would write the Disallow and then watch the Allow land on top of it.
    closeBundle() {
      if (indexable || !outDir) return
      const headersPath = path.join(outDir, '_headers')
      const existing = fs.existsSync(headersPath) ? fs.readFileSync(headersPath, 'utf8') : ''
      for (const [name, body] of Object.entries(noindexFiles(existing))) {
        fs.writeFileSync(path.join(outDir, name), body)
      }
    },
  }
}
