/**
 * "Today" in the app is the person's date, never the UTC one.
 *
 * `new Date().toISOString().slice(0, 10)` reads like today and is the UTC date: east of UTC it is
 * still yesterday for the first hours of every day (at 00:30 in Zagreb on 8 October it says the
 * 7th), and west of UTC it is already tomorrow every evening. Forms that opened on it offered
 * yesterday's date. utils/period.ts has the local one: localToday(), and isoDate() for any Date.
 *
 * This scans the app's source for the UTC shapes and fails on any that is not on the list below of
 * uses that really mean a UTC date.
 */
/* eslint-disable security/detect-non-literal-fs-filename -- every path is walked from src/, not
   taken from input. */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = resolve(__dirname, '..')

// toISOString() cut down to its date or month: .slice(0, 10), .substring(0, 7), .split('T')[0].
const UTC_DATE_SHAPES = [
  /toISOString\(\)\s*\.\s*slice\(\s*0\s*,\s*(?:7|10)\s*\)/,
  /toISOString\(\)\s*\.\s*substring\(\s*0\s*,\s*(?:7|10)\s*\)/,
  /toISOString\(\)\s*\.\s*split\(\s*['"`]T['"`]\s*\)\s*\[\s*0\s*\]/,
]
const cutsUtcDate = (line: string): boolean => UTC_DATE_SHAPES.some((shape) => shape.test(line))

/**
 * Uses that mean a UTC date, by file and the line's text. Each is a Date built from UTC fields
 * (Date.UTC, a UTC-midnight timestamp), where toISOString() prints exactly the date it was made
 * from.
 */
const ALLOWED: Array<{ file: string; line: string; why: string }> = [
  {
    file: 'core/entry/parseEntry.ts',
    line: 'return dt.toISOString().slice(0, 10)',
    why: 'shiftDate builds dt with Date.UTC from a YYYY-MM-DD',
  },
  {
    file: 'features/subscriptionDetection.ts',
    line: 'return new Date(ms).toISOString().slice(0, 10)',
    why: 'toIsoDate prints a UTC-midnight day number from parseDay',
  },
]

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      if (name === '__tests__' || name === 'node_modules') continue
      out.push(...sourceFiles(path))
    } else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name)) {
      out.push(path)
    }
  }
  return out
}

/** Every line that cuts a UTC date out of toISOString(), comments left out. */
function utcDateLines(): Array<{ file: string; line: string; at: string }> {
  const found: Array<{ file: string; line: string; at: string }> = []
  for (const path of sourceFiles(SRC)) {
    const file = relative(SRC, path).split('\\').join('/')
    readFileSync(path, 'utf8')
      .split('\n')
      .forEach((text, i) => {
        const line = text.trim()
        if (line.startsWith('//') || line.startsWith('*') || line.startsWith('/*')) return
        if (cutsUtcDate(line)) found.push({ file, line, at: `${file}:${i + 1}` })
      })
  }
  return found
}

describe('no UTC "today" in the app', () => {
  it('cuts a date out of toISOString() only where the date is a UTC one', () => {
    const offending = utcDateLines()
      .filter(({ file, line }) => !ALLOWED.some((a) => a.file === file && line.includes(a.line)))
      .map(({ at, line }) => `${at}  ${line}`)
    expect(offending, 'use localToday() or isoDate() from utils/period').toEqual([])
  })

  it('lists no allowed use that is gone', () => {
    const found = utcDateLines()
    const stale = ALLOWED.filter(
      (a) => !found.some(({ file, line }) => file === a.file && line.includes(a.line))
    )
    expect(stale).toEqual([])
  })

  it('finds the shapes it looks for', () => {
    for (const shape of [
      'new Date().toISOString().slice(0, 10)',
      'now.toISOString().slice(0,7)',
      "new Date().toISOString().split('T')[0]",
      'd.toISOString().substring(0, 10)',
    ]) {
      expect(cutsUtcDate(shape), shape).toBe(true)
    }
    expect(cutsUtcDate('new Date().toISOString()')).toBe(false)
  })
})
