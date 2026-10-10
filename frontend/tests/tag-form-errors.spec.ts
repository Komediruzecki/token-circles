/**
 * The Tags page's tag form, in both storage modes: a tag without a name is marked at the name and
 * nothing is sent, and a name another tag has, added in another tab, is marked at the name in the
 * runtime's words.
 *
 * The form said what the runtime said in a toast ("Validation failed", "Tag already exists"), and
 * a blank name only kept its button from doing anything. Now it checks with the rules both
 * runtimes run (shared/tagSchema.ts) before it sends anything. What only the runtime can tell is
 * a name another tag has: the page does not list a tag another tab added.
 *
 * Every case runs signed in (the Worker) and local-first (the IndexedDB router). Main runs them
 * all; none is `@smoke`.
 */
import { expect, test } from '@playwright/test'
import {
  caseStamp,
  elsewhere,
  errorToasts,
  MODES,
  REFUSAL_LOGGED,
  sweepProfiles,
  viaApp,
  watchErrors,
  watchWrites,
} from './form-errors-helpers'
import type { Locator, Page } from '@playwright/test'

interface Tag {
  id: number
  name: string
}

const newTagButton = (page: Page): Locator => page.getByRole('button', { name: '+ New tag' })
const form = (page: Page): Locator => page.getByTestId('tag-form')
const nameField = (page: Page): Locator => page.getByTestId('tag-name-input')
const create = (page: Page) => form(page).getByRole('button', { name: 'Create' }).click()

for (const mode of MODES) {
  test.describe(`the tag form, ${mode.name}`, () => {
    /** In the name of everything a case makes, so the sweep can find it. */
    let stamp = ''

    test.beforeEach(() => {
      test.setTimeout(120_000)
      stamp = caseStamp()
    })

    test.afterEach(async ({ page }) => {
      await sweepProfiles(page, mode, stamp)
    })

    test('a tag without a name is marked and nothing is sent, and a name another tab took is marked at the name', async ({
      page,
    }) => {
      const errors = watchErrors(page, REFUSAL_LOGGED)
      const profileId = await mode.open(page, 'tags', newTagButton, `zz-tags-${stamp}`)
      const writes = watchWrites(page, /^\/api\/tags/)
      const name = `zz-tag-${stamp}`

      await newTagButton(page).click()
      await expect(form(page)).toBeVisible()
      await create(page)

      await expect(nameField(page)).toHaveAttribute('aria-invalid', 'true')
      await expect(nameField(page)).toHaveAccessibleDescription('Give the tag a name.')
      await expect(nameField(page)).toBeFocused()
      expect(writes).toEqual([])
      await expect(errorToasts(page)).toHaveCount(0)

      // The same name in another tab: the page is not told, so the runtime is the one that knows.
      await elsewhere(page, mode, 'POST', '/api/tags', profileId, { name, color: '#0ea5e9' })
      await nameField(page).fill(name.toUpperCase())
      await create(page)

      await expect(nameField(page)).toHaveAccessibleDescription(
        `You already have a tag called "${name}". Choose another name.`
      )
      await expect(nameField(page)).toBeFocused()
      await expect(form(page)).toBeVisible()
      await expect(errorToasts(page)).toHaveCount(0)
      const twins = (await viaApp<Tag[]>(page, 'GET', '/api/tags')).filter(
        (tag) => tag.name.toLowerCase() === name
      )
      expect(twins).toHaveLength(1)
      expect(errors).toEqual([])
    })
  })
}
