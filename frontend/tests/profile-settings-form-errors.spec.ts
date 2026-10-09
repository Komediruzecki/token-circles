/**
 * Profiles and Settings, in both storage modes: a profile is created from the profile menu,
 * renamed in Settings' household view and deleted from the Danger Zone, and the base currency is
 * changed. A name or a currency the form or the runtime refuses is marked under its field, in its
 * own words, with no toast of an error.
 *
 * The Create Profile dialog put the runtime's sentence in a box above its buttons, Settings' rename
 * reloaded the page, and the base currency said it was locked, in a toast, whatever went wrong. Now
 * each checks with the rules both runtimes run (shared/profileSchema.ts, shared/settingsSchema.ts),
 * marks the field, focuses it and sends nothing. What only the runtime can tell, a name another
 * profile has or a currency the profile's data holds, is marked the same way.
 *
 * Every case runs signed in (the Worker) and local-first (the IndexedDB router), except the
 * account's email address, which only the cloud has. Pull requests run the `@smoke` ones; main
 * runs them all.
 */
import { expect, test } from '@playwright/test'
import {
  E2E_BASE,
  firstProfileId,
  gotoServerless,
  gotoServerlessZeroState,
  isNetworkNoise,
  login,
  navigateToRoute,
} from './test-helpers'
import type { Locator, Page } from '@playwright/test'

interface Mode {
  name: 'cloud' | 'local-first'
  /** Opens the app at `route`, signed in or local-first, once `ready` shows. */
  open: (page: Page, route: string, ready: string) => Promise<void>
}

interface StoredProfile {
  id: number
  name: string
}

/** The setup wizard can open over an empty profile: leave it each time it shows up. */
async function leaveOnboarding(page: Page): Promise<void> {
  await page.addLocatorHandler(page.getByTestId('onboarding-wizard'), async () => {
    await page.getByTestId('onboarding-skip').click()
    const confirm = page.getByRole('button', { name: 'Confirm' })
    if (await confirm.isVisible({ timeout: 2_000 }).catch(() => false)) await confirm.click()
  })
}

const MODES: Mode[] = [
  {
    name: 'cloud',
    open: async (page, route, ready) => {
      await leaveOnboarding(page)
      await login(page)
      await navigateToRoute(page, route)
      await expect(page.getByTestId(ready)).toBeVisible({ timeout: 30_000 })
    },
  },
  {
    name: 'local-first',
    open: async (page, route, ready) => {
      await leaveOnboarding(page)
      await gotoServerless(page, route, ready)
    },
  },
]

const toasts = (page: Page): Locator => page.getByRole('region', { name: 'Notifications' })
const errorToasts = (page: Page): Locator => toasts(page).getByRole('alert')

/** Uncaught exceptions, and console errors that are not the network's own noise. */
function watchErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (msg) => {
    const text = msg.text()
    if (msg.type() === 'error' && text.includes('Error') && !isNetworkNoise(text)) {
      errors.push(text)
    }
  })
  page.on('pageerror', (error) => errors.push(error.message))
  return errors
}

/** Every write to `path` the page sends over the network (local-first sends none). */
function watchWrites(page: Page, path: RegExp): string[] {
  const writes: string[] = []
  page.on('request', (request) => {
    if (request.method() !== 'GET' && path.test(new URL(request.url()).pathname)) {
      writes.push(`${request.method()} ${request.url()}`)
    }
  })
  return writes
}

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE'

