/**
 * Release scope 5.16.0, section 4: Import (#578, #582).
 *
 * Statements are made up here (import-helpers.ts): the Revolut format the importer detects, with
 * invented merchants and round amounts. The categorization rules the editor shows are kept in
 * this browser, per profile (core/bankImport/rulesStore.ts), not on the server, so the cases
 * arrange them in localStorage, where the app reads them.
 */
import {
  acceptConfirm,
  accountCard,
  accountsOf,
  allFetchesFrom,
  arrangeAccountOf,
  arrangeCategory,
  describeFetch,
  expectGets,
  getsDuring,
  localIso,
  reloadOn,
  settledValue,
  shownPage,
} from './follow-helpers'
import {
  addBankStatement,
  arrangeImportRules,
  dataVersions,
  importAccountOptions,
  openRulesEditor,
  previewStatement,
  recentImports,
  revolutStatement,
  rulesShown,
  storedImportRules,
} from './import-helpers'
import { commandBarExpense } from './page-handles'
import { both, cloudTest, expect } from './release-fixtures'
import { goPage, switchProfile } from './release-helpers'
import type { Locator, Page } from '@playwright/test'
import type { FetchEntry } from './follow-helpers'
import type { Mode } from './release-fixtures'

/** Two card payments, described so no other case's rows look like them. */
function statementFor(m: Mode): string {
  return revolutStatement([
    { date: localIso(-2), description: `Zz Corner Bakery${m.suffix}`, amount: -12 },
    { date: localIso(-1), description: `Zz Fuel Stop${m.suffix}`, amount: -40 },
  ])
}

function fileFor(m: Mode, what: string): string {
  return `zz-${what}${m.suffix.replace(/\s+/g, '-')}.csv`
}

/** Rows of the active profile that came from this case's statement. */
async function statementRows(m: Mode): Promise<{ description: string }[]> {
  const rows = await m.rows<{ description?: string }>('transactions', m.a.id)
  return rows
    .filter((r) => /^Zz (Corner Bakery|Fuel Stop)/.test(r.description ?? ''))
    .filter((r) => (r.description ?? '').endsWith(m.suffix))
    .map((r) => ({ description: r.description ?? '' }))
}

/** What each profile has saved: a different rule on every field the editor shows. */
const RULES_A = [{ category: 'zz-Bakery', keywords: ['zz-bread', 'zz-loaf'] }]
const RULES_B = [{ category: 'zz-Fuel', keywords: ['zz-petrol'] }]
const SHOWN_A = [{ category: 'zz-Bakery', keywords: 'zz-bread, zz-loaf' }]
const SHOWN_B = [{ category: 'zz-Fuel', keywords: 'zz-petrol' }]

/** Import > Bank imports, on screen, for the rules editor. */
async function bankImportsTab(page: Page): Promise<Locator> {
  await goPage(page, 'import', 'import-header')
  const scope = shownPage(page)
  await scope.getByTestId('import-tab-bank-imports').click()
  return scope
}

/** Settings > About > relaunch the setup wizard, then forward to its import step. */
async function wizardImportStep(page: Page): Promise<Locator> {
  await goPage(page, 'settings', 'settings-header')
  await page.getByTestId('settings-tab-about').click()
  await page.getByTestId('settings-run-onboarding').click()
  const wizard = page.getByTestId('onboarding-wizard')
  await expect(wizard).toBeVisible()
  // welcome > space > account > import, each forward with the footer's primary button.
  for (const step of ['welcome', 'space', 'account']) {
    await expect(wizard.getByTestId(`onboarding-step-${step}`)).toBeVisible({ timeout: 15_000 })
    const next = wizard.getByTestId('onboarding-next')
    await expect(next).toBeEnabled({ timeout: 15_000 })
    await next.click()
  }
  await expect(wizard.getByTestId('onboarding-step-import')).toBeVisible({ timeout: 15_000 })
  return wizard
}

async function leaveWizard(page: Page): Promise<void> {
  const wizard = page.getByTestId('onboarding-wizard')
  await wizard.getByTestId('onboarding-skip').click()
  await acceptConfirm(page)
  await expect(wizard).toBeHidden()
}

/** A request the Import page made itself: its flow or the page component called fetch. */
const IMPORT_OWN = /\/src\/features\/(?:import\/|Import\.tsx)/
/** A read made by the badge evaluator (core/achievementsStore.ts). */
const BADGES = /achievements/i

/** Import with a statement on its preview step, and the requests the preview set off. */
async function previewRequests(m: Mode): Promise<FetchEntry[]> {
  const { page } = m
  const account = `zz-prev${m.suffix}`
  await arrangeAccountOf(m, { name: account, type: 'giro', balance: 1000 })
  await reloadOn(page, 'import', 'import-header')
  await addBankStatement(page, fileFor(m, 'preview'), statementFor(m))
  const since = await allFetchesFrom(page)
  await previewStatement(page, account, 2)
  return since()
}

