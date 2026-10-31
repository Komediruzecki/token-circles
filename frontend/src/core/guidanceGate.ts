/**
 * What the production build holds back of the guidance until a lawyer has read it (b2, 29 Oct
 * 2026): the benchmark cards, the free-money question and check, the Dashboard gauge's band, and
 * setup's region and household questions, which only choose the figures those compare with. The ledger, the circle views and the questions that feed them show in every
 * build.
 *
 * Opening the gate is one commit: it removes this function and its callers, and moves the held
 * CHANGELOG lines (dev-changelog.md, "Lines for CHANGELOG.md when the benchmarks gate opens") into
 * CHANGELOG.md.
 */

// The benchmark cards and the free-money questions wait for a lawyer's read (b2, 29 Oct 2026):
// shown on dev, previews and local builds, hidden in the production build, the way account
// deletion is (features/Settings.tsx). VITE_ENABLE_BENCHMARKS=true shows them anyway.
export function benchmarksShown(): boolean {
  return import.meta.env.MODE !== 'production' || import.meta.env.VITE_ENABLE_BENCHMARKS === 'true'
}
