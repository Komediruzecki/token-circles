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

  it('says nothing when nothing was refused', () => {
    expect(refusedMessages([])).toEqual([])
  })
})
