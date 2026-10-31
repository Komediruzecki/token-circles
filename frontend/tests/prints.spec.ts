/**
 * Prints on Progress (first week, phase 4): every twelve tracked months in a row make a print, the
 * year drawn as a seal. In both storage modes: local-first on the example profiles or on a new
 * space, signed in on a new profile of the fixture account. Round invented values, and five-digit
 * ones where a test looks for an amount that leaked.
 */
import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { aSpaceOnly, go } from './circles-fixture'
import { caseStamp, MODES, sweepProfiles, viaApp } from './form-errors-helpers'
import {
  aMonth,
  monthName,
  monthsAgo,
  monthsBack,
  toastSaying,
  toPrints,
  write,
} from './prints-fixture'
import { gotoServerless } from './test-helpers'
import type { Page } from '@playwright/test'

const cloud = MODES[0]

interface Row {
  id: number
  date: string
}

/** The stamp of the profile a signed-in case made, swept after it. */
let stamp = ''
test.afterEach(async ({ page }) => {
  if (stamp) await sweepProfiles(page, cloud, stamp)
  stamp = ''
})

/** A new profile on the fixture account, open on Progress. */
async function signedIn(page: Page): Promise<void> {
  stamp = caseStamp()
  await cloud.open(page, 'progress', (p) => p.getByTestId('progress-header'), `Prints ${stamp}`)
}

/** A year of entries, from twelve months ago to last month; the shops spend more each month. */
const aYear = () => monthsBack(12).flatMap((m, i) => aMonth(m, 4, 3000, 1000, 150 + 10 * i))

/** Taps the petal in slot `m` where a finger would: halfway out along its sector. */
async function tapPetal(page: Page, m: number): Promise<void> {
  const box = (await page.getByTestId('prints-seal').boundingBox())!
  const angle = -Math.PI / 2 + ((m + 0.5) * Math.PI) / 6
  const r = box.width * 0.3
  await page.mouse.click(
    box.x + box.width / 2 + r * Math.cos(angle),
    box.y + box.height / 2 + r * Math.sin(angle)
  )
}

const thisMonthCount = () => {
  const now = new Date()
  return (now.getFullYear() - 2000) * 12 + now.getMonth() + 1
}

test.describe('Prints @smoke', () => {
  test('local-first: the example profile shows its newest print, its earlier prints and the next plate', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    await gotoServerless(page, 'progress/prints', 'progress-header')
    // Every month from January 2000 to this one holds entries: a print for each whole twelve.
    const months = thisMonthCount()
    const prints = Math.floor(months / 12)
    const plate = months % 12
    await expect(page.getByTestId('prints-eyebrow')).toHaveText(`Print ${prints}`, {
      timeout: 60_000,
    })
    await expect(page.getByTestId('prints-seal')).toHaveAttribute('data-kind', 'print')
    const every = page.getByTestId('prints-every').getByRole('button')
    await expect(every).toHaveCount(prints)
    await expect(every.first()).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('prints-next-status')).toHaveText(
      plate > 0 ? `${plate} of 12 months` : `Starts with ${monthName(monthsAgo(-1))}.`
    )
    // The prints near the screen are drawn as images.
    await page.getByTestId('prints-every').scrollIntoViewIfNeeded()
    await expect(page.getByTestId('prints-every').locator('img').first()).toBeVisible()
  })

  test('signed in: a year of entries makes the first print, named in the A year toast', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    await signedIn(page)
    const year = monthsBack(12)
    // Eleven months first: the profile's first evaluation, which counts its badges at once.
    await write(page, aYear().slice(0, 44))
    await toPrints(page)
    await expect(page.getByTestId('prints-title')).toHaveText(
      `11 of 12 months, up to ${monthName(year[10])}`,
      { timeout: 30_000 }
    )
    // The twelfth: the A year badge, and the first print with it.
    await write(page, aYear().slice(44))
    const toast = toastSaying(page, 'Badge unlocked: A year. Your first print is on Progress.')
    await expect(toast).toBeVisible({ timeout: 30_000 })
    await go(page, 'dashboard')
    await expect(page.getByTestId('dashboard-header')).toBeVisible()
    await toast.getByRole('button', { name: 'See my print' }).click()
    await expect(page).toHaveURL(/#progress\/prints(\?|$)/)
    await expect(page.getByTestId('prints-eyebrow')).toHaveText('Your first print')
    await expect(page.getByTestId('prints-title')).toHaveText(
      `${monthName(year[0])} to ${monthName(year[11])}`
    )
  })
})

