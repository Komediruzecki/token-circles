/**
 * Release scope 5.16.0, section 3: the Transactions list and the form's tags (#579, with the
 * household tag scope of 15a89947 for 3.10).
 *
 * The list follows writes made anywhere, and refetches once per write rather than once per row.
 * The add/edit form keeps a tag set of its own: before #579 a tag typed into the form became the
 * list's filter and never reached the transaction.
 */
import { recordToasts, toastsSeen } from './badge-helpers'
import { inProfile } from './profile-helpers'
import { both, expect, localTest } from './release-fixtures'
import {
  clickOutsideProfileMenu,
  goPage,
  storedSelection,
  tickProfile,
  trackApi,
} from './release-helpers'
import {
  addTag,
  addTransaction,
  allListGetsSince,
  categoryNamed,
  enterFormTag,
  fetchMark,
  fillForm,
  firstAccountId,
  formChips,
  formOffers,
  listReloadsSince,
  openAddForm,
  openEditForm,
  openTransactions,
  pickFormTag,
  quickAdd,
  removeFormTag,
  saveForm,
  searchList,
  showTagPicker,
  storedTagIds,
  storedTagNames,
  tagCardsNamed,
  tagsNamed,
  txNamed,
  txRows,
  unfilteredTagButton,
  watchFetchCallers,
} from './transactions-helpers'
import type { Mode } from './release-fixtures'
import type { TagRow } from './transactions-helpers'

/** An expense category both passes have: the cloud seed's and the demo's. */
async function utilities(m: Mode) {
  return categoryNamed(m, m.a.id, 'Utilities')
}

/**
 * Wait for the network to go quiet past the badge evaluation's 1.2 s debounce, then count the
 * list's own reloads since `mark`. Cloud only: local-first reads never reach the network.
 */
async function expectOneListReload(m: Mode, mark: number, api: ReturnType<typeof trackApi>) {
  await api.settle(2500)
  if (m.kind !== 'cloud') return
  const reloads = await listReloadsSince(m.page, mark)
  expect(
    reloads,
    `GET /api/transactions since the write, by caller: ${(await allListGetsSince(m.page, mark)).join(', ')}`
  ).toBe(1)
}

