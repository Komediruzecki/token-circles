/**
 * The setup wizard's "Name your space" and "Create your first account" steps, in both storage
 * modes: a blank name is marked at the name and nothing is sent, a name another profile has is
 * marked at the name in the runtime's words, and an account in another currency than the first is
 * refused in the step's notice.
 *
 * Both steps toasted a caught error's own words ("Validation failed", "HTTP 409") with nothing
 * marked, and a blank name kept the button disabled without saying why. Now each checks with the
 * rules both runtimes run (shared/profileSchema.ts, shared/accountSchema.ts) before it sends
 * anything.
 *
 * Signed in, the wizard opens over a new profile of the case's own, which it renames. Local-first,
 * it opens over an empty browser, where it creates the profile.
 *
 * Every case runs signed in (the Worker) and local-first (the IndexedDB router). Pull requests
 * run the `@smoke` one; main runs them all.
 */
import { expect, test } from '@playwright/test'
import { E2E_PROFILE } from './e2e-constants'
import {
  caseStamp,
  elsewhere,
  errorToasts,
  MODES,
  REFUSAL_LOGGED,
  newCloudProfile,
  sweepProfiles,
  toasts,
  watchErrors,
  watchWrites,
} from './form-errors-helpers'
import { E2E_BASE, gotoServerlessZeroState } from './test-helpers'
import type { Mode } from './form-errors-helpers'
import type { Page } from '@playwright/test'

/** Opens the wizard over a profile with nothing in it, or over an empty local-first browser. */
async function openWizard(page: Page, mode: Mode, profile: string): Promise<void> {
  if (mode.name === 'local-first') {
    await gotoServerlessZeroState(page, 'dashboard', 'onboarding-wizard')
    return
  }
  const id = await newCloudProfile(page, profile)
  await page.addInitScript((pid) => {
    localStorage.setItem('finance_storage_mode', 'self-hosted')
    localStorage.setItem('currentProfileId', String(pid))
    localStorage.setItem('selectedProfileIds', JSON.stringify([pid]))
    // Once only: a reload must not erase a decision the case made.
    if (!sessionStorage.getItem('onb_spec_cleared')) {
      sessionStorage.setItem('onb_spec_cleared', '1')
      localStorage.removeItem('finance_onboarding')
    }
  }, id)
  await page.goto(`${E2E_BASE}/#dashboard`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  await expect(page.getByTestId('onboarding-wizard')).toBeVisible({ timeout: 30_000 })
}

for (const mode of MODES) {
  test.describe(`the setup wizard's forms, ${mode.name}`, () => {
    /** In the name of every profile a case makes, so the sweep can find it. */
    let stamp = ''

    test.beforeEach(() => {
      test.setTimeout(120_000)
      stamp = caseStamp()
    })

    test.afterEach(async ({ page }) => {
      await sweepProfiles(page, mode, stamp)
    })

    test('a blank or taken name is marked at the name, a blank account name at the account, and another currency in the notice @smoke', async ({
      page,
    }) => {
      const errors = watchErrors(page, REFUSAL_LOGGED)
      await openWizard(page, mode, `zz-onb-${stamp}`)
      const next = page.getByTestId('onboarding-next')
      await expect(page.getByTestId('onboarding-step-welcome')).toBeVisible()
      await next.click()

      // Your space: blank, then a name another profile has.
      const spaceStep = page.getByTestId('onboarding-step-space')
      const name = page.getByTestId('onboarding-profile-name')
      await expect(spaceStep).toBeVisible()
      await expect(name).not.toHaveValue('')
      const profileWrites = watchWrites(page, /^\/api\/profiles/)

      await name.fill('')
      await next.click()

      await expect(name).toHaveAttribute('aria-invalid', 'true')
      await expect(name).toHaveAccessibleDescription('Give the profile a name.')
      await expect(name).toBeFocused()
      await expect(spaceStep).toBeVisible()
      expect(profileWrites).toEqual([])
      await expect(errorToasts(page)).toHaveCount(0)

      // Signed in, the account's fixture profile has the name; local-first, one added in another
      // tab. The page knows of neither: the runtime is the one that refuses it.
      let taken = E2E_PROFILE
      if (mode.name === 'local-first') {
        taken = `zz-taken-${stamp}`
        await elsewhere(page, mode, 'POST', '/api/profiles', 0, { name: taken })
      }
      await name.fill(taken.toUpperCase())
      await next.click()

      await expect(name).toHaveAccessibleDescription(
        `You already have a profile called "${taken}". Choose another name.`
      )
      await expect(name).toBeFocused()
      await expect(spaceStep).toBeVisible()
      await expect(errorToasts(page)).toHaveCount(0)

      await name.fill(`zz-onb-${stamp}-home`)
      await page.getByTestId('onboarding-currency').selectOption('EUR')
      await next.click()

      // Your first account: blank, then one in euros, then one in US dollars.
      await expect(page.getByTestId('onboarding-step-account')).toBeVisible()
      const accountName = page.getByTestId('onboarding-account-name')
      const create = page.getByTestId('onboarding-account-create')
      const chips = page.getByTestId('onboarding-account-chip')
      const accountWrites = watchWrites(page, /^\/api\/accounts/)

      await create.click()

      await expect(accountName).toHaveAttribute('aria-invalid', 'true')
      await expect(accountName).toHaveAccessibleDescription('Give the account a name.')
      await expect(accountName).toBeFocused()
      expect(accountWrites).toEqual([])
      await expect(errorToasts(page)).toHaveCount(0)

      await accountName.fill(`zz-account-${stamp}`)
      await page.getByTestId('onboarding-account-balance').fill('1500')
      await create.click()
      await expect(toasts(page).getByText(`Account "zz-account-${stamp}" created`)).toBeVisible()
      // The step lists the profile's accounts once it has read them again.
      await expect(chips).toHaveCount(1, { timeout: 15_000 })

      await accountName.fill(`zz-dollars-${stamp}`)
      await page.getByTestId('onboarding-account-currency').selectOption('USD')
      await create.click()

      await expect(page.getByTestId('onboarding-account-notice')).toHaveText(
        'Account balances use EUR. Change the base currency in Settings before adding financial data.'
      )
      await expect(chips).toHaveCount(1)
      await expect(errorToasts(page)).toHaveCount(0)
      expect(errors).toEqual([])
    })
  })
}
