/**
 * Release scope 5.16.0, section 10: the E2EE copy (#585).
 *
 * End-to-end encryption is not planned, so no public text may describe it as planned, promised
 * or decided. The scope checks the two places a visitor meets: the published llms.txt, and the
 * in-app changelog (What's new), including the 5.15.1 entry that introduced llms.txt.
 */
import { cloudTest as test, expect } from './release-fixtures'
import { goPage } from './release-helpers'

const E2EE = /end[- ]to[- ]end|e2ee|zero[- ]knowledge/i

test.describe('5.16.0 s10 E2EE copy', () => {
  test('10.1 llms.txt says nothing about end-to-end encryption @release', async ({ m }) => {
    const res = await m.page.request.get('/llms.txt')
    expect(res.ok()).toBe(true)
    const text = await res.text()
    expect(text.length).toBeGreaterThan(200)
    expect(text).not.toMatch(E2EE)
  })

  test('10.2 What is new, and its 5.15.1 llms.txt entry, say nothing about it @release', async ({
    m,
  }) => {
    const { page } = m
    await goPage(page, 'settings', 'settings-header')
    await page.getByTestId('settings-tab-about').click()
    await page.getByRole('button', { name: 'View Changelog' }).click()
    // The nearest ancestor carrying the modal's (hashed) class: the whole dialog, not its header.
    const modal = page
      .getByRole('heading', { name: 'Changelog', exact: true })
      .locator('xpath=ancestor::div[contains(@class, "_modal_")][1]')
    await expect(modal).toBeVisible()
    const text = await modal.innerText()
    // The modal really rendered the changelog, down to the 5.15.1 llms.txt entry.
    expect(text).toContain('5.15.1')
    expect(text).toContain('llms.txt')
    expect(text).not.toMatch(E2EE)
  })
})