/** A request through the app's own API client, in whichever storage mode the page runs. */
async function viaApp<T = unknown>(
  page: Page,
  method: Method,
  url: string,
  body?: unknown
): Promise<T> {
  const answer = await page.evaluate(
    async (req) => {
      const spec = '/src/core/api.ts'
      const mod = (await import(/* @vite-ignore */ spec)) as {
        apiGet: (url: string) => Promise<unknown>
        apiPost: (url: string, body: unknown) => Promise<unknown>
        apiPut: (url: string, body: unknown) => Promise<unknown>
        apiDelete: (url: string) => Promise<unknown>
      }
      if (req.method === 'GET') return mod.apiGet(req.url)
      if (req.method === 'POST') return mod.apiPost(req.url, req.body)
      if (req.method === 'PUT') return mod.apiPut(req.url, req.body)
      return mod.apiDelete(req.url)
    },
    { method, url, body }
  )
  return answer as T
}

/**
 * A request as another tab would send it: the page's own client is not used, so the page is not
 * told. On the Worker it is the API, as the profile `profileId`; in local-first, the router the
 * page's IndexedDB sits behind.
 */
async function elsewhere<T = unknown>(
  page: Page,
  mode: Mode,
  method: Method,
  url: string,
  profileId: number,
  body?: unknown
): Promise<T> {
  if (mode.name === 'cloud') {
    const res = await page.request.fetch(`${E2E_BASE}${url}`, {
      method,
      headers: { 'X-Profile-Id': String(profileId) },
      data: body,
    })
    expect(res.ok(), `${method} ${url}: ${res.status()}`).toBeTruthy()
    return (await res.json()) as T
  }
  return page.evaluate(
    async (req) => {
      const spec = '/src/core/storage/localApiRouter.ts'
      const mod = (await import(/* @vite-ignore */ spec)) as {
        routeApiRequest: (url: string, init?: RequestInit) => Promise<Response>
      }
      const res = await mod.routeApiRequest(req.url, {
        method: req.method,
        headers: { 'X-Profile-Id': String(req.profileId) },
        body: req.body === undefined ? undefined : JSON.stringify(req.body),
      })
      if (!res.ok) throw new Error(`${req.method} ${req.url}: ${res.status}`)
      return (await res.json()) as T
    },
    { method, url, profileId, body }
  )
}

/** The profiles, read by the app, or undefined while the page is between two documents. */
async function listedProfiles(page: Page): Promise<StoredProfile[] | undefined> {
  try {
    return await viaApp<StoredProfile[]>(page, 'GET', '/api/profiles')
  } catch {
    return undefined
  }
}

/**
 * Takes out of the Worker's database the profiles a case made, whether or not the case got that
 * far: they belong to the account every spec shares, which outlives a local run. Local-first keeps
 * everything in the test's own browser, which goes with it.
 */
async function sweep(page: Page, mode: Mode, stamp: string): Promise<void> {
  if (mode.name !== 'cloud' || !stamp) return
  const fixture = await firstProfileId(page)
  const res = await page.request.get(`${E2E_BASE}/api/profiles`, {
    headers: { 'X-Profile-Id': String(fixture) },
  })
  const profiles = (await res.json()) as StoredProfile[]
  for (const profile of profiles.filter((p) => p.name.toLowerCase().includes(stamp))) {
    await page.request.delete(`${E2E_BASE}/api/profiles/${profile.id}`, {
      headers: { 'X-Profile-Id': String(fixture) },
    })
  }
}

