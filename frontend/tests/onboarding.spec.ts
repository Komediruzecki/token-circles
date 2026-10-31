/**
 * Onboarding wizard e2e, local-first.
 *
 * Zero-state boots (no demo seed, no profiles) open the wizard: the state a new signup lands in.
 * It has three counted steps: the space (its name, then About this space while the benchmarks
 * gate shows it), the main account, and a statement, which goes on to the subscriptions it shows
 * only when it imported something. The @smoke cases walk the core path, the first import and the
 * way out for a file the step cannot import; the rest cover skip and relaunch, the phone layout
 * and the colours.
 *
 * The signed-in wizard, whose record is on the account, is onboarding-server.spec.ts.
 */
import { expect, test } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { paintedContrast } from './painted-contrast'
import { gotoServerless, gotoServerlessZeroState } from './test-helpers'
import type { Locator, Page } from '@playwright/test'

/** The active profile's guidance answers, as local-first keeps them: `guidance:<profile id>`. */
async function storedAnswers(page: Page): Promise<unknown> {
  return page.evaluate(
    () =>
      new Promise((resolve) => {
        const key = `guidance:${localStorage.getItem('currentProfileId') ?? '1'}`
        const req = indexedDB.open('finance-manager')
        req.onsuccess = () => {
          const db = req.result
          const get = db.transaction('settings', 'readonly').objectStore('settings').get(key)
          get.onsuccess = () => {
            const value = (get.result as { value?: string } | undefined)?.value
            resolve(value === undefined ? null : JSON.parse(value))
            db.close()
          }
          get.onerror = () => {
            resolve(null)
            db.close()
          }
        }
        req.onerror = () => resolve(null)
      })
  )
}

/** Leave the wizard and open Settings, General, at About this space. */
async function aboutThisSpace(page: Page): Promise<void> {
  await page.getByTestId('onboarding-skip').click()
  await page.getByTestId('confirm-accept').click()
  await expect(page.getByTestId('onboarding-wizard')).toHaveCount(0)
  await page.evaluate(() => {
    window.location.hash = 'settings'
  })
  await expect(page.getByTestId('settings-about-space')).toBeVisible({ timeout: 30000 })
}

/** The space's name screen, Continue, then About this space: the second screen of step 1. */
async function toAbout(page: Page): Promise<void> {
  await expect(page.getByTestId('onboarding-step-space')).toBeVisible()
  await expect(page.getByTestId('onboarding-profile-name')).toHaveValue('Personal Profile')
  await page.getByTestId('onboarding-next').click()
  await expect(page.getByTestId('onboarding-step-about')).toBeVisible()
}

/** On from the space to the account step, the space as it was offered. */
async function toAccount(page: Page): Promise<void> {
  await toAbout(page)
  await page.getByTestId('onboarding-next').click()
  await expect(page.getByTestId('onboarding-step-account')).toBeVisible()
}

/** On to the statement step, past the account with nothing typed (Skip asks nothing then). */
async function toStatement(page: Page): Promise<void> {
  await toAccount(page)
  await page.getByTestId('onboarding-account-skip').click()
  await expect(page.getByTestId('onboarding-step-import')).toBeVisible()
  await expect(page.getByTestId('confirm-accept')).toHaveCount(0)
}

/** A table no bank adapter reads: the statement step's way out. */
const UNKNOWN_TABLE = {
  name: 'export.csv',
  mimeType: 'text/csv',
  buffer: Buffer.from('When,What,How much\n2026-06-01,Groceries,-10.00\n2026-06-02,Bus,-2.50\n'),
}

/** The chosen file's card, once it is in `state`. */
async function fileIn(page: Page, state: string): Promise<Locator> {
  const card = page.getByTestId('onboarding-import-file')
  await expect(card).toHaveAttribute('data-state', state, { timeout: 20000 })
  return card
}

/** The footer's buttons, in order: [test id, label]. */
async function footerButtons(page: Page): Promise<string[][]> {
  return page
    .getByTestId('onboarding-panel')
    .locator('footer button')
    .evaluateAll((buttons) =>
      buttons.map((b) => [b.getAttribute('data-test-id') ?? '', (b.textContent ?? '').trim()])
    )
}

