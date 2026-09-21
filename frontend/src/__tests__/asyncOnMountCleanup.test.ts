/**
 * An `onCleanup` after an `await` inside an async `onMount` never runs.
 *
 * Solid tracks `onCleanup` against the owner that is current when the call happens. `onMount`'s
 * callback starts inside that owner, but the first `await` ends the synchronous run — everything
 * after it resumes on a microtask with no owner, so every later `onCleanup` is silently dropped.
 * Nothing reports it: TypeScript is happy, eslint has no rule for it, and the app works, because
 * the listener is added correctly. Only the removal is missing.
 *
 * It shipped in `App.tsx`. Its `onMount` awaits `api.checkLogin()` and then registers three
 * document-level `keydown` handlers plus two disposers, all with `onCleanup`. All five were dead:
 * a leak per App mount, and — the visible symptom — duplicated global key handlers whenever the
 * shell mounted twice without a page load, so one arrow keypress stepped the focus period twice.
 *
 * The fix is not to move code around. Register ONE `onCleanup` synchronously, before the first
 * await, and have the post-await code push its teardowns onto a list that it drains:
 *
 *     const lateTeardowns: Array<() => void> = []
 *     onCleanup(() => { for (const t of lateTeardowns.splice(0)) t() })
 *     await something()
 *     lateTeardowns.push(() => document.removeEventListener('keydown', handler))
 *
 * This is a source scan and not a component test because the defect is an absence, in a callback
 * that runs correctly right up until teardown — and teardown is what no test was exercising.
 */
/* eslint-disable security/detect-non-literal-fs-filename -- every path is walked from src/, not
   supplied by anything outside this file. */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = resolve(__dirname, '..')

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === '__tests__' || entry === 'node_modules') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) sourceFiles(full, found)
    else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) found.push(full)
  }
  return found
}

/**
 * Replace the CONTENT of comments and string/template literals with spaces, keeping every newline
 * and every offset. Scanning the raw text does not work: the first thing this test found was the
 * word "await" inside the comment that explains the rule, sitting above a perfectly correct
 * `onCleanup`. A guard that cries wolf on prose gets deleted, so it reads only code.
 *
 * Offsets are preserved rather than the text removed, so the reported line number still points at
 * the real line.
 */
function blankNonCode(source: string): string {
  const out = source.split('')
  let i = 0
  const blank = (from: number, to: number) => {
    for (let k = from; k < to && k < out.length; k++) if (out[k] !== '\n') out[k] = ' '
  }
  while (i < source.length) {
    const two = source.slice(i, i + 2)
    if (two === '//') {
      const end = source.indexOf('\n', i)
      const stop = end === -1 ? source.length : end
      blank(i, stop)
      i = stop
    } else if (two === '/*') {
      const end = source.indexOf('*/', i + 2)
      const stop = end === -1 ? source.length : end + 2
      blank(i, stop)
      i = stop
    } else if (source[i] === "'" || source[i] === '"' || source[i] === '`') {
      const quote = source[i]
      let k = i + 1
      while (k < source.length) {
        if (source[k] === '\\') k += 2
        else if (source[k] === quote) break
        else k++
      }
      blank(i + 1, k)
      i = k + 1
    } else {
      i++
    }
  }
  return out.join('')
}

/**
 * The body of each `onMount(async ...)` in `source`, by brace matching from the callback's opening
 * `{`. Brace matching rather than a regex because these bodies are hundreds of lines long and
 * contain every kind of nesting; the alternative is a scanner that stops at the first `}` and
 * declares every file clean.
 */
function asyncOnMountBodies(source: string): { body: string; start: number }[] {
  const bodies: { body: string; start: number }[] = []
  const opener = /onMount\(\s*async\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*\{/g
  let match: RegExpExecArray | null
  while ((match = opener.exec(source)) !== null) {
    const bodyStart = match.index + match[0].length
    let depth = 1
    let i = bodyStart
    while (i < source.length && depth > 0) {
      const ch = source[i]
      if (ch === '{') depth++
      else if (ch === '}') depth--
      i++
    }
    bodies.push({ body: source.slice(bodyStart, i - 1), start: bodyStart })
  }
  return bodies
}

/** Line number (1-based) of `index` within `source`, for a message that can be acted on. */
const lineAt = (source: string, index: number) => source.slice(0, index).split('\n').length

describe('async onMount teardown', () => {
  it('registers no onCleanup after the first await, where the owner is already gone', () => {
    const violations: string[] = []

    for (const file of sourceFiles(SRC)) {
      const raw = readFileSync(file, 'utf8')
      if (!raw.includes('onMount(')) continue
      const source = blankNonCode(raw)

      for (const { body, start } of asyncOnMountBodies(source)) {
        const firstAwait = body.search(/\bawait\b/)
        if (firstAwait === -1) continue

        const after = body.slice(firstAwait)
        const late = /\bonCleanup\s*\(/.exec(after)
        if (!late) continue

        const absolute = start + firstAwait + late.index
        violations.push(
          `${relative(SRC, file)}:${lineAt(source, absolute)} — onCleanup after an await inside ` +
            `an async onMount; it will never run. Push onto a teardown list registered before ` +
            `the first await instead.`
        )
      }
    }

    expect(violations).toEqual([])
  })

  it('detects the shape it is meant to catch', () => {
    // A guard that cannot fail is not a guard. This is the exact code that shipped in App.tsx.
    const broken = `
      onMount(async () => {
        document.addEventListener('click', a)
        onCleanup(() => document.removeEventListener('click', a))
        const loggedIn = await api.checkLogin()
        if (loggedIn) { doThing() }
        document.addEventListener('keydown', b)
        onCleanup(() => document.removeEventListener('keydown', b))
      })
    `
    const [{ body }] = asyncOnMountBodies(blankNonCode(broken))
    const afterAwait = body.slice(body.search(/\bawait\b/))
    expect(/\bonCleanup\s*\(/.test(afterAwait)).toBe(true)

    // ...and passes on the corrected shape, so it is not simply matching everything.
    const fixed = `
      onMount(async () => {
        const lateTeardowns: Array<() => void> = []
        onCleanup(() => { for (const t of lateTeardowns.splice(0)) t() })
        const loggedIn = await api.checkLogin()
        document.addEventListener('keydown', b)
        lateTeardowns.push(() => document.removeEventListener('keydown', b))
      })
    `
    const [{ body: fixedBody }] = asyncOnMountBodies(blankNonCode(fixed))
    const afterFixedAwait = fixedBody.slice(fixedBody.search(/\bawait\b/))
    expect(/\bonCleanup\s*\(/.test(afterFixedAwait)).toBe(false)
  })
})