for (const [pass, test] of both) {
  test.describe(`5.16.0 s3 transactions [${pass}]`, () => {
    test('3.1 a quick add on the Dashboard is listed without F5 @release', async ({ m }) => {
      const { page } = m
      const category = await utilities(m)
      // Transactions is open first: the case is a page that stayed mounted following a write
      // made on another one. A first visit after the write would load fresh and prove nothing.
      await openTransactions(page)
      await searchList(page, 'Lanternquick')
      await expect(txRows(page, 'Lanternquick')).toHaveCount(0)

      await goPage(page, 'dashboard', 'dashboard-container')
      await quickAdd(page, 'Lanternquick 12', category.id)

      await goPage(page, 'transactions', 'transactions-header')
      const row = txRows(page, 'Lanternquick')
      await expect(row).toHaveCount(1)
      await expect(row.getByTestId('transactions-cell-category')).toContainText(category.name)
      const stored = await txNamed(m, m.a.id, 'Lanternquick')
      expect(stored).toMatchObject({ amount: 12, type: 'expense', category_id: category.id })
    })

    test('3.2 bulk category on five rows reloads the list once @release', async ({ m }) => {
      const { page } = m
      const housing = await categoryNamed(m, m.a.id, 'Housing')
      const target = await utilities(m)
      const accountId = await firstAccountId(m, m.a.id)
      const names = ['Zzbulk one', 'Zzbulk two', 'Zzbulk three', 'Zzbulk four', 'Zzbulk five']
      for (const [i, description] of names.entries()) {
        await addTransaction(m, {
          description,
          amount: 10 + i,
          categoryId: housing.id,
          accountId,
        })
      }

      await openTransactions(page)
      await searchList(page, 'Zzbulk')
      await expect(page.getByTestId('transactions-row')).toHaveCount(5)
      for (const description of names) {
        await txRows(page, description).locator('input[type="checkbox"]').check()
      }
      const bar = page.getByTestId('bulk-action-bar')
      await expect(bar).toContainText('5 selected')
      await bar.getByRole('button', { name: 'Change Category' }).click()
      const select = page
        .locator('select')
        .filter({ has: page.locator('option', { hasText: 'No Category' }) })
      await select.selectOption(String(target.id))
      const modal = select.locator('xpath=ancestor::div[.//button[normalize-space(.)="Apply"]][1]')

      if (m.kind === 'cloud') await watchFetchCallers(page)
      const api = trackApi(page)
      const mark = m.kind === 'cloud' ? await fetchMark(page) : 0
      await modal.getByRole('button', { name: 'Apply', exact: true }).click()

      for (const description of names) {
        await expect(
          txRows(page, description).getByTestId('transactions-cell-category')
        ).toContainText(target.name)
      }
      await expectOneListReload(m, mark, api)
      for (const description of names) {
        expect((await txNamed(m, m.a.id, description)).category_id).toBe(target.id)
      }
    })

    test('3.3 an edit and a delete reload the list once each @release', async ({ m }) => {
      const { page } = m
      const category = await utilities(m)
      const accountId = await firstAccountId(m, m.a.id)
      await addTransaction(m, {
        description: 'Zzrow edit',
        amount: 20,
        categoryId: category.id,
        accountId,
      })
      await addTransaction(m, {
        description: 'Zzrow delete',
        amount: 30,
        categoryId: category.id,
        accountId,
      })

      await openTransactions(page)
      await searchList(page, 'Zzrow')
      await expect(page.getByTestId('transactions-row')).toHaveCount(2)
      if (m.kind === 'cloud') await watchFetchCallers(page)
      const api = trackApi(page)

      // Edit one row.
      await openEditForm(page, 'Zzrow edit')
      await page.getByTestId('tx-amount').fill('25')
      let mark = m.kind === 'cloud' ? await fetchMark(page) : 0
      await saveForm(page)
      await expect(
        txRows(page, 'Zzrow edit').getByTestId('transactions-cell-amount')
      ).toContainText('25.00')
      await expectOneListReload(m, mark, api)
      expect((await txNamed(m, m.a.id, 'Zzrow edit')).amount).toBe(25)

      // Delete another.
      mark = m.kind === 'cloud' ? await fetchMark(page) : 0
      await txRows(page, 'Zzrow delete').getByRole('button', { name: 'Delete transaction' }).click()
      await page.getByTestId('confirm-accept').click()
      await expect(txRows(page, 'Zzrow delete')).toHaveCount(0)
      await expectOneListReload(m, mark, api)
      expect(
        (await m.rows<{ description: string }>('transactions', m.a.id)).filter(
          (r) => r.description === 'Zzrow delete'
        )
      ).toHaveLength(0)
    })

    test('3.4 a new tag typed in the form goes on the form, not the list filter @release', async ({
      m,
    }) => {
      const { page } = m
      await openTransactions(page)
      const rows = page.getByTestId('transactions-row')
      await expect(rows.first()).toBeVisible()
      const before = await rows.count()
      await expect(unfilteredTagButton(page)).toBeVisible()

      await openAddForm(page)
      await enterFormTag(page, 'zz-tag')

      // A chip in the form, for a tag made in the active profile.
      await expect(page.getByTestId('tx-tag-chip')).toHaveText(['zz-tag'])
      await expect.poll(async () => (await tagsNamed(m, m.a.id, 'zz-tag')).length).toBe(1)
      // The filter bar behind the form is untouched, and so is the list.
      await expect(unfilteredTagButton(page)).toBeVisible()
      expect(page.url()).not.toContain('tag=')
      await expect(rows).toHaveCount(before)

      // Still so once the form is gone: before #579 the list stayed filtered to the new tag.
      await page.getByTestId('tx-cancel-btn').click()
      await expect(page.getByTestId('tx-modal')).toBeHidden()
      await expect(unfilteredTagButton(page)).toBeVisible()
      await expect(rows).toHaveCount(before)
    })

    test('3.5 the saved transaction shows its new tag in the list @release', async ({ m }) => {
      const { page } = m
      const category = await utilities(m)
      await openTransactions(page)
      await openAddForm(page)
      await fillForm(page, { description: 'Zztagged supper', amount: 18, categoryId: category.id })
      await enterFormTag(page, 'zz-tag')
      await expect(page.getByTestId('tx-tag-chip')).toHaveText(['zz-tag'])
      await saveForm(page)

      await searchList(page, 'Zztagged supper')
      const row = txRows(page, 'Zztagged supper')
      await expect(row).toHaveCount(1)
      await expect(row.getByTestId('transactions-cell-description')).toContainText('zz-tag')
      const stored = await txNamed(m, m.a.id, 'Zztagged supper')
      expect(await storedTagNames(m, stored.id)).toEqual(['zz-tag'])
    })

    test('3.6 a one-click chip attaches an existing tag @release', async ({ m }) => {
      const { page } = m
      const category = await utilities(m)
      const tag = await addTag(m, 'zz-chip')
      await openTransactions(page)
      await openAddForm(page)
      await fillForm(page, { description: 'Zzchip lunch', amount: 14, categoryId: category.id })
      await showTagPicker(page)
      expect(await formOffers(page)).toContain('zz-chip')

      await pickFormTag(page, 'zz-chip')
      expect(await formChips(page)).toEqual(['zz-chip'])
      expect(await formOffers(page)).not.toContain('zz-chip')
      await saveForm(page)

      const stored = await txNamed(m, m.a.id, 'Zzchip lunch')
      expect(await storedTagIds(m, stored.id)).toEqual([tag.id])
      await searchList(page, 'Zzchip lunch')
      await expect(
        txRows(page, 'Zzchip lunch').getByTestId('transactions-cell-description')
      ).toContainText('zz-chip')
    })

    test('3.7 a known tag typed in another case is attached, not created again @release', async ({
      m,
    }) => {
      const { page } = m
      const category = await utilities(m)
      const tag = await addTag(m, 'zz-tag')
      await openTransactions(page)
      await openAddForm(page)
      await fillForm(page, { description: 'Zzcase dinner', amount: 16, categoryId: category.id })
      await enterFormTag(page, 'ZZ-TAG')
      // The chip is the existing tag, under its own name.
      await expect(page.getByTestId('tx-tag-chip')).toHaveText(['zz-tag'])
      await saveForm(page)

      const stored = await txNamed(m, m.a.id, 'Zzcase dinner')
      expect(await storedTagIds(m, stored.id)).toEqual([tag.id])
      expect(await tagsNamed(m, m.a.id, 'zz-tag')).toHaveLength(1)

      // The Tags page, opened for the first time now, so it shows what is stored.
      await goPage(page, 'tags')
      await expect.poll(() => tagCardsNamed(page, 'zz-tag'), { timeout: 20_000 }).toBe(1)
    })

    test('3.8 removing chips in the edit form takes exactly those tags off @release', async ({
      m,
    }) => {
      const { page } = m
      const category = await utilities(m)
      const accountId = await firstAccountId(m, m.a.id)
      const one = await addTag(m, 'zz-one')
      const two = await addTag(m, 'zz-two')
      const id = await addTransaction(m, {
        description: 'Zztwo tags',
        amount: 22,
        categoryId: category.id,
        accountId,
      })
      await m.api(`/api/transactions/${id}/tags`, {
        method: 'PUT',
        body: { tagIds: [one.id, two.id] },
      })

      await openTransactions(page)
      await searchList(page, 'Zztwo tags')
      const cell = txRows(page, 'Zztwo tags').getByTestId('transactions-cell-description')
      await expect(cell).toContainText('zz-one')
      await expect(cell).toContainText('zz-two')

      await openEditForm(page, 'Zztwo tags')
      expect(await formChips(page)).toEqual(['zz-one', 'zz-two'])
      await removeFormTag(page, 'zz-one')
      expect(await formChips(page)).toEqual(['zz-two'])
      await saveForm(page)
      await expect.poll(() => storedTagNames(m, id)).toEqual(['zz-two'])
      await expect(cell).not.toContainText('zz-one')
      await expect(cell).toContainText('zz-two')

      await openEditForm(page, 'Zztwo tags')
      await removeFormTag(page, 'zz-two')
      await expect(page.getByTestId('tx-tag-chip')).toHaveCount(0)
      await saveForm(page)
      await expect.poll(() => storedTagNames(m, id)).toEqual([])
      await expect(cell).not.toContainText('zz-')
      await expect(cell).toContainText('Zztwo tags')
    })

    test("3.9 a rule's auto tag and the form's own tag both stay on the row @release", async ({
      m,
    }) => {
      const { page } = m
      const category = await utilities(m)
      await addTag(m, 'zz-pick')

      // Tags page: a tag zz-auto, with a rule that auto-applies it to "zzrule" descriptions.
      await goPage(page, 'tags')
      const tagsPage = page.locator('.page-tags')
      await tagsPage.getByRole('button', { name: '+ New tag' }).click()
      await page.getByTestId('tag-name-input').fill('zz-auto')
      await tagsPage.getByRole('button', { name: 'Create', exact: true }).click()
      await expect.poll(() => tagCardsNamed(page, 'zz-auto'), { timeout: 20_000 }).toBe(1)
      const auto = await tagsNamed(m, m.a.id, 'zz-auto')
      expect(auto).toHaveLength(1)
      const autoId = auto[0].id
      await page.getByTestId(`tag-rules-${autoId}`).click()
      const editor = page.getByTestId('tag-rule-editor')
      await expect(editor).toBeVisible()
      await expect(
        editor.getByRole('checkbox', { name: 'Auto-apply to new transactions' })
      ).toBeChecked()
      await editor.getByPlaceholder('any text').first().fill('zzrule')
      await editor.getByRole('button', { name: 'Save rule' }).click()
      await expect(editor).toBeHidden()
      const rules =
        await m.api<{ tag_id: number; auto_apply: boolean | number }[]>('/api/tags/rules')
      expect(rules.filter((r) => r.tag_id === autoId && Boolean(r.auto_apply))).toHaveLength(1)

      // A matching transaction, with a different tag picked in the form.
      await openTransactions(page)
      await openAddForm(page)
      await fillForm(page, {
        description: 'Lantern zzrule supper',
        amount: 19,
        categoryId: category.id,
      })
      await pickFormTag(page, 'zz-pick')
      expect(await formChips(page)).toEqual(['zz-pick'])
      await saveForm(page)

      const stored = await txNamed(m, m.a.id, 'Lantern zzrule supper')
      await expect.poll(() => storedTagNames(m, stored.id)).toEqual(['zz-auto', 'zz-pick'])
      await searchList(page, 'Lantern zzrule supper')
      const cell = txRows(page, 'Lantern zzrule supper').getByTestId(
        'transactions-cell-description'
      )
      await expect(cell).toContainText('zz-auto')
      await expect(cell).toContainText('zz-pick')
    })
  })
}