test.describe('onboarding wizard', () => {
  test('@smoke opens on its space step for a pristine user and completes the core path', async ({
    page,
  }) => {
    await gotoServerlessZeroState(page, 'dashboard', 'onboarding-wizard')

    // Your space: the name and base currency. The first screen has nothing to go back to.
    await expect(page.getByTestId('onboarding-step-space')).toBeVisible()
    await expect(page.getByTestId('onboarding-progress')).toHaveText('Step 1 of 3')
    await expect(page.getByTestId('onboarding-back')).toHaveCount(0)
    const nameInput = page.getByTestId('onboarding-profile-name')
    await expect(nameInput).toHaveValue('Personal Profile')
    await nameInput.fill('My Money')
    await page.getByTestId('onboarding-currency').selectOption('EUR')
    await page.getByTestId('onboarding-next').click()

    // About this space: the same step, its second screen.
    await expect(page.getByTestId('onboarding-step-about')).toBeVisible()
    await expect(page.getByTestId('onboarding-progress')).toHaveText('Step 1 of 3')
    await page.getByTestId('onboarding-next').click()

    // The main account: adding it is the step's one action, and moves on.
    await expect(page.getByTestId('onboarding-step-account')).toBeVisible()
    await expect(page.getByTestId('onboarding-progress')).toHaveText('Step 2 of 3')
    await page.getByTestId('onboarding-account-name').fill('Main Checking')
    await page.getByTestId('onboarding-account-balance').fill('1500')
    await page.getByTestId('onboarding-account-create').click()

    // A statement: none, so Skip goes straight to Done, past subscriptions there is nothing to
    // find in.
    await expect(page.getByTestId('onboarding-step-import')).toBeVisible()
    await expect(page.getByTestId('onboarding-progress')).toHaveText('Step 3 of 3')
    expect(await footerButtons(page)).toEqual([
      ['onboarding-import-skip', 'Skip'],
      ['onboarding-import-choose', 'Choose a file'],
    ])
    await page.getByTestId('onboarding-import-skip').click()

    // Done: what the visit made, then the dashboard.
    await expect(page.getByTestId('onboarding-step-done')).toBeVisible()
    await expect(page.getByTestId('onboarding-progress')).toHaveCount(0)
    await expect(page.getByTestId('onboarding-done-summary')).toHaveText('My Money has 1 account.')
    await page.getByTestId('onboarding-finish').click()
    await expect(page.getByTestId('onboarding-wizard')).toHaveCount(0)
    await expect(page.getByTestId('dashboard-header')).toBeVisible()

    // The account exists, the profile is renamed, the flag is stamped.
    await page.evaluate(() => {
      window.location.hash = 'accounts'
    })
    await expect(page.getByTestId('accounts-header')).toBeVisible()
    await expect(page.getByTestId('account-card').first()).toContainText('Main Checking')
    const flag = await page.evaluate(() => localStorage.getItem('finance_onboarding:local'))
    expect(flag).toBe('completed')
  })

  test('@smoke reads a statement, imports it in one tap, and tracks the subscriptions it shows', async ({
    page,
  }) => {
    await gotoServerlessZeroState(page, 'dashboard', 'onboarding-wizard')
    await toAccount(page)
    await page.getByTestId('onboarding-account-name').fill('Main Checking')
    await page.getByTestId('onboarding-account-create').click()
    await expect(page.getByTestId('onboarding-step-import')).toBeVisible()

    // The banks it reads, and the way any other file goes.
    await expect(page.getByTestId('onboarding-import-banks')).toContainText('Revolut')
    await page
      .getByTestId('onboarding-import-input')
      .setInputFiles('tests/fixtures/revolut-sample.csv')

    // Read with the bank's own columns: what goes in, and where, before the one tap.
    await fileIn(page, 'ready')
    await expect(page.getByTestId('onboarding-import-meta')).toHaveText(
      /^Revolut · 7 new transactions · 14 Apr( 2026)? to 1 Jul( 2026)?$/
    )
    const target = page.getByTestId('onboarding-import-target')
    await expect(target).toHaveValue('Main Checking')
    await expect(page.getByTestId('onboarding-import-categories')).toHaveText(/^New categories: /)
    expect(await footerButtons(page)).toEqual([
      ['onboarding-import-skip', 'Skip'],
      ['onboarding-import-selected', 'Import 7'],
    ])
    await page.getByTestId('onboarding-import-selected').click()

    // Subscriptions, found in what came in: the footer's one action tracks the ticked ones.
    await expect(page.getByTestId('onboarding-step-subscriptions')).toBeVisible({ timeout: 15000 })
    const netflixRow = page.locator('[data-test-id="sub-scan-row"][data-name="Netflix"]')
    await expect(netflixRow).toBeVisible({ timeout: 15000 })
    await expect(page.locator('[data-test-id="sub-scan-row"][data-name="Spotify"]')).toBeVisible()
    await expect(page.getByTestId('sub-scan-add-btn')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Rescan' })).toHaveCount(0)
    const track = page.getByTestId('onboarding-subs-add-continue')
    await expect(track).toHaveText('Track 2 subscriptions')
    await track.click()

    // Done says what went in, and no toast covered the wizard on the way.
    await expect(page.getByTestId('onboarding-step-done')).toBeVisible()
    await expect(page.getByTestId('onboarding-done-summary')).toHaveText(
      'Personal Profile has 1 account, 7 new transactions and 2 tracked subscriptions.'
    )
    await expect(page.getByText('2 subscriptions added')).toHaveCount(0)
    await page.getByTestId('onboarding-finish').click()
    await expect(page.getByTestId('onboarding-wizard')).toHaveCount(0)

    // The subscriptions are tracked in Bills.
    await page.evaluate(() => {
      window.location.hash = 'bills'
    })
    await expect(page.getByTestId('bills-header')).toBeVisible()
    await page.getByTestId('bills-tab-subscriptions').click()
    await expect(page.locator('.page-bills').getByText('Netflix').first()).toBeVisible()
    await expect(page.locator('.page-bills').getByText('Spotify').first()).toBeVisible()
  })

  test('@smoke a file it cannot import opens on the Import page with that file, and setup finishes', async ({
    page,
  }) => {
    await gotoServerlessZeroState(page, 'dashboard', 'onboarding-wizard')
    await toStatement(page)
    await page.getByTestId('onboarding-import-input').setInputFiles(UNKNOWN_TABLE)

    await fileIn(page, 'unreadable')
    await expect(page.getByTestId('onboarding-import-problem')).toHaveText(
      "We don't recognise the bank in this file. The Import page reads it once you match its columns."
    )
    expect(await footerButtons(page)).toEqual([
      ['onboarding-import-skip', 'Skip'],
      ['onboarding-import-open', 'Open in Import'],
    ])
    await page.getByTestId('onboarding-import-open').click()

    // Setup is finished, and Import has read the file, on to matching its columns.
    await expect(page.getByTestId('onboarding-wizard')).toHaveCount(0)
    await expect(page.getByTestId('import-header')).toBeVisible({ timeout: 30000 })
    await expect(page.getByTestId('import-map-date')).toBeVisible({ timeout: 20000 })
    for (const column of ['When', 'What', 'How much']) {
      await expect(
        page.getByTestId('import-map-date').locator('option', { hasText: column })
      ).toHaveCount(1)
    }
    expect(await page.evaluate(() => localStorage.getItem('finance_onboarding:local'))).toBe(
      'completed'
    )
  })

  test('a file it cannot import can be left behind: Skip goes on to Done without asking', async ({
    page,
  }) => {
    await gotoServerlessZeroState(page, 'dashboard', 'onboarding-wizard')
    await toStatement(page)
    await page.getByTestId('onboarding-import-input').setInputFiles(UNKNOWN_TABLE)
    await fileIn(page, 'unreadable')

    await page.getByTestId('onboarding-import-skip').click()

    await expect(page.getByTestId('onboarding-step-done')).toBeVisible()
    await expect(page.getByTestId('confirm-accept')).toHaveCount(0)
    await expect(page.getByTestId('onboarding-done-summary')).toHaveText(
      'Personal Profile is ready.'
    )
  })

  test('Skip with a statement ready asks first, and Keep it stays', async ({ page }) => {
    await gotoServerlessZeroState(page, 'dashboard', 'onboarding-wizard')
    await toStatement(page)
    await page
      .getByTestId('onboarding-import-input')
      .setInputFiles('tests/fixtures/revolut-sample.csv')
    await fileIn(page, 'ready')

    await page.getByTestId('onboarding-import-skip').click()
    await expect(page.getByRole('alertdialog')).toContainText(
      'Leave this statement out? Nothing from it is imported. The Import page can bring it in later.'
    )
    await page.getByTestId('confirm-cancel').click()
    await fileIn(page, 'ready')

    await page.getByTestId('onboarding-import-skip').click()
    await page.getByTestId('confirm-accept').click()
    await expect(page.getByTestId('onboarding-step-done')).toBeVisible()
    await expect(page.getByTestId('onboarding-done-summary')).toHaveText(
      'Personal Profile is ready.'
    )
  })

  test('asks where you live and who the space covers, and Settings changes the answers', async ({
    page,
  }) => {
    await gotoServerlessZeroState(page, 'dashboard', 'onboarding-wizard')
    await toAbout(page)
    await expect(page.getByTestId('onboarding-space-region')).toContainText('Where do you live?')
    await page.getByTestId('onboarding-space-region-HR').click()
    await page.getByTestId('onboarding-space-adults-2').click()
    await page.getByTestId('onboarding-space-children-0').click()
    await expect(page.getByRole('radio', { name: 'Croatia' })).toBeChecked()
    await page.getByTestId('onboarding-next').click()
    await expect(page.getByTestId('onboarding-step-account')).toBeVisible()
    await expect.poll(() => storedAnswers(page)).toEqual({ region: 'HR', adults: 2, children: 0 })

    await aboutThisSpace(page)
    const about = page.getByTestId('about-this-space')
    await expect(about.getByRole('radio', { name: 'Croatia' })).toBeChecked()
    await expect(page.getByTestId('settings-space-region-note')).toHaveText(
      'Compared with Croatia, from your answer.'
    )
    await expect(page.getByTestId('settings-space-adults-2').getByRole('radio')).toBeChecked()
    await expect(page.getByTestId('settings-space-household-note')).toHaveText(
      '2 adults, no children.'
    )

    // A change is saved at once, and survives a reload.
    await page.getByTestId('settings-space-region-DE').click()
    await expect(page.getByTestId('settings-space-region-note')).toHaveText(
      'Compared with Germany, from your answer.'
    )
    await expect.poll(() => storedAnswers(page)).toEqual({ region: 'DE', adults: 2, children: 0 })
    await page.getByTestId('settings-space-household-ask-again').click()
    await expect(page.getByTestId('settings-space-household-note')).toHaveText('Not answered yet.')
    await expect.poll(() => storedAnswers(page)).toEqual({ region: 'DE' })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('settings-about-space')).toBeVisible({ timeout: 30000 })
    await expect(about.getByRole('radio', { name: 'Germany' })).toBeChecked()
    await expect(page.getByTestId('settings-space-household-note')).toHaveText('Not answered yet.')
    expect(await storedAnswers(page)).toEqual({ region: 'DE' })
  })

  test('takes a region left unanswered as skipped, and compares by the base currency', async ({
    page,
  }) => {
    await gotoServerlessZeroState(page, 'dashboard', 'onboarding-wizard')
    await expect(page.getByTestId('onboarding-step-space')).toBeVisible()
    await page.getByTestId('onboarding-currency').selectOption('GBP')
    await page.getByTestId('onboarding-next').click()
    await expect(page.getByTestId('onboarding-step-about')).toBeVisible()
    await page.getByTestId('onboarding-next').click()
    await expect(page.getByTestId('onboarding-step-account')).toBeVisible()
    await expect.poll(() => storedAnswers(page)).toEqual({ region: 'skipped' })

    await aboutThisSpace(page)
    await expect(page.getByTestId('settings-space-region-note')).toHaveText(
      'You skipped this in setup. Compared with the United Kingdom, going by your base currency, GBP.'
    )
    await expect(page.getByTestId('settings-space-household-note')).toHaveText('Not answered yet.')
  })

  test('does not appear when the workspace already has data', async ({ page }) => {
    await gotoServerless(page, 'dashboard', 'dashboard-header')
    // Give the pristine check time to resolve, then require absence.
    await page.waitForTimeout(1500)
    await expect(page.getByTestId('onboarding-wizard')).toHaveCount(0)
  })

  test('Close asks for confirmation, persists, and can be relaunched from the tour menu', async ({
    page,
  }) => {
    await gotoServerlessZeroState(page, 'dashboard', 'onboarding-wizard')

    // Cancelling the confirm keeps the wizard open.
    const close = page.getByTestId('onboarding-skip')
    await expect(close).toHaveAccessibleName('Leave setup')
    await close.click()
    await expect(page.getByRole('alertdialog')).toContainText(
      'Leave setup? Your space, your main account and a statement can all wait. Settings can run setup again.'
    )
    await page.getByTestId('confirm-cancel').click()
    await expect(page.getByTestId('onboarding-wizard')).toBeVisible()

    // Confirming closes it and stamps the skip flag.
    await close.click()
    await page.getByTestId('confirm-accept').click()
    await expect(page.getByTestId('onboarding-wizard')).toHaveCount(0)
    expect(await page.evaluate(() => localStorage.getItem('finance_onboarding:local'))).toBe(
      'skipped'
    )

    // A reload must NOT re-open it...
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('dashboard-header')).toBeVisible({ timeout: 30000 })
    await page.waitForTimeout(1200)
    await expect(page.getByTestId('onboarding-wizard')).toHaveCount(0)

    // ...but the tour menu relaunches it on demand, on its first screen.
    await page.getByTestId('whats-new-btn').click()
    await page.getByTestId('tour-open-onboarding').click()
    await expect(page.getByTestId('onboarding-wizard')).toBeVisible()
    await expect(page.getByTestId('onboarding-step-space')).toBeVisible()
  })

  test('can be relaunched from Settings and a done flag survives re-login checks', async ({
    page,
  }) => {
    await gotoServerlessZeroState(page, 'dashboard', 'onboarding-wizard')
    await page.getByTestId('onboarding-skip').click()
    await page.getByTestId('confirm-accept').click()
    await expect(page.getByTestId('onboarding-wizard')).toHaveCount(0)

    // The skip is mirrored into the settings KV (fire-and-forget): wait for the write to land in
    // IndexedDB before simulating a fresh device.
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              new Promise((resolve) => {
                const req = indexedDB.open('finance-manager')
                req.onsuccess = () => {
                  const db = req.result
                  try {
                    const get = db
                      .transaction('settings', 'readonly')
                      .objectStore('settings')
                      .get('onboarding')
                    get.onsuccess = () => {
                      resolve((get.result as { value?: string } | undefined)?.value ?? null)
                      db.close()
                    }
                    get.onerror = () => {
                      resolve(null)
                      db.close()
                    }
                  } catch {
                    resolve(null)
                    db.close()
                  }
                }
                req.onerror = () => resolve(null)
              })
          ),
        { timeout: 10000 }
      )
      .toBe('skipped')

    // Even with the local flag wiped (fresh browser / new device against the same data) the
    // wizard stays closed once the pristine check consults settings.
    await page.evaluate(() => localStorage.removeItem('finance_onboarding:local'))
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('dashboard-header')).toBeVisible({ timeout: 30000 })
    await page.waitForTimeout(1500)
    await expect(page.getByTestId('onboarding-wizard')).toHaveCount(0)
    // ...and the remote decision has been re-cached locally.
    expect(await page.evaluate(() => localStorage.getItem('finance_onboarding:local'))).toBe(
      'skipped'
    )

    // Settings, About, Run setup again relaunches on demand.
    await page.evaluate(() => {
      window.location.hash = 'settings'
    })
    await expect(page.getByTestId('settings-header')).toBeVisible()
    await page.getByTestId('settings-tab-about').click()
    await page.getByTestId('settings-run-onboarding').click()
    await expect(page.getByTestId('onboarding-wizard')).toBeVisible()
  })

  test('recognizes existing accounts when relaunched over real data', async ({ page }) => {
    // Demo workspace: accounts already exist. Relaunch the wizard manually.
    await gotoServerless(page, 'dashboard', 'dashboard-header')
    await page.getByTestId('whats-new-btn').click()
    await page.getByTestId('tour-open-onboarding').click()
    await expect(page.getByTestId('onboarding-wizard')).toBeVisible()
    await page.getByTestId('onboarding-next').click() // the name, unchanged
    await expect(page.getByTestId('onboarding-step-about')).toBeVisible()
    await page.getByTestId('onboarding-next').click()

    // The step names the accounts instead of pitching "your main account".
    const step = page.getByTestId('onboarding-step-account')
    await expect(step.getByRole('heading', { name: 'Your accounts' })).toBeVisible()
    await expect(step).toContainText(/You have \d+ accounts\. Add another here, or skip\./)
    await expect(page.getByTestId('onboarding-account-chip').first()).toBeVisible()

    // Skip goes straight through, with nothing typed: no confirmation.
    await page.getByTestId('onboarding-account-skip').click()
    await expect(page.getByTestId('onboarding-step-import')).toBeVisible()
    await expect(page.getByTestId('confirm-accept')).toHaveCount(0)
  })

  test('escape key asks to leave the wizard', async ({ page }) => {
    await gotoServerlessZeroState(page, 'dashboard', 'onboarding-wizard')
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('confirm-cancel')).toBeVisible()
    await page.getByTestId('confirm-cancel').click()
    await expect(page.getByTestId('onboarding-wizard')).toBeVisible()
  })

  test('Back walks the screens in reverse, and the first screen has none', async ({ page }) => {
    await gotoServerlessZeroState(page, 'dashboard', 'onboarding-wizard')
    await toAccount(page)
    const back = page.getByTestId('onboarding-back')
    await expect(back).toHaveAccessibleName('Back')

    await back.click()
    await expect(page.getByTestId('onboarding-step-about')).toBeVisible()
    await back.click()
    await expect(page.getByTestId('onboarding-step-space')).toBeVisible()
    await expect(back).toHaveCount(0)
  })
})

