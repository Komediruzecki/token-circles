import { describe, expect, it } from 'vitest'
import { parseDecimalInput } from '../decimalInput'

describe('parseDecimalInput', () => {
  it.each([
    ['3649,51', 3649.51],
    ['3649.51', 3649.51],
    ['-0,50', -0.5],
    ['-0.50', -0.5],
    [',75', 0.75],
    ['.75', 0.75],
    ['120.', 120],
    [' 42,25 ', 42.25],
  ])('parses %s as %s', (input, expected) => {
    expect(parseDecimalInput(input)).toBe(expected)
  })

  it.each(['', '-', '.', ',', '1,234.56', '1.234,56', '1-2', '--2', 'hello'])(
    'rejects ambiguous or malformed value %s',
    (input) => {
      expect(parseDecimalInput(input)).toBeNull()
    }
  )
})
