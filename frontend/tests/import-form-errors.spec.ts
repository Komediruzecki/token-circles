/**
 * The Import page, in both storage modes: a file is uploaded, previewed and imported, and what is
 * wrong with a file, a link, a paste, a bank rule or a saved sheet is marked at its field.
 *
 * Each of those used to land somewhere other than its field: a file that could not be read and a
 * paste of one line were a banner at the top of the page, a link that was not a sheet's was a
 * toast, and a bank rule half filled in was dropped beside "Rules saved.". Now each is checked with
 * the rules both runtimes run (shared/importUpload.ts, shared/importSourceSchema.ts) or, for the
 * rules this browser keeps, core/bankImport/rulesCheck.ts, marked under its field in its own words,
 * and focused, and nothing is sent.
 *
 * Every case runs signed in (the Worker) and local-first (the IndexedDB router, on the demo data).
 * Signed in, an import goes into a profile of its own: the shared fixture profile is every spec's.
 * Pull requests run the `@smoke` ones; main runs them all.
 */
import { expect, test } from '@playwright/test'
import {
  E2E_BASE,
  firstProfileId,
  gotoServerless,
  isNetworkNoise,
  login,
  navigateToRoute,
} from './test-helpers'
import type { Locator, Page } from '@playwright/test'

type ModeName = 'cloud' | 'local-first'
const MODES: ModeName[] = ['cloud', 'local-first']

interface StoredRow {
  id: number
  name?: string
  label?: string
  description?: string
}

const toasts = (page: Page): Locator => page.getByRole('region', { name: 'Notifications' })
const errorToasts = (page: Page): Locator => toasts(page).getByRole('alert')

/** The setup wizard can open over an empty profile: leave it each time it shows up. */
async function leaveOnboarding(page: Page): Promise<void> {
  await page.addLocatorHandler(page.getByTestId('onboarding-wizard'), async () => {
    await page.getByTestId('onboarding-skip').click()
    const confirm = page.getByRole('button', { name: 'Confirm' })
    if (await confirm.isVisible({ timeout: 2_000 }).catch(() => false)) await confirm.click()
  })
}

/**
 * Opens the Import page. Signed in, `ownProfile` makes a profile named for the case first and
 * opens the app in it.
 */
async function openImport(
  page: Page,
  mode: ModeName,
  stamp: string,
  ownProfile: boolean
): Promise<void> {
  await leaveOnboarding(page)
  if (mode === 'local-first') {
    await gotoServerless(page, 'import', 'import-header')
    return
  }
  if (ownProfile) {
    const fixture = await firstProfileId(page)
    const res = await page.request.post(`${E2E_BASE}/api/profiles`, {
      headers: { 'X-Profile-Id': String(fixture) },
      data: { name: `zz-import-${stamp}` },
    })
    expect(res.ok(), `POST /api/profiles: ${res.status()}`).toBeTruthy()
    const { id } = (await res.json()) as StoredRow
    await page.addInitScript((profileId) => {
      localStorage.setItem('currentProfileId', String(profileId))
      localStorage.setItem('selectedProfileIds', JSON.stringify([profileId]))
    }, id)
  }
  await login(page)
  await navigateToRoute(page, 'import')
  await expect(page.getByTestId('import-header')).toBeVisible({ timeout: 30_000 })
}

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

/** Every import write the page sends over the network (local-first sends none). */
function watchImportWrites(page: Page): string[] {
  const writes: string[] = []
  page.on('request', (request) => {
    if (request.method() !== 'GET' && /^\/api\/import/.test(new URL(request.url()).pathname)) {
      writes.push(`${request.method()} ${request.url()}`)
    }
  })
  return writes
}

/** A read through the app's own API client, in whichever storage mode the page runs. */
async function readViaApp<T>(page: Page, url: string): Promise<T> {
  const answer = await page.evaluate(async (path) => {
    const spec = '/src/core/api.ts'
    const mod = (await import(/* @vite-ignore */ spec)) as {
      apiGet: (url: string) => Promise<unknown>
    }
    return mod.apiGet(path)
  }, url)
  return answer as T
}

