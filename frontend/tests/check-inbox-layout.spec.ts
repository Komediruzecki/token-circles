/**
 * Check your inbox as drawn, after a sign-up on the sign-in screen, at 1280 and 390: the address
 * on one line, not broken at a hyphen in it, and each of the footer's items on one line of its
 * own. The 3 Nov test run found "uat-j01-" at the end of one line and the rest of the address on
 * the next, and "Contact support" and the build's version ("v5.17.6-2-g70a3431d") each on two.
 *
 * The local Worker's sign-up, booted as dev boots (account mode). Each case signs up an account
 * made for the run; it stays unconfirmed in the local throwaway database.
 */
import { randomBytes } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { bootApp, openSignIn } from './boot'
import { sql } from './db'
import { E2E_BASE } from './e2e-constants'
import type { Page } from '@playwright/test'

const PASSWORD = 'check-inbox-layout-password-1'

// Signed out: the sign-in screen, not the fixture account's session.
test.use({ storageState: { cookies: [], origins: [] } })

/** On how many lines the text inside the element sits: its text boxes, tops within 4 px as one. */
const linesOf = (page: Page, selector: string) =>
  page.locator(selector).evaluate((el) => {
    const tops: number[] = []
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent?.trim()) continue
      const range = document.createRange()
      range.selectNodeContents(n)
      for (const r of range.getClientRects()) {
        if (r.width > 0 && !tops.some((t) => Math.abs(t - r.top) < 4)) tops.push(r.top)
      }
    }
    return tops.length
  })

for (const size of [
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
]) {
  test(`Check your inbox at ${size.width}: the address and each footer item on one line`, async ({
    page,
    context,
  }) => {
    test.setTimeout(120_000)
    await page.setViewportSize(size)
    sql("DELETE FROM rate_limits WHERE bucket LIKE 'register%' OR bucket LIKE 'login%'")
    // Hyphens where the test run's address had them, and short enough for one line at 390.
    const email = `uat-a10-${randomBytes(4).toString('hex')}@example.test`
    await bootApp(context, 'server')
    await openSignIn(page, 'server', E2E_BASE)
    await page.getByText('Create one').click()
    await page.locator('#login-email').fill(email)
    await page.locator('#login-password').fill(PASSWORD)
    await page.locator('button[type="submit"]').click()
    await expect(page.getByTestId('check-inbox-address')).toHaveText(email, { timeout: 30_000 })

    expect(await linesOf(page, '[data-test-id="check-inbox-address"]'), 'the address').toBe(1)
    const footer = page.getByTestId('sign-in-footer')
    const items = await footer.evaluate((row) =>
      [...row.children].map((item) => item.textContent?.trim() ?? '')
    )
    expect(items, 'Contact support, Privacy and Terms, the version').toHaveLength(3)
    for (const [i, text] of items.entries()) {
      expect(
        await linesOf(page, `[data-test-id="sign-in-footer"] > :nth-child(${i + 1})`),
        text
      ).toBe(1)
    }
  })
}
