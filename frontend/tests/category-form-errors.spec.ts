/**
 * The category dialogs, in both storage modes: a refused save is said in the dialog, under the
 * field it is about.
 *
 * It used to be a toast. On local-first a blank icon was refused and the toast said "Failed to
 * save category" (#599); a name already in use said the same; an empty name got the browser's
 * own bubble. Now the dialog checks the values with the rules both runtimes run, marks the field
 * (`aria-invalid`, the message as its accessible description), moves focus to it, and puts the
 * server's reason for a taken name under the same field. No failure toast.
 *
 * Every case runs signed in (the Worker) and local-first (the IndexedDB router), because the two
 * answered differently before and the point is that they now answer the same. The one that holds
 * a save open runs signed in only: local-first sends no request to hold.
 */
import { expect, test } from '@playwright/test'
import { gotoServerless, login, navigateToRoute } from './test-helpers'
import type { Locator, Page } from '@playwright/test'

interface Mode {
  name: 'cloud' | 'local-first'
  goto: (page: Page, route: string, readyTestId: string) => Promise<void>
}

const MODES: Mode[] = [
  {
    name: 'cloud',
    goto: async (page, route, readyTestId) => {
      await login(page)
      await navigateToRoute(page, route)
      await expect(page.getByTestId(readyTestId)).toBeVisible({ timeout: 20_000 })
    },
  },
  { name: 'local-first', goto: gotoServerless },
]

/** In the shared fixture profile and in the local-first demo alike. */
const EXISTING = 'Housing'

/**
 * The dialog's name field, found by the text of its label. Not `getByLabel`: the old dialogs'
 * labels were not tied to their inputs, and a test that cannot find the field on the old code
 * proves nothing about what the old code did with an empty name. The tie is asserted on its own.
 */
const nameField = (page: Page): Locator =>
  page
    .locator('label', { hasText: /^\s*Category Name\s*$/ })
    .locator('xpath=following-sibling::input[1]')
const dialogForm = (page: Page): Locator => nameField(page).locator('xpath=ancestor::form')
const submit = (page: Page) => dialogForm(page).locator('button[type="submit"]').click()
const errorToasts = (page: Page): Locator =>
  page.getByRole('region', { name: 'Notifications' }).getByRole('alert')

/** The active profile's category called `name`, read the way the app reads it. */
async function storedCategory(
  page: Page,
  name: string
): Promise<{ id: number; icon: string | null } | null> {
  return page.evaluate(async (wanted) => {
    const spec = '/src/core/api.ts'
    const mod = (await import(/* @vite-ignore */ spec)) as {
      apiGet: (url: string) => Promise<{ id: number; name: string; icon: string | null }[]>
    }
    const list = await mod.apiGet('/api/categories')
    return list.find((c) => c.name === wanted) ?? null
  }, name)
}

async function deleteCategory(page: Page, id: number): Promise<void> {
  await page.evaluate(async (categoryId) => {
    const spec = '/src/core/api.ts'
    const mod = (await import(/* @vite-ignore */ spec)) as {
      apiDelete: (url: string) => Promise<unknown>
    }
    await mod.apiDelete(`/api/categories/${categoryId}`)
  }, id)
}

/** Every category POST the page sends over the network (local-first sends none: no server). */
function watchCategoryPosts(page: Page): string[] {
  const posts: string[] = []
  page.on('request', (request) => {
    if (request.method() === 'POST' && /\/api\/categories\b/.test(request.url())) {
      posts.push(request.url())
    }
  })
  return posts
}