/** The transactions whose description has `stamp` in it. */
async function importedRows(page: Page, stamp: string): Promise<StoredRow[]> {
  const listed = await readViaApp<StoredRow[] | { rows?: StoredRow[] }>(
    page,
    `/api/transactions?search=${stamp}`
  )
  const rows = Array.isArray(listed) ? listed : (listed.rows ?? [])
  return rows.filter((row) => row.description?.includes(stamp))
}

/**
 * Takes out of the Worker's database what a case made, whether or not the case got that far: the
 * profile an import went into, with its rows, and any sheet saved in the fixture profile. They
 * belong to the account every spec shares, which outlives a local run. Local-first keeps
 * everything in the test's own browser, which goes with it.
 */
async function sweep(page: Page, mode: ModeName, stamp: string): Promise<void> {
  if (mode !== 'cloud' || !stamp) return
  const fixture = await firstProfileId(page)
  const asFixture = { headers: { 'X-Profile-Id': String(fixture) } }
  const profiles = (await (
    await page.request.get(`${E2E_BASE}/api/profiles`, asFixture)
  ).json()) as StoredRow[]
  for (const profile of profiles.filter((p) => p.name?.includes(stamp))) {
    await page.request.delete(`${E2E_BASE}/api/profiles/${profile.id}`, asFixture)
  }
  const sources = (await (
    await page.request.get(`${E2E_BASE}/api/import-sources`, asFixture)
  ).json()) as StoredRow[]
  for (const source of sources.filter((s) => s.label?.includes(stamp))) {
    await page.request.delete(`${E2E_BASE}/api/import-sources/${source.id}`, asFixture)
  }
}

/**
 * A zip's signature, which is how an .xlsx starts, and nothing after it a sheet can be read from:
 * the bytes the Worker's and the form's own tests use.
 */
const BROKEN_XLSX = Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0, 0, 0])
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

const ledger = (stamp: string): string =>
  [
    'Date,Description,Amount,Category,Type',
    `2026-07-01,zz-salary-${stamp},2000.00,Salary,income`,
    `2026-07-02,zz-groceries-${stamp},-52.30,Groceries,expense`,
    `2026-07-03,zz-coffee-${stamp},-3.20,Dining,expense`,
  ].join('\n')

