/**
 * The about site the app links to (Privacy, Terms and the articles) is the one the build names in
 * VITE_ABOUT_ORIGIN, and production's when it names none, so the dev build links to dev's about
 * site and a self-hosted build to its own (A20). The Worker's mails read ABOUT_ORIGIN the same
 * way (worker/test/mail-origins.test.ts).
 */
import { resolve } from 'path'
import { loadEnv } from 'vite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { aboutOrigin } from '../aboutSite'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('the about site', () => {
  it("is production's when the build names none", () => {
    vi.stubEnv('VITE_ABOUT_ORIGIN', '')
    expect(aboutOrigin()).toBe('https://about.tokencircles.com')
  })

  it('is the one the build names', () => {
    vi.stubEnv('VITE_ABOUT_ORIGIN', 'https://about.example.test')
    expect(aboutOrigin()).toBe('https://about.example.test')
  })
})

/**
 * What each build is given, read the way Vite reads it: `--mode dev` (pnpm run build:dev, the dev
 * deploy) and the production build. Only the one key is read, so nothing else in those files is.
 */
describe('the builds', () => {
  const frontend = resolve(import.meta.dirname, '../../..')
  const named = (mode: string) => loadEnv(mode, frontend, 'VITE_ABOUT_ORIGIN')

  it("point the dev build at dev's about site", () => {
    expect(named('dev')).toEqual({ VITE_ABOUT_ORIGIN: 'https://dev.about.tokencircles.com' })
  })

  it('leave the production build on its default', () => {
    expect(named('production')).toEqual({})
  })
})
