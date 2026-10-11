/**
 * Saving the guidance answers (core/guidanceAnswers.ts). Every save re-reads the record just
 * before it writes and changes only the fields answered, so an answer given meanwhile in another
 * tab, or a field only a newer build knows, is kept; saves made in one tab run one after another.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

/** The settings as the server holds them: one object, merged by every write, like the real one. */
let stored: Record<string, unknown> = {}
const writes: { data: Record<string, unknown>; as: string }[] = []
const env = { mode: 'serverless' as 'serverless' | 'self-hosted' }
/** A turn of the event loop, as a request takes. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

vi.mock('../api', () => ({
  api: {
    getSettings: vi.fn(async () => {
      await tick()
      return { ...stored }
    }),
    updateSettings: vi.fn(async (data: Record<string, unknown>) => {
      await tick()
      // In cloud mode the write lands on the profile active when it is sent (X-Profile-Id).
      writes.push({ data, as: localStorage.getItem('currentProfileId') ?? '1' })
      stored = { ...stored, ...data }
    }),
  },
}))
vi.mock('../storage/storageFactory', () => ({ getStorageMode: () => env.mode }))

import { api } from '../api'
import {
  answersKey,
  AnswersProfileChangedError,
  loadAnswers,
  saveAnswers,
} from '../guidanceAnswers'

const recordOf = (key: string) => JSON.parse(String(stored[key]))
/** The mocked client's members as plain mocks, to re-stub once. */
const apiMock = api as unknown as Record<'getSettings' | 'updateSettings', Mock>

beforeEach(() => {
  stored = {}
  writes.length = 0
  env.mode = 'serverless'
  localStorage.clear()
  localStorage.setItem('currentProfileId', '1')
})

describe('where the answers are kept', () => {
  it("names the profile in local-first's key, and uses the plain key in the cloud", () => {
    expect(answersKey(4)).toBe('guidance:4')
    env.mode = 'self-hosted'
    expect(answersKey(4)).toBe('guidance')
  })
})

describe.each(['serverless', 'self-hosted'] as const)('a save, in %s mode', (mode) => {
  beforeEach(() => {
    env.mode = mode
  })

  it('keeps an answer another tab saved after this one read the answers', async () => {
    const key = answersKey(1)
    expect(await loadAnswers()).toEqual({})
    // Another tab answers the household question.
    stored[key] = JSON.stringify({ adults: 2, children: 1 })

    expect(await saveAnswers({ region: 'DE' })).toEqual({ region: 'DE', adults: 2, children: 1 })
    expect(recordOf(key)).toEqual({ adults: 2, children: 1, region: 'DE' })
  })

  it('keeps both of two saves started together in this tab', async () => {
    const both = await Promise.all([saveAnswers({ region: 'UK' }), saveAnswers({ adults: 1 })])
    expect(both[1]).toEqual({ region: 'UK', adults: 1 })
    expect(recordOf(answersKey(1))).toEqual({ region: 'UK', adults: 1 })
    expect(writes).toHaveLength(2)
  })

  it('keeps the fields and values only a newer build reads', async () => {
    const key = answersKey(1)
    stored[key] = JSON.stringify({ region: 'AT', tenure: 'own_mortgage', support: { payees: [] } })
    expect(await loadAnswers()).toEqual({})

    expect(await saveAnswers({ children: 0 })).toEqual({ children: 0 })
    expect(recordOf(key)).toEqual({
      region: 'AT',
      tenure: 'own_mortgage',
      support: { payees: [] },
      children: 0,
    })
  })

  it('clears an answer set to null, as Ask again does', async () => {
    stored[answersKey(1)] = JSON.stringify({ region: 'US', adults: 2 })
    expect(await saveAnswers({ region: null })).toEqual({ adults: 2 })
    expect(recordOf(answersKey(1))).toEqual({ adults: 2 })
  })

  it('goes on to the next save after one fails', async () => {
    apiMock.updateSettings.mockRejectedValueOnce(new Error('offline'))
    await expect(saveAnswers({ region: 'HR' })).rejects.toThrow('offline')
    expect(await saveAnswers({ adults: 3 })).toEqual({ adults: 3 })
  })
})

describe('a save for a profile that is not the active one', () => {
  it('is written under that profile in local-first, whichever is active', async () => {
    localStorage.setItem('currentProfileId', '2')
    await saveAnswers({ region: 'HR' }, 1)
    expect(recordOf('guidance:1')).toEqual({ region: 'HR' })
    expect(stored['guidance:2']).toBeUndefined()
  })

  it('is refused in the cloud, where it would land on the active profile', async () => {
    env.mode = 'self-hosted'
    localStorage.setItem('currentProfileId', '2')
    await expect(saveAnswers({ region: 'HR' }, 1)).rejects.toBeInstanceOf(
      AnswersProfileChangedError
    )
    await expect(loadAnswers(1)).rejects.toBeInstanceOf(AnswersProfileChangedError)
    expect(writes).toEqual([])
  })

  it('is refused in the cloud when the profile changes while the record is read', async () => {
    env.mode = 'self-hosted'
    apiMock.getSettings.mockImplementationOnce(async () => {
      localStorage.setItem('currentProfileId', '2')
      await tick()
      return { ...stored }
    })
    await expect(saveAnswers({ region: 'HR' })).rejects.toBeInstanceOf(AnswersProfileChangedError)
    expect(writes).toEqual([])
  })
})