for (const [pass, test] of both) {
  test.describe(`5.16.0 s4 import [${pass}]`, () => {
    test('4.1 an account created in place is offered and picked at once @release', async ({
      m,
    }) => {
      const { page } = m
      const name = `zz-inplace${m.suffix}`
      await addBankStatement(page, fileFor(m, 'inplace'), statementFor(m))
      const picker = page.getByTestId('bank-target-account').first()
      // The statement's account is not one the app knows.
      await expect(picker).toHaveValue('')
      expect(await importAccountOptions(page)).not.toContain(name)

      await picker.selectOption('__create-account__')
      const form = page.getByTestId('account-select-create')
      await expect(form).toBeVisible()
      await form.getByTestId('account-select-name').fill(name)
      await form.getByTestId('account-select-submit').click()
      await expect(form).toBeHidden({ timeout: 15_000 })

      // Selected, and offered, without leaving the page. Read once the pickers' list has
      // refetched for the new account: the choice has to survive that refetch too.
      await expect(picker).toHaveValue(name)
      expect(await settledValue(page, () => picker.inputValue())).toBe(name)
      expect(await importAccountOptions(page)).toContain(name)
      expect((await accountsOf(m)).map((a) => a.name)).toContain(name)
    })

    test('4.2 a preview writes nothing and no other page refetches @release', async ({ m }) => {
      const { page } = m
      const account = `zz-prev${m.suffix}`
      await arrangeAccountOf(m, { name: account, type: 'giro', balance: 1000 })
      // The pages a transaction write reaches, mounted first.
      await reloadOn(page, 'dashboard', 'dashboard-container')
      await goPage(page, 'transactions', 'transactions-header')
      await goPage(page, 'accounts', 'accounts-header')
      await expect(accountCard(page, account)).toHaveCount(1)
      const stored = async () => ({
        transactions: (await m.rows('transactions', m.a.id)).length,
        accounts: (await m.rows('accounts', m.a.id)).length,
        categories: (await m.rows('categories', m.a.id)).length,
      })
      const before = await stored()

      await addBankStatement(page, fileFor(m, 'preview'), statementFor(m))
      const versions0 = await settledValue(page, () => dataVersions(page))
      const since = await allFetchesFrom(page)
      await previewStatement(page, account, 2)

      // Nothing was invalidated: no page is told to refetch, in either mode.
      const versions1 = await settledValue(page, () => dataVersions(page))
      expect(versions1, 'data counters after the preview').toEqual(versions0)
      if (m.kind === 'cloud') {
        const requests = await since()
        const log = requests.map(describeFetch).join('\n    ')
        expect(
          requests.filter((r) => r.method === 'POST' && /\/api\/import\/execute\?/.test(r.url)),
          `the preview dry-runs the import once:\n    ${log}`
        ).toHaveLength(1)
        // The badge evaluator's reads may follow here: 4.2b pins them.
        expect(
          requests
            .filter((r) => !IMPORT_OWN.test(r.stack) && !BADGES.test(r.stack))
            .map(describeFetch),
          `nothing but Import's own requests from the preview on:\n    ${log}`
        ).toEqual([])
      }
      // Nothing was written.
      expect(await stored()).toEqual(before)
      expect(await statementRows(m)).toEqual([])

      // And the mounted pages show without asking for anything.
      for (const [route, ready] of [
        ['dashboard', 'dashboard-container'],
        ['transactions', 'transactions-header'],
        ['accounts', 'accounts-header'],
      ] as const) {
        const asked = await getsDuring(m, /^\/api\//, async () => {
          await goPage(page, route, ready)
        })
        expectGets(m, asked, 0, `showing ${route} after the preview asks for nothing`)
      }
    })

    test('4.3 the import history follows an import and its undo @release', async ({ m }) => {
      const { page } = m
      const account = `zz-hist${m.suffix}`
      const file = fileFor(m, 'history')
      await arrangeAccountOf(m, { name: account, type: 'giro', balance: 1000 })
      await reloadOn(page, 'import', 'import-header')
      const entry = recentImports(page).filter({ hasText: file })
      const others = await recentImports(page).count()

      await addBankStatement(page, file, statementFor(m))
      await previewStatement(page, account, 2)
      await page.getByTestId('import-execute-all').click()
      await expect(page.getByTestId('import-result')).toContainText('Imported 2', {
        timeout: 20_000,
      })
      expect(await statementRows(m)).toHaveLength(2)

      // The flow returns to the upload step by itself; the history lists the import.
      await expect(entry).toHaveCount(1, { timeout: 15_000 })
      await expect(entry.locator('summary')).toContainText('2 imported')
      await expect(recentImports(page)).toHaveCount(others + 1)

      // Undo it: the history drops it, and its transactions go with it.
      await entry.locator('summary').click()
      await entry.getByRole('button', { name: 'Delete import' }).click()
      await acceptConfirm(page)
      await expect(entry).toHaveCount(0, { timeout: 15_000 })
      await expect(recentImports(page)).toHaveCount(others)
      expect(await statementRows(m)).toEqual([])
    })

    test('4.4 the rules editor shows the active profile’s rules after a switch @release', async ({
      m,
    }) => {
      const { page } = m
      await arrangeImportRules(page, m.a.id, RULES_A)
      await arrangeImportRules(page, m.b.id, RULES_B)
      const editor = await bankImportsTab(page)
      await openRulesEditor(editor)
      expect(await rulesShown(editor)).toEqual(SHOWN_A)

      await switchProfile(page, m.b.id)
      await openRulesEditor(editor)
      await expect.poll(() => rulesShown(editor)).toEqual(SHOWN_B)
    })

    test('4.5 an unsaved rule edit survives a quick add @release', async ({ m }) => {
      const { page } = m
      const category = `zz-qa${m.suffix}`
      await arrangeCategory(m, category)
      await arrangeImportRules(page, m.a.id, RULES_A)
      // A reload, so quick add offers the category arranged above.
      await reloadOn(page, 'import', 'import-header')
      const editor = await bankImportsTab(page)
      await openRulesEditor(editor)
      expect(await rulesShown(editor)).toEqual(SHOWN_A)
      const keywords = editor.getByPlaceholder('keyword1, keyword2, ...').first()
      const edited = 'zz-bread, zz-loaf, zz-crumb'
      await keywords.fill(edited)

      await commandBarExpense(page, 'zz snack 5', category)

      // Still the edit, once whatever the quick add set off has settled; and still unsaved.
      expect(await settledValue(page, () => keywords.inputValue())).toBe(edited)
      expect(await storedImportRules(page, m.a.id)).toEqual(RULES_A)
    })

    test('4.6 saving rules on one profile leaves the other’s alone @release', async ({ m }) => {
      const { page } = m
      await arrangeImportRules(page, m.a.id, RULES_A)
      await arrangeImportRules(page, m.b.id, RULES_B)
      // The editor loaded on the first profile, then the switch.
      const editor = await bankImportsTab(page)
      await openRulesEditor(editor)
      expect(await rulesShown(editor)).toEqual(SHOWN_A)
      await switchProfile(page, m.b.id)
      await expect.poll(() => rulesShown(editor)).toEqual(SHOWN_B)

      await editor.getByPlaceholder('keyword1, keyword2, ...').first().fill('zz-petrol, zz-diesel')
      await editor.getByTestId('bank-rules-save').click()
      await expect(editor.getByTestId('bank-rules-confirmation')).toHaveText(/Rules saved/)
      expect(await storedImportRules(page, m.b.id)).toEqual([
        { category: 'zz-Fuel', keywords: ['zz-petrol', 'zz-diesel'] },
      ])
      expect(await storedImportRules(page, m.a.id)).toEqual(RULES_A)

      await switchProfile(page, m.a.id)
      await openRulesEditor(editor)
      await expect.poll(() => rulesShown(editor)).toEqual(SHOWN_A)
    })

    test('4.7 the wizard relaunched on another profile shows that profile’s rules @release', async ({
      m,
    }) => {
      const { page } = m
      await arrangeImportRules(page, m.a.id, RULES_A)
      await arrangeImportRules(page, m.b.id, RULES_B)
      await reloadOn(page, 'settings', 'settings-header')

      // The first visit, on the first profile.
      const wizard = await wizardImportStep(page)
      await openRulesEditor(wizard)
      expect(await rulesShown(wizard)).toEqual(SHOWN_A)
      await leaveWizard(page)

      // Relaunched on the other.
      await switchProfile(page, m.b.id)
      await wizardImportStep(page)
      await openRulesEditor(wizard)
      await expect.poll(() => rulesShown(wizard)).toEqual(SHOWN_B)
      await leaveWizard(page)
    })
  })
}