for (const mode of MODES) {
  test.describe(`profiles and Settings, ${mode.name}`, () => {
    /** In the name of every profile a case makes, so `sweep` can find it. */
    let stamp = ''

    test.beforeEach(() => {
      test.setTimeout(120_000)
      // Unique to this case: two cases that start in the same millisecond on two workers must not
      // sweep each other's rows.
      stamp = `${Date.now().toString(36)}${test.info().parallelIndex}`
    })

    test.afterEach(async ({ page }) => {
      await sweep(page, mode, stamp)
    })

    test('a profile is created, renamed and deleted, and a name either runtime refuses is marked at its field @smoke', async ({
      page,
    }) => {
      const errors = watchErrors(page)
      await mode.open(page, 'dashboard', 'profile-dropdown-btn')
      const started = Number(await page.evaluate(() => localStorage.getItem('currentProfileId')))
      const before = await viaApp<StoredProfile[]>(page, 'GET', '/api/profiles')
      const kept = before.find((profile) => profile.id === started)!
      const writes = watchWrites(page, /^\/api\/profiles/)
      const name = `zz-profile-${stamp}`

      const modal = page.getByTestId('profile-modal')
      const nameField = modal.getByLabel('Profile Name', { exact: true })
      const openCreate = async () => {
        await page.getByTestId('profile-dropdown-btn').click()
        await page.getByTestId('profile-create-item').click()
        await expect(modal).toBeVisible()
      }

      // Created from the profile menu. A blank name is marked, and nothing is sent.
      await openCreate()
      await modal.getByTestId('profile-create-submit').click()

      await expect(nameField).toHaveAttribute('aria-invalid', 'true')
      await expect(nameField).toHaveAccessibleDescription('Give the profile a name.')
      await expect(nameField).toBeFocused()
      expect(writes).toEqual([])
      expect(await viaApp<StoredProfile[]>(page, 'GET', '/api/profiles')).toHaveLength(
        before.length
      )

      await nameField.fill(name)
      await expect(nameField).not.toHaveAttribute('aria-invalid', 'true')
      await modal.getByTestId('profile-create-submit').click()

      await expect(modal).toHaveCount(0)
      await expect(
        toasts(page).getByText(`Added "${name}" to your profiles and switched to it.`)
      ).toBeVisible()
      const created = (await viaApp<StoredProfile[]>(page, 'GET', '/api/profiles')).find(
        (profile) => profile.name === name
      )!
      expect(created).toBeDefined()
      await expect(page.getByTestId('profile-dropdown-btn')).toContainText(name)

      // The same name in capitals: the runtime is the one that knows it is taken.
      await openCreate()
      await nameField.fill(name.toUpperCase())
      await modal.getByTestId('profile-create-submit').click()

      await expect(nameField).toHaveAccessibleDescription(
        `You already have a profile called "${name}". Choose another name.`
      )
      await expect(nameField).toBeFocused()
      await modal.getByRole('button', { name: 'Cancel' }).click()
      await expect(modal).toHaveCount(0)
      const twins = (await viaApp<StoredProfile[]>(page, 'GET', '/api/profiles')).filter(
        (profile) => profile.name.toLowerCase() === name
      )
      expect(twins).toHaveLength(1)

      // Renamed in Settings' household view: onto another profile's name, refused at the field,
      // then to a name of its own, in place.
      await page.evaluate(() => {
        location.hash = '#settings'
      })
      await page.getByTestId('settings-tab-exports').click()
      const row = page.getByTestId(`household-profile-${created.id}`)
      await row.getByRole('button', { name: 'Edit' }).click()
      const rename = row.getByLabel(`New name for ${name}`, { exact: true })
      await expect(rename).toHaveValue(name)

      await rename.fill(kept.name.toUpperCase())
      await row.getByRole('button', { name: 'Save' }).click()

      await expect(rename).toHaveAttribute('aria-invalid', 'true')
      await expect(rename).toHaveAccessibleDescription(
        `You already have a profile called "${kept.name}". Choose another name.`
      )
      await expect(rename).toBeFocused()

      await rename.fill('')
      await row.getByRole('button', { name: 'Save' }).click()
      await expect(rename).toHaveAccessibleDescription('Give the profile a name.')

      await rename.fill(`${name}-renamed`)
      await row.getByRole('button', { name: 'Save' }).click()

      await expect(toasts(page).getByText(`Renamed "${name}" to "${name}-renamed".`)).toBeVisible()
      await expect(rename).toHaveCount(0)
      await expect(row).toContainText(`${name}-renamed`)
      await expect(page.getByTestId('profile-dropdown-btn')).toContainText(`${name}-renamed`)

      // Deleted from the Danger Zone, which reloads the app on another profile.
      await page.locator('#danger-profile-select').selectOption(String(created.id))
      await page.getByRole('button', { name: 'Delete Profile', exact: true }).click()
      await page.getByRole('button', { name: 'Yes, Delete Profile' }).click()

      await expect
        .poll(async () => (await listedProfiles(page))?.map((profile) => profile.id), {
          timeout: 30_000,
        })
        .not.toContain(created.id)
      await expect(page.getByTestId('profile-dropdown-btn')).toBeVisible({ timeout: 30_000 })
      await expect(page.getByTestId('profile-dropdown-btn')).not.toContainText(name)
      await expect(errorToasts(page)).toHaveCount(0)
      expect(errors).toEqual([])
    })

    test('the base currency changes while nothing holds it, and is refused at the select once something does @smoke', async ({
      page,
    }) => {
      const errors = watchErrors(page)
      let profileId: number
      if (mode.name === 'cloud') {
        // A profile of its own: the shared fixture profile holds accounts, and its currency is
        // every other spec's.
        const fixture = await firstProfileId(page)
        profileId = (
          await elsewhere<StoredProfile>(page, mode, 'POST', '/api/profiles', fixture, {
            name: `zz-currency-${stamp}`,
          })
        ).id
        await page.addInitScript((id) => {
          localStorage.setItem('currentProfileId', String(id))
          localStorage.setItem('selectedProfileIds', JSON.stringify([id]))
        }, profileId)
        await mode.open(page, 'settings', 'settings-currency-select')
      } else {
        // A browser with nothing in it: local-first's currency is the browser's, and the demo's
        // accounts would hold it.
        await leaveOnboarding(page)
        await gotoServerlessZeroState(page, 'settings', 'settings-currency-select')
        profileId = (
          await elsewhere<StoredProfile>(page, mode, 'POST', '/api/profiles', 0, {
            name: `zz-currency-${stamp}`,
          })
        ).id
      }
      const stored = async () =>
        (await elsewhere<{ currency: string }>(page, mode, 'GET', '/api/settings', profileId))
          .currency
      const select = page.getByLabel('Base currency', { exact: true })

      await select.selectOption('USD')

      await expect(toasts(page).getByText('Base currency set to USD.')).toBeVisible()
      await expect(select).toHaveValue('USD')
      expect(await stored()).toBe('USD')

      // An account, added in another tab: its balance is kept in US dollars from now on.
      await elsewhere(page, mode, 'POST', '/api/accounts', profileId, {
        name: `zz-account-${stamp}`,
        type: 'giro',
        starting_balance: 0,
      })
      await select.selectOption('GBP')

      await expect(select).toHaveAttribute('aria-invalid', 'true')
      await expect(select).toHaveAccessibleDescription(
        'The base currency stays USD once you have accounts or transactions.'
      )
      await expect(select).toBeFocused()
      await expect(select).toHaveValue('USD')
      expect(await stored()).toBe('USD')
      await expect(errorToasts(page)).toHaveCount(0)
      expect(errors).toEqual([])
    })
  })
}

test.describe('email reminders, cloud', () => {
  test('an address the Worker cannot use is marked under the address, and nothing is saved', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    await MODES[0].open(page, 'settings', 'settings-notifications-form')
    const field = page.getByLabel('Email address', { exact: true })
    await expect(field).not.toHaveValue('', { timeout: 30_000 })
    const address = await field.inputValue()

    await field.fill('not-an-address')
    await page.getByTestId('settings-notifications-save').click()

    await expect(field).toHaveAttribute('aria-invalid', 'true')
    await expect(field).toHaveAccessibleDescription('A valid email is required')
    await expect(field).toBeFocused()
    await expect(page.getByTestId('settings-email-pending')).toHaveCount(0)
    await expect(errorToasts(page)).toHaveCount(0)

    await field.fill(address)
    await expect(field).not.toHaveAttribute('aria-invalid', 'true')
  })
})
