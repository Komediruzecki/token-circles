import { describe, expect, it } from 'vitest'
import { importRowLabel } from '../../../../shared/importRowLabel'

describe('importRowLabel', () => {
  it('joins the date and description', () => {
    expect(importRowLabel('2026-05-04', 'Top-up by *1111')).toBe('2026-05-04 · Top-up by *1111')
  })

  it('keeps only the date part of a timestamp', () => {
    expect(importRowLabel('2026-05-04T10:30:00Z', 'Kaufland')).toBe('2026-05-04 · Kaufland')
  })

  it('degrades to whichever half the row has', () => {
    expect(importRowLabel('2026-05-04', '')).toBe('2026-05-04')
    expect(importRowLabel('', 'Kaufland')).toBe('Kaufland')
    expect(importRowLabel(null, undefined)).toBe('')
  })

  it('truncates a long description so one bad row cannot flood the panel', () => {
    const label = importRowLabel('2026-05-04', 'x'.repeat(200))
    expect(label.length).toBeLessThan(80)
    expect(label.endsWith('…')).toBe(true)
  })

  it('trims surrounding whitespace from sheet cells', () => {
    expect(importRowLabel('  2026-05-04  ', '  Kaufland  ')).toBe('2026-05-04 · Kaufland')
  })
})