for (const mode of MODES) {
  test.describe(`the Import page, ${mode}`, () => {
    /** In the name of everything a case makes, so `sweep` can find it. */
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

    test('a file the runtime cannot read is marked under the drop area, and a good one is read, previewed and imported @smoke', async ({
      page,
    }) => {
      const errors = watchErrors(page)
      await openImport(page, mode, stamp, true)
      await page.getByTestId('import-tab-file-upload').click()
      const input = page.getByTestId('import-file-input')
      const file = page.getByTestId('import-upload-form').getByLabel('File to import', {
        exact: true,
      })

      await input.setInputFiles({
        name: `broken-${stamp}.xlsx`,
        mimeType: XLSX_TYPE,
        buffer: BROKEN_XLSX,
      })

      await expect(file).toHaveAttribute('aria-invalid', 'true')
      await expect(file).toHaveAccessibleDescription(
        "That file couldn't be read. Upload a CSV or Excel file."
      )
      await expect(file).toBeFocused()
      await expect(page.getByTestId('import-map-date')).toHaveCount(0)
      await expect(errorToasts(page)).toHaveCount(0)

      await input.setInputFiles({
        name: `ledger-${stamp}.csv`,
        mimeType: 'text/csv',
        buffer: Buffer.from(ledger(stamp)),
      })

      // The mapping step, with the columns found by their names.
      await expect(page.getByTestId('import-map-date')).toHaveValue('0', { timeout: 30_000 })
      await expect(page.getByTestId('import-map-description')).toHaveValue('1')
      await expect(page.getByTestId('import-map-amount')).toHaveValue('2')
      await page.getByTestId('import-continue-preview').click()

      await expect(page.getByTestId('import-preview-total')).toHaveText('3', { timeout: 30_000 })
      await page.getByTestId('import-execute-all').click()

      await expect(page.getByTestId('import-result')).toContainText('Imported 3', {
        timeout: 30_000,
      })
      expect((await importedRows(page, stamp)).map((row) => row.description).sort()).toEqual([
        `zz-coffee-${stamp}`,
        `zz-groceries-${stamp}`,
        `zz-salary-${stamp}`,
      ])
      await expect(errorToasts(page)).toHaveCount(0)
      expect(errors).toEqual([])
    })

    test('a link, a paste, a bank rule and a sheet to save are marked at their fields, and nothing is sent', async ({
      page,
    }) => {
      const errors = watchErrors(page)
      // Nothing is written, so signed in it runs in the fixture profile.
      await openImport(page, mode, stamp, false)
      const writes = watchImportWrites(page)

      // A Google Sheets link that is not a sheet's.
      await page.getByTestId('import-tab-google-sheets').click()
      const link = page.getByTestId('import-sheet-form').getByLabel('Google Sheets link', {
        exact: true,
      })
      await link.fill('https://example.com/not-a-sheet')
      await page.getByTestId('import-sheet-fetch').click()

      await expect(link).toHaveAttribute('aria-invalid', 'true')
      await expect(link).toHaveAccessibleDescription(
        'Paste the link to a Google Sheet. It starts with https://docs.google.com/spreadsheets/d/.'
      )
      await expect(link).toBeFocused()

      // A paste with a header and no row of data under it.
      await page.getByTestId('import-tab-paste-csv').click()
      const pasted = page.getByTestId('import-paste-form').getByLabel('Pasted rows', {
        exact: true,
      })
      await pasted.fill('date,description,amount')
      await page.getByTestId('import-paste-parse').click()

      await expect(pasted).toHaveAttribute('aria-invalid', 'true')
      await expect(pasted).toHaveAccessibleDescription(
        'Paste a header row and at least one row of data under it, like "date,description,amount".'
      )
      await expect(pasted).toBeFocused()
      await expect(page.getByTestId('import-continue-mapping')).toHaveCount(0)

      // A bank rule with a category and no keyword.
      await page.getByTestId('import-tab-bank-imports').click()
      await page.getByRole('button', { name: 'Edit categorization & transfer rules' }).click()
      await page.getByRole('button', { name: 'Add category rule' }).click()
      const rule = page.getByTestId('bank-rule-row').last()
      await rule.getByLabel('Category', { exact: true }).fill(`zz-rule-${stamp}`)
      await page.getByTestId('bank-rules-save').click()

      const keywords = rule.getByLabel('Keywords', { exact: true })
      await expect(keywords).toHaveAttribute('aria-invalid', 'true')
      await expect(keywords).toHaveAccessibleDescription(
        'Add a keyword to match, like "konzum", or remove the rule.'
      )
      await expect(keywords).toBeFocused()
      await expect(page.getByTestId('bank-rules-confirmation')).toHaveCount(0)
      const kept = await page.evaluate(async () => {
        const spec = '/src/core/bankImport/index.ts'
        const mod = (await import(/* @vite-ignore */ spec)) as {
          loadCategoryRules: () => { category: string }[]
        }
        return mod.loadCategoryRules().map((saved) => saved.category)
      })
      expect(kept).not.toContain(`zz-rule-${stamp}`)

      // A sheet to save, with a link that is not a sheet's and a name too long to keep.
      await page.getByRole('button', { name: 'Add a sheet' }).click()
      const addForm = page.getByTestId('source-add-form')
      const sourceLink = addForm.getByLabel('Google Sheets link', { exact: true })
      const sourceName = addForm.getByLabel('Name', { exact: true })
      await sourceLink.fill('not a link')
      await sourceName.fill(`zz-source-${stamp}-${'x'.repeat(200)}`)
      await page.getByTestId('source-save').click()

      await expect(sourceLink).toHaveAccessibleDescription(
        'Paste the link to a Google Sheet. It starts with https://docs.google.com/spreadsheets/d/.'
      )
      await expect(sourceName).toHaveAccessibleDescription(
        'Keep the name to 200 characters or fewer.'
      )
      await expect(sourceLink).toBeFocused()

      expect(writes).toEqual([])
      const sources = await readViaApp<StoredRow[]>(page, '/api/import-sources')
      expect(sources.filter((source) => source.label?.includes(stamp))).toEqual([])
      await expect(errorToasts(page)).toHaveCount(0)
      expect(errors).toEqual([])
    })
  })
}
