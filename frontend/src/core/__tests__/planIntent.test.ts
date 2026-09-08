import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearPlanIntent, parsePlanParam, storedPlanIntent } from '../planIntent'

beforeEach(() => {
  clearPlanIntent()
})
afterEach(() => {
  vi.restoreAllMocks()
  clearPlanIntent()
})

describe('parsePlanParam', () => {
  const loc = (search: string, hash = '') => ({ search, hash })

  it('reads a paid tier from the query string', () => {
    expect(parsePlanParam(loc('?plan=advanced'))).toBe('advanced')
    expect(parsePlanParam(loc('?utm=x&plan=basic'))).toBe('basic')
    expect(parsePlanParam(loc('?plan=ULTIMATE'))).toBe('ultimate')
  })

  it('reads it from the hash too, plain or after a page', () => {
    expect(parsePlanParam(loc('', '#plan=advanced'))).toBe('advanced')
    expect(parsePlanParam(loc('', '#settings?plan=basic'))).toBe('basic')
  })

  it('ignores anything that is not a paid tier', () => {
    // `free` deliberately included: it needs no billing page, it is what an account already is.
    for (const v of ['', 'free', 'gold', 'advanced-plus', '../advanced']) {
      expect(parsePlanParam(loc(`?plan=${encodeURIComponent(v)}`))).toBeNull()
    }
    expect(parsePlanParam(loc('?other=advanced'))).toBeNull()
  })
})

describe('the stored intent', () => {
  it('round-trips and clears', () => {
    localStorage.setItem('plan_intent', 'ultimate')
    expect(storedPlanIntent()).toBe('ultimate')
    clearPlanIntent()
    expect(storedPlanIntent()).toBeNull()
  })

  it('refuses a value that is not a tier, however it got there', () => {
    localStorage.setItem('plan_intent', 'enterprise')
    expect(storedPlanIntent()).toBeNull()
  })

  it('survives storage throwing rather than taking the app down with it', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('private mode')
    })
    expect(storedPlanIntent()).toBeNull()
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('private mode')
    })
    expect(() => {
      clearPlanIntent()
    }).not.toThrow()
  })
})
