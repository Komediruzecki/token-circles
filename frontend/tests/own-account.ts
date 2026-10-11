/**
 * An account of a spec's own: signed up, confirmed and signed in for one test, and deleted after,
 * for cases the shared fixture account cannot show (a new account's first run, its setup wizard,
 * its Getting started card).
 */
import { expect } from '@playwright/test'
import { randomBytes } from 'node:crypto'
import { confirmAccount, sql } from './db'
import { E2E_BASE } from './test-helpers'
import type { BrowserContext } from '@playwright/test'

// eslint-disable-next-line sonarjs/no-hardcoded-passwords -- local throwaway fixture accounts
const PASSWORD = 'onboarding-own-account-1'

/** Sign up a new account, confirm it, and sign `ctx` in to it. */
export async function signUpAndIn(ctx: BrowserContext): Promise<{ email: string; id: number }> {
  const email = `e2e-onboarding-${randomBytes(6).toString('hex')}@tokencircles.test`
  sql('DELETE FROM rate_limits')
  await ctx.request.post(`${E2E_BASE}/api/auth/register`, { data: { email, password: PASSWORD } })
  await confirmAccount(email)
  await signIn(ctx, email)
  const me = await ctx.request.get(`${E2E_BASE}/api/auth/me`)
  return { email, id: ((await me.json()) as { id: number }).id }
}

/** Sign `ctx` in to the account at `email`, made by signUpAndIn. */
export async function signIn(ctx: BrowserContext, email: string): Promise<void> {
  const signedIn = await ctx.request.post(`${E2E_BASE}/api/auth/login`, {
    data: { email, password: PASSWORD },
  })
  expect(signedIn.ok(), await signedIn.text()).toBeTruthy()
}

/**
 * Boot the app signed in, on the account's own profile: the fixture's profile choice, which every
 * context starts with, is cleared once (a reload keeps what the app chose).
 */
export async function bootSignedIn(ctx: BrowserContext): Promise<void> {
  await ctx.addInitScript(() => {
    localStorage.setItem('finance_storage_mode', 'self-hosted')
    localStorage.setItem('darkMode', 'false')
    if (!sessionStorage.getItem('onb_profile_cleared')) {
      sessionStorage.setItem('onb_profile_cleared', '1')
      localStorage.removeItem('currentProfileId')
      localStorage.removeItem('selectedProfileIds')
    }
  })
}

/** Delete the account at `email`, and only it: the session may be another account's by now. */
export async function deleteAccount(ctx: BrowserContext, email: string): Promise<void> {
  const who = await ctx.request.get(`${E2E_BASE}/api/auth/me`)
  const signedInAs = who.ok() ? ((await who.json()) as { email?: string }).email : undefined
  if (signedInAs === email) {
    await ctx.request.delete(`${E2E_BASE}/api/account`, { data: { confirm: 'delete' } })
  }
}