/**
 * Every screen of setup, from the space to Done, read against what the screen paints behind each
 * line (paintedContrast): a chosen chip on About this space, an account added, a file the step
 * cannot import, a statement read, its subscriptions, the statement imported, and Done. A screen that scrolls is read at each place it stops
 * on the way down. The worst of each line, as a list of what is wrong (empty when right): a line
 * under what WCAG AA asks of it, and on a phone, any line the orbit field paints behind.
 */
async function readEveryScreen(page: Page): Promise<string[]> {
  const phone = (page.viewportSize()?.width ?? 1280) <= 620
  const worst = new Map<string, { ratio: number; need: number; field: number }>()
  const read = async (screen: string) => {
    const body = page.getByTestId('onboarding-body')
    for (let more = true, top = 0; more;) {
      ;({ more, top } = await body.evaluate(async (el, top) => {
        el.scrollTop = top
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        return {
          more: el.scrollTop + el.clientHeight < el.scrollHeight - 1,
          top: el.scrollTop + Math.max(40, el.clientHeight - 96),
        }
      }, top))
      for (const line of await paintedContrast(page)) {
        const key = `${screen}: "${line.what}"`
        const was = worst.get(key)
        worst.set(key, {
          ratio: Math.min(line.ratio, was?.ratio ?? Infinity),
          need: line.need,
          field: Math.max(line.field, was?.field ?? 0),
        })
      }
    }
  }

  await read('space')
  await toAbout(page)
  const chip = page.getByTestId('onboarding-space-adults-2')
  await chip.click()
  await expect(chip.locator('input')).toBeChecked()
  await read('about')
  await page.getByTestId('onboarding-next').click()
  await expect(page.getByTestId('onboarding-step-account')).toBeVisible()
  await read('account')
  await page.getByTestId('onboarding-account-name').fill('Main Checking')
  await page.getByTestId('onboarding-account-create').click()
  await expect(page.getByTestId('onboarding-step-import')).toBeVisible()
  await read('statement')
  await page.getByTestId('onboarding-import-input').setInputFiles(UNKNOWN_TABLE)
  await fileIn(page, 'unreadable')
  await read('statement, a file it cannot import')
  await page.getByTestId('onboarding-import-remove').click()
  await page
    .getByTestId('onboarding-import-input')
    .setInputFiles('tests/fixtures/revolut-sample.csv')
  await fileIn(page, 'ready')
  await read('statement, read')
  await page.getByTestId('onboarding-import-selected').click()
  const netflix = page.locator('[data-test-id="sub-scan-row"][data-name="Netflix"]')
  await expect(netflix).toBeVisible({ timeout: 15000 })
  await read('subscriptions')
  // Back on the statement: what went in, and Bring in another statement.
  await page.getByTestId('onboarding-back').click()
  await fileIn(page, 'imported')
  await read('statement, imported')
  await page.getByTestId('onboarding-next').click()
  await expect(netflix).toBeVisible({ timeout: 15000 })
  await page.getByTestId('onboarding-subs-add-continue').click()
  await expect(page.getByTestId('onboarding-step-done')).toBeVisible()
  await read('done')

  expect(worst.size).toBeGreaterThan(20)
  // Every line's worst, kept in the test's output for a reader of the run.
  const measured = test.info().outputPath('painted-contrast.json')
  writeFileSync(measured, JSON.stringify(Object.fromEntries(worst), null, 2))
  await test.info().attach('painted-contrast', { path: measured, contentType: 'application/json' })
  return Array.from(worst.entries()).flatMap(([key, { ratio, need, field }]) => [
    ...(ratio < need ? [`${key} reads at ${ratio}:1, under ${need}:1`] : []),
    ...(phone && field > 2 ? [`${key} has the orbit field behind it (${field})`] : []),
  ])
}

