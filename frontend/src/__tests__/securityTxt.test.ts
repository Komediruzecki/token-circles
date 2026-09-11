/**
 * public/.well-known/security.txt (RFC 9116). Its Expires date is a real deadline — a file past it
 * tells a researcher the contact may be stale — so this fails a month ahead, while there is still
 * time to move it.
 */
/* eslint-disable security/detect-non-literal-fs-filename -- the one path is this repo's own file. */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const FILE = resolve(__dirname, '../../public/.well-known/security.txt')
const DAY = 86_400_000

/** Field name (lowercased) to every value it has, comments skipped. */
function fields(text: string): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '' || line.startsWith('#')) continue
    const colon = line.indexOf(':')
    const name = line.slice(0, colon).trim().toLowerCase()
    out.set(name, [...(out.get(name) ?? []), line.slice(colon + 1).trim()])
  }
  return out
}

describe('security.txt', () => {
  const found = fields(readFileSync(FILE, 'utf8'))

  it('has the fields RFC 9116 requires, each as often as it may appear', () => {
    const contacts = found.get('contact') ?? []
    expect(contacts.length).toBeGreaterThan(0)
    for (const contact of contacts) expect(contact).toMatch(/^(https:\/\/|mailto:)/)
    expect(found.get('expires')).toHaveLength(1)
    expect(found.get('canonical')).toContain('https://tokencircles.com/.well-known/security.txt')
    expect(found.get('preferred-languages')).toEqual(['en'])
  })

  it('does not expire within the next 30 days, nor lie more than a year out', () => {
    const [expires] = found.get('expires') ?? ['']
    const daysLeft = (Date.parse(expires) - Date.now()) / DAY
    expect(daysLeft, `security.txt expires ${expires}: move Expires forward`).toBeGreaterThan(30)
    expect(daysLeft, 'RFC 9116 recommends an Expires under a year away').toBeLessThanOrEqual(366)
  })
})