test.describe('Prints', () => {
  test('local-first: a new space shows an empty plate that says how a month counts', async ({
    page,
  }) => {
    await aSpaceOnly(page)
    await toPrints(page)
    await expect(page.getByTestId('prints-seal')).toHaveAttribute('data-kind', 'empty')
    await expect(page.getByTestId('prints-eyebrow')).toHaveText('Your first print')
    await expect(page.getByTestId('progress-prints')).toContainText(
      'It fills in here, one petal for each month you track. A month counts once it holds three entries.'
    )
    await expect(page.getByTestId('prints-readout')).toHaveCount(0)
  })

  test('local-first: six months make a plate at 6 of 12, and a missing month is named with its entries', async ({
    page,
  }) => {
    await aSpaceOnly(page)
    await write(page, [...monthsBack(7, 2).flatMap((m) => aMonth(m)), ...aMonth(monthsAgo(1), 2)])
    await toPrints(page)
    await expect(page.getByTestId('prints-title')).toHaveText(
      `6 of 12 months, up to ${monthName(monthsAgo(2))}`,
      { timeout: 30_000 }
    )
    await expect(page.getByTestId('prints-plate-line')).toHaveText(
      `${monthName(monthsAgo(1))} has 2 entries; a month counts once it holds three.`
    )
    await expect(page.getByTestId('prints-seal')).toHaveAttribute('data-months', '6')
  })

  test('signed in: tapping a petal names its month in the readout, as the month list does', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    await signedIn(page)
    await write(page, aYear().slice(24))
    await toPrints(page)
    await expect(page.getByTestId('prints-seal')).toHaveAttribute('data-months', '6', {
      timeout: 30_000,
    })
    const readout = page.getByTestId('prints-readout')
    await expect(readout).toHaveText('Tap a petal to see its month.')
    const list = page.getByTestId('prints-months')
    await list.locator('summary').click()
    const lines = await list.locator('li').allTextContents()
    expect(lines).toHaveLength(6)
    await tapPetal(page, 2)
    await expect(readout).toHaveText(lines[2])
    expect(lines[2]).toMatch(new RegExp(`^${monthName(monthsAgo(4))} spent `))
    // Tapped again, it lets go, though the mouse is still on it.
    await tapPetal(page, 2)
    await expect(readout).toHaveText('Tap a petal to see its month.')
  })

  test('signed in: an earlier print takes the newest one’s place when tapped', async ({ page }) => {
    test.setTimeout(150_000)
    await signedIn(page)
    const years = monthsBack(24)
    await write(
      page,
      years.flatMap((m) => aMonth(m))
    )
    await toPrints(page)
    await expect(page.getByTestId('prints-eyebrow')).toHaveText('Print 2', { timeout: 30_000 })
    const first = page.getByRole('button', {
      name: `Show the print for ${monthName(years[0])} to ${monthName(years[11])}`,
    })
    await first.click()
    await expect(page.getByTestId('prints-eyebrow')).toHaveText('Your first print')
    await expect(page.getByTestId('prints-title')).toHaveText(
      `${monthName(years[0])} to ${monthName(years[11])}`
    )
    await expect(first).toHaveAttribute('aria-pressed', 'true')
  })

  test('local-first: no amount from the statement appears in the print, its label, its readout or its list', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    await aSpaceOnly(page)
    const shops = [10246.5, 11357.25, 12468.75, 13579.5, 14680.25, 15791.75]
    const entries = monthsBack(12).flatMap((m, i) =>
      aMonth(m, 4, 61457.25, 12345.5, shops[i % shops.length])
    )
    await write(page, entries)
    await toPrints(page)
    await expect(page.getByTestId('prints-seal')).toHaveAttribute('data-kind', 'print', {
      timeout: 30_000,
    })
    await tapPetal(page, 5)
    await expect(page.getByTestId('prints-readout')).not.toHaveText('Tap a petal to see its month.')
    await page.getByTestId('prints-months').locator('summary').click()

    const shelf = page.getByTestId('progress-prints')
    const words = await shelf.evaluate((el) =>
      [
        (el as HTMLElement).innerText,
        ...[...el.querySelectorAll('[aria-label]')].map((e) => e.getAttribute('aria-label')),
      ].join('\n')
    )
    // Five-digit amounts: any run of five digits, or a thousands group, would be one of them.
    expect(words).not.toMatch(/\d{5}|\d[,.]\d{3}|€|\$/)
    const drawings = await shelf.evaluate((el) => [
      ...[...el.querySelectorAll('svg')].map((s) => s.outerHTML),
      ...[...el.querySelectorAll('img')].map((i) =>
        decodeURIComponent(i.getAttribute('src')!.replace(/^data:image\/svg\+xml;utf8,/, ''))
      ),
    ])
    const digits = new Set(
      entries.flatMap((e) => [String(Math.trunc(e.amount)), String(e.amount).replace('.', '')])
    )
    for (const drawing of drawings) {
      for (const amount of digits) expect(drawing).not.toContain(amount)
    }
  })

  test('signed in: #progress/prints opens Progress at the prints, and a reload keeps it there', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    await signedIn(page)
    await write(page, aYear())
    await go(page, 'dashboard')
    await expect(page.getByTestId('dashboard-header')).toBeVisible()
    const atTop = async () => {
      await expect(page.getByTestId('prints-seal')).toHaveAttribute('data-kind', 'print', {
        timeout: 30_000,
      })
      await expect
        .poll(async () => (await page.getByTestId('progress-divider-prints').boundingBox())?.y, {
          timeout: 10_000,
        })
        .toBeLessThan(120)
    }
    await go(page, 'progress/prints')
    await atTop()
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page).toHaveURL(/#progress\/prints(\?|$)/)
    await atTop()
  })

  test('signed in: deleting a month’s entries takes its print away and keeps the A year badge', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    await signedIn(page)
    await write(page, aYear())
    await toPrints(page)
    await expect(page.getByTestId('prints-seal')).toHaveAttribute('data-kind', 'print', {
      timeout: 30_000,
    })
    const aYearBadge = page
      .locator('li')
      .filter({ has: page.getByText('A year', { exact: true }) })
      .filter({ hasText: /Earned / })
    await expect(aYearBadge).toBeVisible({ timeout: 30_000 })

    const gone = monthsAgo(6)
    // A list in local-first, a page of rows from the Worker.
    const listed = await viaApp<Row[] | { rows: Row[] }>(
      page,
      'GET',
      `/api/transactions?startDate=${gone}-01&endDate=${gone}-28`
    )
    const rows = Array.isArray(listed) ? listed : listed.rows
    expect(rows).toHaveLength(4)
    for (const row of rows) {
      await viaApp(page, 'DELETE', `/api/transactions/${String(row.id)}`)
    }
    await expect(page.getByTestId('prints-seal')).toHaveAttribute('data-kind', 'plate', {
      timeout: 30_000,
    })
    await expect(page.getByTestId('prints-title')).toHaveText('5 of 12 months')
    await expect(aYearBadge).toBeVisible()
  })

  test('signed in: Share downloads a PNG named for the print’s months', async ({ page }) => {
    test.setTimeout(120_000)
    // No share sheet for files, as on a desktop browser: the print is downloaded.
    await page.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, 'canShare', {
        configurable: true,
        value: () => false,
      })
    })
    await signedIn(page)
    await write(page, aYear())
    await toPrints(page)
    await expect(page.getByTestId('prints-seal')).toHaveAttribute('data-kind', 'print', {
      timeout: 30_000,
    })
    const downloading = page.waitForEvent('download')
    await page.getByTestId('prints-share').click()
    const download = await downloading
    expect(download.suggestedFilename()).toBe(
      `token-circles-print-${monthsAgo(12)}-to-${monthsAgo(1)}.png`
    )
    const png = await readFile((await download.path())!)
    // A PNG, 1200 by 1200: the signature, then the IHDR chunk's width and height.
    expect(png.subarray(1, 4).toString('ascii')).toBe('PNG')
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 1200])
    await expect(toastSaying(page, 'Print saved as a PNG.')).toBeVisible()
  })
})