// Every line of setup, over the sky, the haze and the tokens as the screen paints them, the
// orbits stopped at six points each. Behind the glass panel on a wide screen; on a phone, where
// the step's text is the whole screen, nothing of the field.
test.describe("the setup wizard's text over what is painted behind it", () => {
  for (const theme of ['light', 'dark']) {
    test(`every line reads at AA on a wide screen, ${theme}`, async ({ page }) => {
      test.setTimeout(120000)
      await page.addInitScript((value) => {
        localStorage.setItem('finance-theme', value)
      }, theme)
      await gotoServerlessZeroState(page, 'dashboard', 'onboarding-wizard')
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      expect(await readEveryScreen(page)).toEqual([])
    })
  }

  test.describe('on a phone', () => {
    test.use({ hasTouch: true, isMobile: true })
    for (const size of [
      { width: 390, height: 844 },
      { width: 320, height: 568 },
    ]) {
      for (const theme of ['light', 'dark']) {
        test(`every line reads at AA with no orbit behind it, ${size.width}x${size.height} ${theme}`, async ({
          page,
        }) => {
          test.setTimeout(120000)
          await page.setViewportSize(size)
          await page.addInitScript((value) => {
            localStorage.setItem('finance-theme', value)
          }, theme)
          await gotoServerlessZeroState(page, 'dashboard', 'onboarding-wizard')
          await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
          expect(await readEveryScreen(page)).toEqual([])
        })
      }
    }
  })
})