// 4.2b counts requests, which only cloud makes.
cloudTest.describe('5.16.0 s4 import [cloud]', () => {
  cloudTest(
    '4.2b nothing follows a preview but Import’s own requests, badge evaluation included @release',
    async ({ m }) => {
      // The preview's dry run is a POST. apiFetch announces every successful non-GET as a write
      // (announceWrite, core/apiFetch.ts), and announceDataChanged (core/dataChangedEvent.ts:33)
      // only leaves out /api/settings: it does not share dataVersions' READS_SENT_AS_POST
      // (core/dataVersions.ts:135), which is why the counters stay put. So AchievementsHost
      // re-evaluates every badge after a preview: eight reads in cloud, for a write that never
      // happened. New in 5.16: #574 moved the event from the typed client's request(), which the
      // import flow never calls, into apiFetch. Not in section 9.
      cloudTest.fail(
        true,
        'a preview sets off a badge evaluation (dataChangedEvent.ts:33 skips only /api/settings)'
      )
      const requests = await previewRequests(m)
      const log = requests.map(describeFetch).join('\n    ')
      expect(
        requests.filter((r) => !IMPORT_OWN.test(r.stack)).map(describeFetch),
        `nothing but Import's own requests from the preview on:\n    ${log}`
      ).toEqual([])
    }
  )
})
