import { describe, expect, it } from 'vitest'
import { accountActivityPresentation } from '../accountActivity'

describe('accountActivityPresentation', () => {
  it.each([
    ['income', { tone: 'income', prefix: '+' }],
    ['expense', { tone: 'expense', prefix: '-' }],
    ['transfer', { tone: 'transfer', prefix: '±' }],
  ] as const)('renders %s with the correct semantic treatment', (type, expected) => {
    expect(accountActivityPresentation(type)).toEqual(expected)
  })
})
