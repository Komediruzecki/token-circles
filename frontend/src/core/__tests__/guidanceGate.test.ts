/**
 * The benchmarks gate (core/guidanceGate.ts): the production build holds the benchmarks back
 * unless VITE_ENABLE_BENCHMARKS=true; dev, previews (`--mode dev`), `pnpm dev` and the E2E server
 * (`development`) show them.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { benchmarksShown } from '../guidanceGate'

afterEach(() => {
  vi.unstubAllEnvs()
})

it('holds the benchmarks back in the production build', () => {
  vi.stubEnv('MODE', 'production')
  vi.stubEnv('VITE_ENABLE_BENCHMARKS', '')
  expect(benchmarksShown()).toBe(false)
  vi.stubEnv('VITE_ENABLE_BENCHMARKS', 'false')
  expect(benchmarksShown()).toBe(false)
})

it('shows them in production when VITE_ENABLE_BENCHMARKS is true', () => {
  vi.stubEnv('MODE', 'production')
  vi.stubEnv('VITE_ENABLE_BENCHMARKS', 'true')
  expect(benchmarksShown()).toBe(true)
})

it('shows them on dev, previews, local builds and the E2E server', () => {
  for (const mode of ['dev', 'development', 'test']) {
    vi.stubEnv('MODE', mode)
    expect(benchmarksShown()).toBe(true)
  }
})

/**
 * The copy the gate holds back is compiled out where a build closes it: vite.config.ts defines
 * __BENCHMARKS_SHOWN__ by the gate's own test, and a production build's minifier drops what it
 * guards (release s17 greps the build for it). Here the constant is a global the modules read
 * when they load.
 */
describe('the copy it holds back', () => {
  const load = async (shown: boolean | undefined) => {
    vi.unstubAllGlobals()
    if (shown !== undefined) vi.stubGlobal('__BENCHMARKS_SHOWN__', shown)
    vi.resetModules()
    return {
      questions: await import('../../../../shared/guidance/questions'),
      words: await import('../../components/guidance/regionWords'),
    }
  }
  const germany = { region: 'DE', reason: 'answer', via: null } as const

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('is left out where the build closes the gate', async () => {
    const { questions, words } = await load(false)
    expect(questions.FREE_MONEY_QUESTIONS).toEqual({})
    expect(questions.freeMoneyQuestion('DE')).toBeNull()
    expect(questions.TENURE_QUESTION).toBe('')
    expect(questions.TENURE_HINT).toBe('')
    expect(questions.tenureOptions('UK')).toEqual([])
    expect(words.REGION_QUESTION).toBe('')
    expect(words.REGION_WHY).toBe('')
    expect(words.HOUSEHOLD_QUESTION).toBe('')
    expect(words.REGION_CHOICES).toEqual([])
    expect(words.regionReasonText(germany)).toBe('')
    expect(words.householdText(1, 0)).toBe('')
    expect(words.SPACE_QUESTIONS_LEAD).toBe('')
    expect(words.COMPARE_TITLE).toBe('')
    // What every build asks stays.
    expect(questions.CARD_QUESTION).toBe('Do you carry a balance on a credit card or overdraft?')
  })

  it('is there where the build opens the gate, and where nothing defines it (tests, the Worker)', async () => {
    for (const shown of [true, undefined]) {
      const { questions, words } = await load(shown)
      expect(questions.freeMoneyQuestion('DE')?.question, String(shown)).toContain(
        'Entgeltumwandlung'
      )
      expect(questions.TENURE_QUESTION).toBe('How do you live?')
      expect(questions.tenureOptions('UK')).toHaveLength(5)
      expect(words.REGION_QUESTION).toBe('Where do you live?')
      expect(words.REGION_CHOICES).toHaveLength(6)
      expect(words.regionReasonText(germany)).toBe('Compared with Germany, from your answer.')
      expect(words.householdText(1, 0)).toBe('1 adult, no children.')
      expect(words.SPACE_QUESTIONS_LEAD).toBe(
        'Both are optional. They pick the official figures we compare your numbers with.'
      )
      expect(words.COMPARE_TITLE).toBe('How you compare')
    }
  })
})
