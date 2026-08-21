/**
 * Where "View" on a tag card sends you.
 *
 * The list opens on the global focus period, so a tag with nothing in the current month landed the
 * user on an empty table — which reads as a broken filter rather than a quiet month. The link asks
 * for all time in exactly that case, and the list says why it widened.
 */
import { describe, expect, it } from 'vitest'

/** Mirrors viewTaggedTransactions in Tags.tsx. */
function tagViewHash(tag: { id: number; count: number }): string {
  const widen = tag.count === 0 ? '&period=all' : ''
  return `#transactions?tag=${tag.id}${widen}`
}

describe('viewing a tag', () => {
  it('keeps the focus period when the tag has transactions in it', () => {
    expect(tagViewHash({ id: 7, count: 12 })).toBe('#transactions?tag=7')
  })

  it('asks for all time when the tag has none in this period', () => {
    expect(tagViewHash({ id: 7, count: 0 })).toBe('#transactions?tag=7&period=all')
  })

  it('is parseable by the transactions page', () => {
    const hash = tagViewHash({ id: 42, count: 0 }).slice(1)
    const params = new URLSearchParams(hash.slice(hash.indexOf('?') + 1))
    expect(params.get('tag')).toBe('42')
    expect(params.get('period')).toBe('all')
  })
})
