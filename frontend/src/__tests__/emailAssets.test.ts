/**
 * The images Token Circles mails load from the app: frontend/public/email/, served from the app's
 * origin (worker/src/emailTemplates.ts builds the URLs).
 *
 * A mail in an inbox points at its image for as long as the mail is kept, so a file there is never
 * overwritten or removed: new art gets a new versioned name. That is also what makes it safe to
 * cache every file under /email/ for a year as immutable.
 */
/* eslint-disable security/detect-non-literal-fs-filename -- every path is joined from this file's
   folder and a fixed name, or a name the templates file itself spells out */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PUBLIC = join(import.meta.dirname, '..', '..', 'public')
const EMAIL = join(PUBLIC, 'email')
const TEMPLATES = join(import.meta.dirname, '..', '..', '..', 'worker', 'src', 'emailTemplates.ts')

/** The header rules of public/_headers, by path pattern: Cloudflare's format, a path then its lines. */
function headerRules(source: string): Map<string, string[]> {
  const rules = new Map<string, string[]>()
  let path: string | null = null
  for (const line of source.split('\n')) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue
    if (!/^\s/.test(line)) {
      path = line.trim()
      rules.set(path, [])
    } else if (path !== null) {
      rules.get(path)!.push(line.trim())
    }
  }
  return rules
}

describe('the mail images', () => {
  it('include the engraved art under versioned names, and the orbit GIF older mails point at', () => {
    for (const file of [
      'hero-engraved-night-v1.jpg',
      'banner-engraved-night-v1.jpg',
      'orbit.gif',
    ]) {
      expect(existsSync(join(EMAIL, file)), file).toBe(true)
    }
    // Light enough for a mail: 600 px wide shown, 2x for sharp screens.
    expect(statSync(join(EMAIL, 'hero-engraved-night-v1.jpg')).size).toBeLessThan(120 * 1024)
    expect(statSync(join(EMAIL, 'banner-engraved-night-v1.jpg')).size).toBeLessThan(80 * 1024)
  })

  it('are cached for a year as immutable', () => {
    const rules = headerRules(readFileSync(join(PUBLIC, '_headers'), 'utf8'))
    expect(rules.get('/email/*')).toContain('Cache-Control: public, max-age=31536000, immutable')
  })

  it('include every file a mail template links to', () => {
    const source = readFileSync(TEMPLATES, 'utf8')
    const linked = new Set(
      [...source.matchAll(/\/email\/([\w.-]+\.(?:jpg|png|gif))/g)].map((m) => m[1])
    )
    expect(linked.size).toBeGreaterThan(0)
    for (const file of linked) expect(existsSync(join(EMAIL, file!)), file).toBe(true)
  })
})
