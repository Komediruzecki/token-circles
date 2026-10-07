/**
 * Release scope 5.16.1, section 14: the local-first household view. With two profiles ticked, the
 * tag pickers offer the active profile's tags alone, a typed name matches an existing tag of that
 * profile, and the other profile's rows carry their own category, tags and receipt.
 *
 * `a` is Example Mid Income (active), `b` Example Low Income, ticked as the second profile.
 */
import { inProfile } from './profile-helpers'
import { expect, localTest } from './release-fixtures'
import { clickOutsideProfileMenu, goPage, storedSelection, tickProfile } from './release-helpers'
import {
  addTag,
  addTransaction,
  categoryNamed,
  firstAccountId,
  openTransactions,
  searchList,
  storedTagIds,
  storedTagNames,
  tagCardsNamed,
  tagFilterOffers,
  tagsNamed,
  txNamed,
  txRows,
} from './transactions-helpers'
import type { Page } from '@playwright/test'
import type { Mode } from './release-fixtures'
import type { TagRow } from './transactions-helpers'

/** Every case in this section is local-first only (L). */
const test = localTest

const byId = (x: number, y: number) => x - y

/** A tag in Example Low Income, made while it is the active profile. */
async function lowTag(m: Mode, name: string): Promise<TagRow> {
  return inProfile(m, m.b, (api) =>
    api<TagRow>('/api/tags', { method: 'POST', body: { name, color: '#f59e0b' } })
  )
}

/** Tick Example Low Income in the sidebar menu: the household view, Mid still active. */
async function tickLow(m: Mode): Promise<void> {
  await tickProfile(m.page, m.b.id)
  await clickOutsideProfileMenu(m.page)
  const stored = await storedSelection(m.page)
  expect(stored.current).toBe(m.a.id)
  expect([...stored.selected].sort(byId)).toEqual([m.a.id, m.b.id].sort(byId))
}

/** The active profile's tag names, from storage. */
async function ownTagNames(m: Mode): Promise<string[]> {
  return (await m.rows<TagRow>('tags', m.a.id)).map((t) => t.name).sort()
}

/** Rows in the active profile, to select for a bulk action. */
async function addRows(m: Mode, names: string[]): Promise<number[]> {
  const category = await categoryNamed(m, m.a.id, 'Utilities')
  const accountId = await firstAccountId(m, m.a.id)
  const ids: number[] = []
  for (const [i, description] of names.entries()) {
    ids.push(
      await addTransaction(m, { description, amount: 11 + i, categoryId: category.id, accountId })
    )
  }
  return ids
}

/** Search the list down to `search`, tick each row, and open the bulk bar's Tag window. */
async function bulkTagWindow(page: Page, search: string, names: string[]) {
  await openTransactions(page)
  await searchList(page, search)
  await expect(page.getByTestId('transactions-row')).toHaveCount(names.length)
  for (const name of names) await txRows(page, name).locator('input[type="checkbox"]').check()
  await expect(page.getByTestId('bulk-action-bar')).toContainText(`${names.length} selected`)
  await page.getByTestId('bulk-tag-btn').click()
  const modal = page.getByTestId('bulk-tag-modal')
  await expect(modal).toBeVisible()
  return modal
}

function toast(page: Page, text: string) {
  return page.getByRole('region', { name: 'Notifications' }).getByText(text)
}

/** Attach a receipt to a transaction of the active profile, as the receipt upload does. */
async function uploadReceipt(page: Page, transactionId: number): Promise<void> {
  await page.evaluate(async (id) => {
    // A variable specifier: vite serves the source module, and the browser hands back the
    // instance the app already loaded.
    const spec = '/src/core/api.ts'
    const mod = (await import(/* @vite-ignore */ spec)) as {
      api: { uploadReceipt: (txId: number, file: File) => Promise<unknown> }
    }
    // A 1x1 PNG.
    const png =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
    const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0))
    await mod.api.uploadReceipt(id, new File([bytes], 'zz-receipt.png', { type: 'image/png' }))
  }, transactionId)
}