test.describe('onboarding wizard at phone width', () => {
  /** A phone held sideways: the one size where every screen of setup is taller than its middle. */
  const SIDEWAYS = { width: 667, height: 375 }

  test("the step's bottom fades while it goes on below, its top once scrolled, and not where it fits", async ({
    page,
  }) => {
    await page.setViewportSize(SIDEWAYS)
    await gotoServerlessZeroState(page, 'dashboard', 'onboarding-wizard')
    await toAbout(page)
    const body = page.getByTestId('onboarding-body')
    // The cue: the middle's bottom fades out (a mask), and the footer draws nothing of its own.
    const cue = () =>
      body.evaluate((el) => {
        const style = getComputedStyle(el)
        return {
          fades: (style.maskImage || style.webkitMaskImage || 'none') !== 'none',
          footerShadow: getComputedStyle(el.nextElementSibling!).boxShadow,
        }
      })
    await expect(body).toHaveAttribute('data-more-below', '')
    expect(await cue()).toEqual({ fades: true, footerShadow: 'none' })

    // At the end, nothing is left below and nothing fades; back up, the fade returns.
    await body.evaluate((el) => {
      el.scrollTop = el.scrollHeight
    })
    await expect(body).not.toHaveAttribute('data-more-below')
    expect(await cue()).toEqual({ fades: false, footerShadow: 'none' })
    await body.evaluate((el) => {
      el.scrollTop = 0
    })
    await expect(body).toHaveAttribute('data-more-below', '')

    // Held upright, a phone fits the screen whole, and so does a desktop: no fade.
    for (const size of [
      { width: 375, height: 667 },
      { width: 390, height: 844 },
      { width: 1280, height: 800 },
    ]) {
      await page.setViewportSize(size)
      await expect(body, `${size.width}x${size.height}`).not.toHaveAttribute('data-more-below')
      expect(await cue()).toEqual({ fades: false, footerShadow: 'none' })
    }
  })

  test('the fade is on only while the step goes on below, and a chip brought into view stops above it', async ({
    page,
  }) => {
    await page.setViewportSize(SIDEWAYS)
    await gotoServerlessZeroState(page, 'dashboard', 'onboarding-wizard')
    await toAbout(page)
    const body = page.getByTestId('onboarding-body')
    // Where the step ends: the middle's bottom padding starts there.
    const { padding, contentEnd, clientHeight, max } = await body.evaluate((el) => {
      const padding = parseFloat(getComputedStyle(el).paddingBottom)
      return {
        padding,
        contentEnd: el.scrollHeight - padding,
        clientHeight: el.clientHeight,
        max: el.scrollHeight - el.clientHeight,
      }
    })
    expect(padding).toBeGreaterThan(2)
    expect(contentEnd - clientHeight).toBeGreaterThan(40)
    const scrollTo = async (top: number) => {
      await body.evaluate((el, value) => {
        el.scrollTop = value
      }, top)
      expect(await body.evaluate((el) => el.scrollTop)).toBe(top)
    }

    // Stopped inside the bottom padding, nothing of the step is below: no fade, the last row whole.
    await scrollTo(contentEnd - clientHeight)
    await expect(body).not.toHaveAttribute('data-more-below')
    await scrollTo(max - 1)
    await expect(body).not.toHaveAttribute('data-more-below')
    // One pixel of the step below what shows, and it fades.
    await scrollTo(contentEnd - clientHeight - 1)
    await expect(body).toHaveAttribute('data-more-below', '')

    // Brought into view from the top, the last chip stops above the 20 px that fade.
    await scrollTo(0)
    const chip = page.locator('label[data-test-id^="onboarding-space-children-"]').last()
    await chip.evaluate((el) => el.scrollIntoView({ block: 'nearest' }))
    const bottom = (await body.boundingBox())!
    const box = (await chip.boundingBox())!
    expect(await body.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
    expect(box.y + box.height).toBeLessThanOrEqual(bottom.y + bottom.height - 20 + 0.5)
  })

  for (const { width, height, phone } of [
    { width: 390, height: 844, phone: true },
    { width: 1280, height: 800, phone: false },
  ]) {
    test(`setup's chips are at least 44 px, and Settings' are ${phone ? 'too on a phone' : 'their desktop size'}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height })
      // Each chip and Remove answer: its height, and for a chip its width and how far its label's
      // centre sits from the chip's.
      const sizes = (prefix: string) =>
        page.evaluate(
          (p) =>
            Array.from(
              document.querySelectorAll<HTMLElement>(
                `label[data-test-id^="${p}-region-"], label[data-test-id^="${p}-adults-"], label[data-test-id^="${p}-children-"], [data-test-id$="-ask-again"]`
              )
            ).map((el) => {
              const box = el.getBoundingClientRect()
              const text = el.tagName === 'LABEL' ? el.querySelector('span') : null
              const t = text?.getBoundingClientRect()
              return {
                id: el.dataset.testId,
                h: box.height,
                w: text ? box.width : null,
                off: t ? Math.abs(t.left + t.width / 2 - (box.left + box.width / 2)) : 0,
              }
            }),
          prefix
        )
      const fingerSized = (list: { h: number; w: number | null; off: number }[]) =>
        list.every(({ h, w, off }) => h >= 44 && (w === null || w >= 44) && off <= 0.5)

      await gotoServerlessZeroState(page, 'dashboard', 'onboarding-wizard')
      await toAbout(page)
      // Setup's screen is made for one tap each, at every size.
      const wizard = await sizes('onboarding-space')
      expect(wizard).toHaveLength(13)
      expect(fingerSized(wizard), JSON.stringify(wizard)).toBe(true)

      await page.getByTestId('onboarding-space-region-HR').click()
      await page.getByTestId('onboarding-space-adults-1').click()
      await page.getByTestId('onboarding-next').click()
      await expect(page.getByTestId('onboarding-step-account')).toBeVisible()
      await aboutThisSpace(page)
      await expect(page.getByTestId('settings-space-household-ask-again')).toBeVisible()
      const settings = await sizes('settings-space')
      // The chips, and Remove answer for both questions.
      expect(settings).toHaveLength(15)
      if (phone) expect(fingerSized(settings), JSON.stringify(settings)).toBe(true)
      else
        expect(
          settings.every(({ h }) => h < 40),
          JSON.stringify(settings)
        ).toBe(true)
    })
  }

  test('a new screen opens at its top, with focus on its heading', async ({ page }) => {
    await page.setViewportSize(SIDEWAYS)
    await gotoServerlessZeroState(page, 'dashboard', 'onboarding-wizard')
    const body = page.getByTestId('onboarding-body')
    const scrollToEnd = async () => {
      const top = await body.evaluate((el) => {
        el.scrollTop = el.scrollHeight
        return el.scrollTop
      })
      expect(top).toBeGreaterThan(0)
    }
    const opensAtTop = async (step: string, heading: string) => {
      await expect(page.getByTestId(`onboarding-step-${step}`)).toBeVisible()
      await expect(page.getByRole('heading', { name: heading })).toBeFocused()
      expect(await body.evaluate((el) => el.scrollTop)).toBe(0)
    }
    await expect(page.getByTestId('onboarding-step-space')).toBeVisible()

    // By Enter in the name, which continues.
    await scrollToEnd()
    await page.getByTestId('onboarding-profile-name').focus()
    await page.keyboard.press('Enter')
    await opensAtTop('about', 'About this space')

    // By mouse.
    await scrollToEnd()
    await page.getByTestId('onboarding-next').click()
    await opensAtTop('account', 'Add your main account')

    // By Enter in the account's name, which adds it.
    await scrollToEnd()
    await page.getByTestId('onboarding-account-name').fill('Main Checking')
    await page.getByTestId('onboarding-account-name').press('Enter')
    await opensAtTop('import', 'Bring in a statement')

    // And back: the profile has an account now.
    await scrollToEnd()
    await page.getByTestId('onboarding-back').click()
    await opensAtTop('account', 'Your accounts')

    // Escape still asks to leave.
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('confirm-accept')).toBeVisible()
  })

  // A phone: touch, so the coarse-pointer sizes apply, as they do on one.
  test.describe('on a touch screen', () => {
    test.use({ hasTouch: true, isMobile: true })
    const sizes = [
      { width: 390, height: 844 },
      { width: 375, height: 667 },
      { width: 320, height: 568 },
    ]
    for (const size of sizes) {
      for (const theme of ['light', 'dark']) {
        test(`the panel stays on a ${size.width}x${size.height} screen on every step, ${theme}`, async ({
          page,
        }) => {
          /**
           * Everything wrong with the panel's place on the screen, as a list (empty when right):
           * - the page, the overlay, the panel or its body scrolls sideways, or any other box in the
           *   wizard is wider inside than out.
           * - the panel reaches past an edge of the screen, or a footer button past the panel's.
           * - the overlay is scrolled at all.
           * - the header is not one 56 px bar with 44 px Back and Close, or the footer is more than
           *   one row, or a footer button is under 48 px tall.
           * - a field's text is under 16 px, which iOS zooms the page for when it takes focus.
           * Then the footer's primary button is scrolled into view centred, as a browser does for an
           * element it brings into view, and the panel must not move and the overlay must still not
           * be scrolled: a box that clips with overflow: hidden can still be scrolled that way.
           */
          const misplaced = () =>
            page.evaluate(() => {
              const found: string[] = []
              const root = document.documentElement
              const overlay = document.querySelector<HTMLElement>(
                '[data-test-id="onboarding-wizard"]'
              )!
              const panel = document.querySelector<HTMLElement>(
                '[data-test-id="onboarding-panel"]'
              )!
              if (root.scrollWidth > root.clientWidth)
                found.push(`page ${root.scrollWidth}>${root.clientWidth}`)
              for (const el of [
                overlay,
                ...Array.from(overlay.querySelectorAll<HTMLElement>('*')),
              ]) {
                const overflowX = getComputedStyle(el).overflowX
                if (overflowX === 'visible' || overflowX === 'clip') continue
                if (el.scrollWidth > el.clientWidth)
                  found.push(
                    `${String(el.className) || el.tagName} ${el.scrollWidth}>${el.clientWidth}`
                  )
              }
              const box = panel.getBoundingClientRect()
              if (
                box.left < 0 ||
                box.top < 0 ||
                box.right > root.clientWidth ||
                box.bottom > root.clientHeight
              )
                found.push(`panel ${box.left},${box.top} to ${box.right},${box.bottom}`)
              const buttons = Array.from(panel.querySelectorAll<HTMLElement>('footer button'))
              for (const button of buttons) {
                const b = button.getBoundingClientRect()
                if (
                  b.left < box.left ||
                  b.top < box.top ||
                  b.right > box.right ||
                  b.bottom > box.bottom
                )
                  found.push(
                    `${button.dataset.testId} ${b.left},${b.top} to ${b.right},${b.bottom}`
                  )
                if (b.height < 48) found.push(`${button.dataset.testId} ${b.height} px tall`)
                if (Math.abs(b.top - buttons[0].getBoundingClientRect().top) > 1)
                  found.push(`${button.dataset.testId} on a second footer row`)
              }
              const header = panel.querySelector('header')!.getBoundingClientRect()
              if (Math.abs(header.height - 56) > 1) found.push(`header ${header.height} px tall`)
              for (const control of Array.from(
                panel.querySelectorAll<HTMLElement>('header button')
              )) {
                const c = control.getBoundingClientRect()
                if (c.width < 44 || c.height < 44)
                  found.push(`${control.dataset.testId} ${c.width}x${c.height}`)
              }
              for (const field of Array.from(
                panel.querySelectorAll<HTMLElement>(
                  'input:not([type="file"]):not([type="radio"]):not([type="checkbox"]), select'
                )
              )) {
                const size = parseFloat(getComputedStyle(field).fontSize)
                if (size < 16)
                  found.push(`${field.dataset.testId ?? field.tagName} text ${size} px`)
              }
              if (overlay.scrollLeft || overlay.scrollTop)
                found.push(`overlay scrolled to ${overlay.scrollLeft},${overlay.scrollTop}`)

              const primary = buttons[buttons.length - 1]
              primary.scrollIntoView({ block: 'center', inline: 'center' })
              const after = panel.getBoundingClientRect()
              if (after.left !== box.left || after.top !== box.top)
                found.push(`panel moved ${after.left - box.left},${after.top - box.top}`)
              if (overlay.scrollLeft || overlay.scrollTop)
                found.push(
                  `overlay scrolled to ${overlay.scrollLeft},${overlay.scrollTop} by ${primary.dataset.testId}`
                )
              return found
            })
          // The panel rises 14 px as it opens; measure where it settles.
          const check = async (step: string) => {
            await page
              .getByTestId('onboarding-panel')
              .evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)))
            expect(await misplaced(), step).toEqual([])
          }

          await page.setViewportSize(size)
          await page.addInitScript((value) => {
            localStorage.setItem('finance-theme', value)
          }, theme)
          await gotoServerlessZeroState(page, 'dashboard', 'onboarding-wizard')
          await expect(page.locator('html')).toHaveAttribute('data-theme', theme)

          await expect(page.getByTestId('onboarding-profile-name')).toHaveValue('Personal Profile')
          await check('space')
          await page.getByTestId('onboarding-next').click()
          await expect(page.getByTestId('onboarding-step-about')).toBeVisible()
          await check('about')
          await page.getByTestId('onboarding-next').click()

          await expect(page.getByTestId('onboarding-step-account')).toBeVisible()
          await check('account')
          await page.getByTestId('onboarding-account-name').fill('Main Checking')
          await page.getByTestId('onboarding-account-create').click()

          await expect(page.getByTestId('onboarding-step-import')).toBeVisible()
          await check('statement, no file')
          await page.getByTestId('onboarding-import-input').setInputFiles(UNKNOWN_TABLE)
          await fileIn(page, 'unreadable')
          await check('statement, a file it cannot import')
          await page.getByTestId('onboarding-import-remove').click()
          await page
            .getByTestId('onboarding-import-input')
            .setInputFiles('tests/fixtures/revolut-sample.csv')
          await fileIn(page, 'ready')
          await check('statement, ready')
          await page.getByTestId('onboarding-import-selected').click()

          await expect(page.getByTestId('onboarding-step-subscriptions')).toBeVisible({
            timeout: 15000,
          })
          await expect(page.locator('[data-test-id="sub-scan-row"]').first()).toBeVisible({
            timeout: 15000,
          })
          await check('subscriptions')
          await page.getByTestId('onboarding-subs-skip').click()
          await expect(page.getByTestId('onboarding-step-done')).toBeVisible()
          await check('done')
        })
      }
    }
  })
})

test.describe('About this space in Settings', () => {
  test('each "Remove answer" is described by the question it clears', async ({ page }) => {
    await gotoServerless(page, 'settings', 'settings-about-space')
    await page.getByTestId('settings-space-region-HR').click()
    await page.getByTestId('settings-space-adults-1').click()
    const region = page.getByTestId('settings-space-region-ask-again')
    const household = page.getByTestId('settings-space-household-ask-again')
    await expect(region).toBeEnabled()
    await expect(household).toBeEnabled()
    // The same name, told apart by the browser's accessible description.
    await expect(region).toHaveAccessibleName('Remove answer')
    await expect(household).toHaveAccessibleName('Remove answer')
    await expect(region).toHaveAccessibleDescription('Where do you live?')
    await expect(household).toHaveAccessibleDescription('Who does this space cover?')
  })

  test('on a phone "Remove answer" sits 6 to 8 px under a wrapped line and takes a tap at either edge', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await gotoServerless(page, 'settings', 'settings-about-space')
    // Both answered in full, so the household's button sits beside its short line, under the
    // children's chips.
    const answer = async () => {
      await page.getByTestId('settings-space-region-HR').click()
      await page.getByTestId('settings-space-adults-1').click()
      await page.getByTestId('settings-space-children-0').click()
      await expect(page.getByTestId('settings-space-household-note')).toHaveText(
        '1 adult, no children.'
      )
      await expect(page.getByTestId('settings-space-household-ask-again')).toBeEnabled()
      await expect(page.getByTestId('settings-space-region-ask-again')).toBeEnabled()
    }
    await answer()

    // No chip's box and no button's 44 px overlap, so neither takes the other's taps.
    const overlaps = await page.evaluate(() => {
      const card = document.querySelector('[data-test-id="settings-about-space"]')!
      const buttons = Array.from(card.querySelectorAll('[data-test-id$="-ask-again"]'))
      const chips = Array.from(card.querySelectorAll('label'))
      return buttons.flatMap((button) => {
        const b = button.getBoundingClientRect()
        return chips
          .filter((chip) => {
            const c = chip.getBoundingClientRect()
            return c.left < b.right && c.right > b.left && c.top < b.bottom && c.bottom > b.top
          })
          .map(
            (chip) =>
              `${button.getAttribute('data-test-id')} over ${chip.getAttribute('data-test-id')}`
          )
      })
    })
    expect(overlaps).toEqual([])

    // The region's line wraps it at 390: its words start 6 to 8 px under the line's last.
    const gap = await page.evaluate(() => {
      const textBox = (el: Element) => {
        const range = document.createRange()
        range.selectNodeContents(el)
        return Array.from(range.getClientRects())
      }
      const line = textBox(document.querySelector('[data-test-id="settings-space-region-note"]')!)
      const words = textBox(
        document.querySelector('[data-test-id="settings-space-region-ask-again"]')!
      )[0]
      return words.top - line.at(-1)!.bottom
    })
    expect(gap).toBeGreaterThanOrEqual(6)
    expect(gap).toBeLessThanOrEqual(8)

    // Each is 44 px to a finger: a tap at its top edge clears the answer, and so does one at its
    // bottom edge.
    for (const question of ['region', 'household']) {
      for (const edge of ['top', 'bottom']) {
        const button = page.getByTestId(`settings-space-${question}-ask-again`)
        const size = (await button.boundingBox())!
        expect(size.height).toBeGreaterThanOrEqual(44)
        await button.click({
          position: { x: size.width / 2, y: edge === 'top' ? 0.5 : size.height - 0.5 },
          timeout: 5000,
        })
        await expect(button, `${question} ${edge}`).toBeHidden()
        await answer()
      }
    }
  })

  for (const size of [
    { width: 390, height: 844 },
    { width: 1280, height: 800 },
  ]) {
    test(`"Remove answer" follows each status line at ${size.width} wide`, async ({ page }) => {
      await page.setViewportSize(size)
      await gotoServerless(page, 'settings', 'settings-about-space')
      // The card says what its answers belong to; the region's own line says what they are for.
      const card = page.getByTestId('settings-about-space')
      await expect(card).toContainText('Each space keeps its own answers.')
      await expect(card).not.toContainText('official figures')
      await page.getByTestId('settings-space-region-HR').click()
      await page.getByTestId('settings-space-adults-1').click()
      await page.getByTestId('settings-space-children-0').click()
      await expect(page.getByTestId('settings-space-household-note')).toHaveText(
        '1 adult, no children.'
      )
      await expect(page.getByTestId('settings-space-household-ask-again')).toBeEnabled()

      // Where "Remove answer" sits against its status line: beside the line's last word, or under the
      // line's start. Anything else is somewhere a reader would not look for it. Its words, not its
      // box: on a phone the box reaches past them to be 44 px tall.
      for (const question of ['region', 'household']) {
        const placement = await page.evaluate((q) => {
          const note = document.querySelector(`[data-test-id="settings-space-${q}-note"]`)!
          const ask = document.querySelector(`[data-test-id="settings-space-${q}-ask-again"]`)!
          const range = document.createRange()
          range.selectNodeContents(note)
          const lines = Array.from(range.getClientRects())
          const last = lines[lines.length - 1]
          const first = lines[0]
          const words = document.createRange()
          words.selectNodeContents(ask)
          const a = words.getBoundingClientRect()
          const middle = (r: DOMRect) => r.top + r.height / 2
          if (
            Math.abs(middle(a) - middle(last)) < 6 &&
            a.left >= last.right &&
            a.left - last.right <= 24
          )
            return 'beside'
          if (Math.abs(a.left - first.left) <= 1 && a.top >= last.bottom - 1) return 'under'
          return `elsewhere: line ${Math.round(first.left)}-${Math.round(last.right)}, button at ${Math.round(a.left)}`
        }, question)
        expect(['beside', 'under'], question).toContain(placement)
      }

      // With Settings scrolled to its end, the floating + button covers nothing in the card.
      await page.evaluate(() => {
        window.scrollTo(0, document.documentElement.scrollHeight)
      })
      const covered = await page.evaluate(() => {
        const fab = document
          .querySelector('button[aria-label="Quick add entry"]')!
          .getBoundingClientRect()
        const card = document.querySelector('[data-test-id="settings-about-space"]')!
        return Array.from(card.querySelectorAll('button, label'))
          .filter((el) => {
            const r = el.getBoundingClientRect()
            return (
              r.right > fab.left && r.left < fab.right && r.bottom > fab.top && r.top < fab.bottom
            )
          })
          .map((el) => el.getAttribute('data-test-id') ?? el.textContent)
      })
      expect(covered).toEqual([])
    })
  }
})