for (const mode of MODES) {
  test.describe(`the category dialog, ${mode.name} @smoke`, () => {
    test.beforeEach(async ({ page }) => {
      await mode.goto(page, 'categories', 'categories-header')
      await page.getByTestId('add-category-btn').click()
      await expect(nameField(page)).toBeVisible()
    })

    test('an empty name is marked under the field, focused, and nothing is sent', async ({
      page,
    }) => {
      const posts = watchCategoryPosts(page)

      await submit(page)

      await expect(nameField(page)).toHaveAttribute('aria-invalid', 'true')
      await expect(nameField(page)).toHaveAccessibleDescription(/Give the category a name\./)
      await expect(nameField(page)).toBeFocused()
      expect(posts).toEqual([])
      await expect(errorToasts(page)).toHaveCount(0)

      // The message goes as soon as the field is fixed, without another submit.
      await nameField(page).fill('C')
      await expect(nameField(page)).not.toHaveAttribute('aria-invalid', 'true')

      // And the label names the field, so a screen reader says what it is.
      await expect(page.getByLabel('Category Name', { exact: true })).toHaveValue('C')
    })

    test('a name already in use is marked with the reason the server gave', async ({ page }) => {
      await nameField(page).fill(` ${EXISTING.toLowerCase()} `)

      await submit(page)

      await expect(nameField(page)).toHaveAttribute('aria-invalid', 'true')
      await expect(nameField(page)).toHaveAccessibleDescription(
        `You already have a category called "${EXISTING}". Choose another name.`
      )
      await expect(page.getByTestId('category-modal-overlay')).toBeVisible()
      await expect(errorToasts(page)).toHaveCount(0)
    })

    test('a category with no icon picked saves, with the default icon', async ({ page }) => {
      const name = `zz-form-${Date.now().toString(36)}`
      await nameField(page).fill(name)

      await submit(page)

      await expect(page.getByTestId('category-modal-overlay')).toBeHidden()
      const stored = await storedCategory(page, name)
      expect(stored?.icon).toBe('tag')
      await expect(errorToasts(page)).toHaveCount(0)
      // The fixture profile is shared by every spec; local-first starts fresh per test.
      if (stored && mode.name === 'cloud') await deleteCategory(page, stored.id)
    })
  })

  test.describe(`the other category dialogs, ${mode.name} @smoke`, () => {
    const SURFACES = [
      {
        page: 'budgets',
        ready: 'budgets-header',
        open: (page: Page) => page.getByRole('button', { name: 'Add Category' }).first().click(),
      },
      {
        page: 'bills',
        ready: 'bills-header',
        open: async (page: Page) => {
          await page.getByTestId('add-bill-btn').click()
          await page.getByRole('button', { name: '+ Add Category' }).click()
        },
      },
      {
        page: 'goals',
        ready: 'goals-header',
        open: async (page: Page) => {
          await page.getByTestId('add-goal-btn').click()
          await page.getByRole('button', { name: '+ Add Category' }).click()
        },
      },
    ]

    for (const surface of SURFACES) {
      test(`${surface.page}: an empty name is marked under the field`, async ({ page }) => {
        await mode.goto(page, surface.page, surface.ready)
        await surface.open(page)
        await expect(nameField(page)).toBeVisible()

        await submit(page)

        await expect(nameField(page)).toHaveAttribute('aria-invalid', 'true')
        await expect(nameField(page)).toHaveAccessibleDescription(/Give the category a name\./)
        await expect(nameField(page)).toBeFocused()
        await expect(errorToasts(page)).toHaveCount(0)
      })
    }
  })
}

test.describe('the category dialog while it saves, cloud @smoke', () => {
  test.beforeEach(async ({ page }) => {
    await MODES[0].goto(page, 'categories', 'categories-header')
    await page.getByTestId('add-category-btn').click()
    await expect(nameField(page)).toBeVisible()
  })

  test('the button says so and keeps focus, and the form is busy', async ({ page }) => {
    const name = `zz-busy-${Date.now().toString(36)}`
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    await page.route('**/api/categories', async (route) => {
      if (route.request().method() === 'POST') await held
      await route.continue()
    })
    await nameField(page).fill(name)
    const button = dialogForm(page).locator('button[type="submit"]')

    // From the keyboard, so focus is on the button when the save starts: a disabled button would
    // drop it.
    await button.focus()
    await button.press('Enter')

    await expect(button).toHaveText('Adding…')
    await expect(button).toBeFocused()
    await expect(button).toHaveAttribute('aria-disabled', 'true')
    await expect(button).not.toHaveAttribute('disabled')
    await expect(dialogForm(page)).toHaveAttribute('aria-busy', 'true')

    release()
    await expect(page.getByTestId('category-modal-overlay')).toBeHidden()
    await expect(
      page
        .getByRole('region', { name: 'Notifications' })
        .getByText(`Added "${name}" to your categories.`)
    ).toBeVisible()
    const stored = await storedCategory(page, name)
    if (stored) await deleteCategory(page, stored.id)
  })

  // The Worker answers a request with no session {error: 'Unauthorized'}. The dialog said that
  // word and stayed open, with nothing to do but cancel.
  test('a session that has ended asks to sign in again', async ({ page }) => {
    await nameField(page).fill(`zz-ended-${Date.now().toString(36)}`)
    await page.context().clearCookies()

    await submit(page)

    // App answers 'auth:required' by putting the sign-in screen where the app was.
    await expect(page.getByTestId('emailcode-open')).toBeVisible()
    await expect(page.getByText('Unauthorized', { exact: true })).toHaveCount(0)
  })
})