localTest.describe('5.16.0 s3 transactions [local]', () => {
  localTest(
    "3.10 household view: the form offers and matches only the active profile's tags @release",
    async ({ m }) => {
      const { page } = m
      const low = await inProfile(m, m.b, (api) =>
        api<TagRow>('/api/tags', { method: 'POST', body: { name: 'zz-low', color: '#f59e0b' } })
      )
      await addTag(m, 'zz-mid')
      await tickProfile(page, m.b.id)
      await clickOutsideProfileMenu(page)
      expect(await storedSelection(page)).toEqual({
        current: m.a.id,
        selected: [m.a.id, m.b.id],
      })

      await openTransactions(page)
      await openAddForm(page)
      await showTagPicker(page)
      // The chips: the active profile's tags alone.
      expect(await formOffers(page)).toEqual(['zz-mid'])

      // Name matching: the other profile's tag name, in another case, is not that tag. It makes
      // a tag of the active profile's own.
      await enterFormTag(page, 'ZZ-LOW')
      await expect(page.getByTestId('tx-tag-chip')).toHaveText(['ZZ-LOW'])

      // And the save keeps it: before the fix, a picked foreign tag failed the tag save. The
      // account and category are picked by id: the household's lists hold both profiles'.
      const category = await categoryNamed(m, m.a.id, 'Utilities')
      const accountId = await firstAccountId(m, m.a.id)
      await fillForm(page, {
        description: 'Zzhouse lamp',
        amount: 21,
        categoryId: category.id,
        accountId,
      })
      await recordToasts(page)
      const seenBefore = (await toastsSeen(page)).length
      await saveForm(page)
      const stored = await txNamed(m, m.a.id, 'Zzhouse lamp')
      expect(await storedTagIds(m, stored.id)).not.toContain(low.id)
      expect(await storedTagNames(m, stored.id)).toEqual(['ZZ-LOW'])
      expect(
        (await toastsSeen(page))
          .slice(seenBefore)
          .filter((t) => /tags could not be saved/.test(t.text))
      ).toEqual([])
    }
  )
})
