/**
 * The benchmarks gate (core/guidanceGate.ts): the production build holds the benchmarks back
 * unless VITE_ENABLE_BENCHMARKS=true; dev, previews (`--mode dev`), `pnpm dev` and the E2E server
 * (`development`) show them.
 */
import { afterEach, expect, it, vi } from 'vitest'
import { benchmarksShown } from '../guidanceGate'

afterEach(() => {
  vi.unstubAllEnvs()
})

it('holds the benchmarks back in the production build', () => {
  vi.stubEnv('MODE', 'production')
  vi.stubEnv('VITE_ENABLE_BENCHMARKS', '')
  expect(benchmarksShown()).toBe(false)
  vi.stubEnv('VITE_ENABLE_BENCHMARKS', 'false')
  expect(benchmarksShown()).toBe(false)
})

it('shows them in production when VITE_ENABLE_BENCHMARKS is true', () => {
  vi.stubEnv('MODE', 'production')
  vi.stubEnv('VITE_ENABLE_BENCHMARKS', 'true')
  expect(benchmarksShown()).toBe(true)
})

it('shows them on dev, previews, local builds and the E2E server', () => {
  for (const mode of ['dev', 'development', 'test']) {
    vi.stubEnv('MODE', mode)
    expect(benchmarksShown()).toBe(true)
  }
})
