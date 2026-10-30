/**
 * The setup wizard's "Name your space" step saves the space, then the answers to its two
 * questions (core/guidanceAnswers.ts). A failure to save the answers once the space is saved does
 * not hold the step: it moves on and says the space is saved and where the answers can be given.
 * It used to say "Couldn't save your space. Try again." about a space that was saved.
 *
 * The production build asks neither question while the benchmarks are held back
 * (core/guidanceGate.ts), and saves no answer.
 *
 * Run against the real local-first router on fake-indexeddb, with the answers' save mocked.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { setCurrentProfile, setProfiles } from '../../../core/appStore'
import { __resetDataVersionsForTest } from '../../../core/dataVersions'
import {
  onboardingOpen,
  onboardingStep,
  setOnboardingOwner,
  skipOnboarding,
  startOnboarding,
} from '../../../core/onboardingStore'
import { getDB } from '../../../core/storage/idb'
import { removeToast, toasts } from '../../../core/toastStore'

const saveAnswers = vi.fn()
vi.mock('../../../core/guidanceAnswers', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  saveAnswers: (...args: unknown[]) => saveAnswers(...args),
}))

let host: HTMLDivElement
let dispose: (() => void) | undefined

beforeAll(async () => {
  await Promise.all([import('../OnboardingWizard'), import('../../../core/storage/localApiRouter')])
}, 120_000)

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('finance_storage_mode', 'serverless')
  localStorage.setItem('currentProfileId', '1')
  localStorage.setItem('localCurrency', 'EUR')
  __resetDataVersionsForTest()
  setOnboardingOwner('local')
  const db = await getDB()
  for (const store of Array.from(db.objectStoreNames)) await db.clear(store)
  await db.add('profiles', { id: 1, name: 'Personal', created_at: '2026-01-01T00:00:00.000Z' })
  setProfiles([{ id: 1, name: 'Personal' }] as never)
  setCurrentProfile({ id: 1, name: 'Personal' } as never)
  for (const toast of toasts()) removeToast(toast.id)
  saveAnswers.mockReset()
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(() => {
  vi.unstubAllEnvs()
  dispose?.()
  dispose = undefined
  host.remove()
  if (onboardingOpen()) skipOnboarding()
  setOnboardingOwner(null)
  setCurrentProfile(null)
})

it('moves on with the space saved when its answers fail to save, and says where to give them', async () => {
  saveAnswers.mockRejectedValue(new Error('offline'))
  startOnboarding('space')
  const { OnboardingWizard, SPACE_ANSWERS_NOT_SAVED } = await import('../OnboardingWizard')
  dispose = render(() => <OnboardingWizard selectProfiles={() => {}} />, host)

  const name = await vi.waitFor(() => {
    const input = host.querySelector<HTMLInputElement>('[data-test-id="onboarding-profile-name"]')
    expect(input).not.toBeNull()
    return input!
  })
  name.value = 'Our flat'
  name.dispatchEvent(new Event('input', { bubbles: true }))
  host
    .querySelector<HTMLFormElement>('[data-test-id="onboarding-space-form"]')!
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))

  await vi.waitFor(() => {
    expect(onboardingStep()).not.toBe('space')
  })
  expect(saveAnswers).toHaveBeenCalledTimes(1)
  // The space is saved: the profile has its new name.
  expect(await (await getDB()).get('profiles', 1)).toMatchObject({ name: 'Our flat' })
  expect(toasts().map((t) => [t.message, t.type])).toContainEqual([
    SPACE_ANSWERS_NOT_SAVED,
    'warning',
  ])
  expect(SPACE_ANSWERS_NOT_SAVED).toMatch(/space is saved/)
  expect(SPACE_ANSWERS_NOT_SAVED).toMatch(/Settings, under About this space/)
  expect(host.querySelector('[data-test-id="onboarding-space-notice"]')?.textContent ?? '').toBe('')
})

it('asks neither question in the production build, and saves no answer', async () => {
  vi.stubEnv('MODE', 'production')
  startOnboarding('space')
  const { OnboardingWizard } = await import('../OnboardingWizard')
  dispose = render(() => <OnboardingWizard selectProfiles={() => {}} />, host)

  const name = await vi.waitFor(() => {
    const input = host.querySelector<HTMLInputElement>('[data-test-id="onboarding-profile-name"]')
    expect(input).not.toBeNull()
    return input!
  })
  expect(host.querySelector('[data-test-id="onboarding-space-questions-lead"]')).toBeNull()
  expect(host.querySelector('[data-test-id="onboarding-space-region"]')).toBeNull()
  expect(host.querySelector('[data-test-id="onboarding-space-household"]')).toBeNull()
  expect(host.textContent).not.toContain('Where do you live?')

  name.value = 'Our flat'
  name.dispatchEvent(new Event('input', { bubbles: true }))
  host
    .querySelector<HTMLFormElement>('[data-test-id="onboarding-space-form"]')!
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  await vi.waitFor(() => {
    expect(onboardingStep()).not.toBe('space')
  })
  expect(await (await getDB()).get('profiles', 1)).toMatchObject({ name: 'Our flat' })
  // No `skipped` region either: the question was never asked.
  expect(saveAnswers).not.toHaveBeenCalled()
  expect(await (await getDB()).get('settings', 'guidance:1')).toBeUndefined()
})

it('asks both in every other build', async () => {
  vi.stubEnv('MODE', 'dev')
  startOnboarding('space')
  const { OnboardingWizard } = await import('../OnboardingWizard')
  dispose = render(() => <OnboardingWizard selectProfiles={() => {}} />, host)
  await vi.waitFor(() => {
    expect(host.querySelector('[data-test-id="onboarding-space-region"]')).not.toBeNull()
  })
  expect(host.querySelector('[data-test-id="onboarding-space-household"]')).not.toBeNull()
})
