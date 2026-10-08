/**
 * The CRUD specs count the console lines with "Error" in them, leaving out the ones that only say
 * the network failed. They knew fetch's own "Failed to fetch". Since #602 the app says it in a
 * sentence (core/apiError.ts), and a page's loader logs "Failed to load goals: ApiError: Couldn't
 * reach Token Circles. ...", which counted as a real error. This fails a request the way a dropped
 * connection does and reads the console through the filter the CRUD specs use.
 */
import { expect, test } from '@playwright/test'
import { UNREACHABLE } from '../src/core/apiError'
import { isNetworkNoise, login, navigateToRoute } from './test-helpers'

// `@smoke`: a pull request runs only the smoke subset, and a change that breaks this filter
// arrives as one.
test('a request that gets no answer is noise to the CRUD specs, not an error @smoke', async ({
  page,
}) => {
  await login(page)
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  // net::ERR_FAILED: fetch rejects with a TypeError, as it does for a connection that drops.
  await page.route('**/api/savings-goals**', (route) => route.abort('failed'))

  await navigateToRoute(page, 'goals')

  // The kind of line this is about: the app's sentence, in a line with "Error" in it.
  await expect
    .poll(() => errors.some((msg) => msg.includes('Error') && msg.includes(UNREACHABLE)))
    .toBe(true)
  expect(errors.filter((msg) => msg.includes('Error') && !isNetworkNoise(msg))).toEqual([])
})