test.describe('5.16.1 s14 household tags [local]', () => {
  test("14.1 the tag filter offers only the active profile's tags @release", async ({ m }) => {
    const { page } = m
    await lowTag(m, 'zz-low')
    await addTag(m, 'zz-mid')
    await tickLow(m)

    await openTransactions(page)
    const offered = (await tagFilterOffers(page)).sort()
    expect(offered).toEqual(await ownTagNames(m))
    expect(offered).toContain('zz-mid')
    expect(offered).not.toContain('zz-low')
  })

  test("14.2 the bulk Tag window offers only the active profile's tags, and one applies @release", async ({
    m,
  }) => {
    const { page } = m
    await lowTag(m, 'zz-low')
    await addTag(m, 'zz-mid')
    const names = ['Zzhold one', 'Zzhold two']
    const ids = await addRows(m, names)
    await tickLow(m)

    const modal = await bulkTagWindow(page, 'Zzhold', names)
    const chips = modal.getByTestId('bulk-tag-chips').getByRole('button')
    const offered = (await chips.allInnerTexts()).map((t) => t.trim()).sort()
    expect(offered).toEqual(await ownTagNames(m))
    expect(offered).not.toContain('zz-low')

    await modal
      .getByTestId('bulk-tag-chips')
      .getByRole('button', { name: 'zz-mid', exact: true })
      .click()
    await modal.getByTestId('bulk-tag-apply').click()
    await expect(toast(page, 'Added 1 tag to 2 transactions')).toBeVisible()
    await expect(modal).toBeHidden()
    for (const id of ids) expect(await storedTagNames(m, id)).toEqual(['zz-mid'])
    for (const name of names) {
      await expect(txRows(page, name).getByTestId('transactions-cell-description')).toContainText(
        'zz-mid'
      )
    }
  })

  test('14.3 a known tag typed in another case is applied, and not made again @release', async ({
    m,
  }) => {
    const { page } = m
    // The same name in both profiles: only the active profile's may be matched.
    const low = await lowTag(m, 'Zz Pantry')
    const mid = await addTag(m, 'Zz Pantry')
    const names = ['Zzcase one', 'Zzcase two']
    const ids = await addRows(m, names)
    await tickLow(m)

    const modal = await bulkTagWindow(page, 'Zzcase', names)
    const input = modal.getByTestId('bulk-tag-new-input')
    await input.fill(' zz pantry ')
    await input.press('Enter')
    // The existing tag is picked: the box empties and Apply comes on.
    await expect(input).toHaveValue('')
    await expect(modal.getByTestId('bulk-tag-apply')).toBeEnabled()
    await modal.getByTestId('bulk-tag-apply').click()
    await expect(toast(page, 'Added 1 tag to 2 transactions')).toBeVisible()

    for (const id of ids) expect(await storedTagIds(m, id)).toEqual([mid.id])
    expect((await tagsNamed(m, m.a.id, 'zz pantry')).map((t) => t.id)).toEqual([mid.id])
    expect((await tagsNamed(m, m.b.id, 'zz pantry')).map((t) => t.id)).toEqual([low.id])

    // The Tags page, opened for the first time now.
    await goPage(page, 'tags')
    await expect.poll(() => tagCardsNamed(page, 'zz pantry'), { timeout: 20_000 }).toBe(1)
  })

  test("14.4 the other profile's rows show their own category, tags and receipt @release", async ({
    m,
  }) => {
    const { page } = m
    const name = 'Zz Lowtide Market'
    const category = await categoryNamed(m, m.b.id, 'Utilities')
    const accountId = await firstAccountId(m, m.b.id)
    await inProfile(m, m.b, async (api) => {
      const tag = await api<TagRow>('/api/tags', {
        method: 'POST',
        body: { name: 'zz-low', color: '#f59e0b' },
      })
      const id = await addTransaction(m, {
        description: name,
        amount: 27,
        categoryId: category.id,
        accountId,
      })
      await api(`/api/transactions/${id}/tags`, { method: 'PUT', body: { tagIds: [tag.id] } })
      await uploadReceipt(page, id)
    })
    const stored = await txNamed(m, m.b.id, name)
    expect(stored.category_id).toBe(category.id)
    await tickLow(m)

    await openTransactions(page)
    await searchList(page, name)
    const row = txRows(page, name)
    await expect(row).toHaveCount(1)
    await expect(row.getByTestId('transactions-cell-category')).toContainText(category.name)
    const description = row.getByTestId('transactions-cell-description')
    await expect(description).toContainText('zz-low')
    await expect(description.getByRole('button', { name: 'View receipt' })).toBeVisible()

    // And the seeded rows of Example Low Income on the page: none shows the dash. Its rows are the
    // ones whose checkbox is off (the list selects the active profile's rows only).
    await searchList(page, '')
    const foreign = page
      .getByTestId('transactions-row')
      .filter({ has: page.locator('input[type="checkbox"]:disabled') })
    await expect(foreign.first()).toBeVisible()
    const categories = await foreign.getByTestId('transactions-cell-category').allInnerTexts()
    expect(categories.map((c) => c.trim())).not.toContain('—')
  })
})
