/**
 * Every date the app shows goes through shared/dateFormat.ts.
 *
 * Each page had its own formatter: `toLocaleDateString('en-US')` put the month first, a bare
 * `toLocaleDateString()` wrote the browser's own numeric form, `'default'` and `undefined` followed
 * the browser's language, and most of them read a stored 'YYYY-MM-DD' as midnight UTC, a day early
 * west of Greenwich (first-week test run, B6). A formatter written into a page again would bring
 * one of those back, so this reads the source for them.
 *
 * Allowed: reading a time zone or its wall clock (apiFetch.ts, shared/calendarDate.ts), the time
 * of day in the log viewer and the console log, and the mails, which keep their own formats.
 */
/* eslint-disable security/detect-non-literal-fs-filename -- every path is walked from the repo's
   own source folders, not supplied by anything outside this file. */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const REPO = join(import.meta.dirname, '..', '..', '..')

function sources(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      if (name === '__tests__' || name === 'node_modules') continue
      out.push(...sources(path))
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(path)
    }
  }
  return out
}

const FORMATTERS = [
  /\.toLocaleDateString\(/,
  /\.toLocaleTimeString\(/,
  /Intl\.DateTimeFormat\(/,
  /\.toLocaleString\(\s*'default'/,
  /\.toLocaleString\(\s*undefined/,
  /new Date\([^)]*\)\.toLocaleString\(/,
  /timeFormat\('%b %d/,
]

const ALLOWED: Record<string, RegExp[]> = {
  // The browser's zone, sent as X-Time-Zone; nothing is shown.
  'frontend/src/core/apiFetch.ts': [/Intl\.DateTimeFormat\(\)\.resolvedOptions\(\)\.timeZone/],
  // The wall clock in the person's zone, for "today" on the Worker; nothing is shown.
  'shared/calendarDate.ts': [/new Intl\.DateTimeFormat\('en-US', \{/],
  // A time of day, beside the date the shared formatter writes.
  'frontend/src/components/LogViewer.tsx': [/new Date\(log\.timestamp\)\.toLocaleTimeString\(\)/],
  'frontend/src/core/logger.ts': [/new Date\(timestamp\)\.toLocaleTimeString\(\)/],
  // The mails keep their own formats.
  'worker/src/reminders.ts': [/asOf\.toLocaleDateString\('en-US'/],
  'worker/src/emailTemplates.ts': [/opts\.nextAttempt\.toLocaleDateString\('en-GB'/],
}

function offenders(dir: string): string[] {
  const found: string[] = []
  for (const file of sources(join(REPO, dir))) {
    const rel = relative(REPO, file)
    const lines = readFileSync(file, 'utf8').split('\n')
    lines.forEach((line, i) => {
      const code = line.trim()
      if (code.startsWith('*') || code.startsWith('//') || code.startsWith('/*')) return
      if (!FORMATTERS.some((re) => re.test(code))) return
      if ((ALLOWED[rel] ?? []).some((re) => re.test(code))) return
      found.push(`${rel}:${i + 1}: ${code}`)
    })
  }
  return found
}

describe('dates go through the one formatter', () => {
  it('in the app', () => {
    expect(offenders('frontend/src')).toEqual([])
  })

  it('on the Worker and in shared code', () => {
    expect([...offenders('worker/src'), ...offenders('shared')]).toEqual([])
  })
})
