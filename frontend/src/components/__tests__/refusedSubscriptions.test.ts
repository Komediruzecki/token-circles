import { describe, expect, it } from 'vitest'
import { ApiError, OFFLINE } from '../../core/apiError'
import { refusedMessages } from '../refusedSubscriptions'

describe('refusedMessages', () => {
  it('says each reason once, with every subscription refused for it', () => {
    const offline = () => new ApiError(0, OFFLINE)
    expect(
      refusedMessages([
        { name: 'Netflix', error: offline() },
        { name: 'Spotify', error: new ApiError(400, 'Enter an amount more than zero.') },
        { name: 'Disney+', error: offline() },
        { name: 'Max', error: offline() },
      ])
    ).toEqual([
      `Couldn't add "Netflix", "Disney+" or "Max". ${OFFLINE}`,
      `Couldn't add "Spotify". Enter an amount more than zero.`,
    ])
  })

  it('says what an error without words for people did', () => {
    expect(refusedMessages([{ name: 'Netflix', error: new TypeError('x is undefined') }])).toEqual([
      `Couldn't add "Netflix". That didn't work. Try again.`,
    ])
  })

  it("says a host's own words in place of the refusal's, about one or several", () => {
    const refused = new ApiError(400, 'Choose a category from the list, or leave it blank.')
    const instead = (it: 'it' | 'them') => `Add ${it} from Bills.`
    expect(
      refusedMessages([
        { name: 'Netflix', error: refused, instead },
        { name: 'Spotify', error: refused, instead },
        { name: 'Max', error: new ApiError(400, 'Enter an amount more than zero.') },
      ])
    ).toEqual([
      `Couldn't add "Netflix" or "Spotify". Add them from Bills.`,
      `Couldn't add "Max". Enter an amount more than zero.`,
    ])
    expect(refusedMessages([{ name: 'Netflix', error: refused, instead }])).toEqual([
      `Couldn't add "Netflix". Add it from Bills.`,
    ])
  })

  it('says nothing when nothing was refused', () => {
    expect(refusedMessages([])).toEqual([])
  })
})
