/**
 * A toast must not print a caught error's `.message`.
 *
 * A caught error is whatever went wrong, in whatever words it came with. Sometimes that is the
 * server's sentence. As often it is "Failed to fetch", "Validation failed", "HTTP 502" or
 * "Cannot read properties of undefined (reading 'id')", none of which tells a person what to do.
 * `err instanceof Error ? err.message : 'Could not save'` looks careful and prints all of them.
 *
 * The rule (docs/plans/2026-10-07-form-errors.md, and rule 5 in .claude/skills/solid-forms):
 *
 * - A form's errors stay in the form. The kit in components/form marks the field and says why.
 * - Work with no form in front of the person (a swatch click, a delete, a background reload) may
 *   toast a failure, through `plainMessage(err, fallback)`: an `ApiError`'s own words, or the
 *   fallback for anything else.
 *
 * This scans every source file with the TypeScript parser, finds the toasts inside a `catch`
 * block or a `.catch()` callback, and flags each one whose message reads the caught error's
 * `.message`, directly or through a local variable assigned from it. The files below did so
 * before the rule; each is held at its count. A new one fails, and so does a file that has fewer
 * than its count, so that the list only ever shrinks: take the entry out when you fix one.
 */
/* eslint-disable security/detect-non-literal-fs-filename -- every path is walked from src/, not
   supplied by anything outside this file. */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const SRC = resolve(__dirname, '..')

/** Files that toasted a caught error's message before the rule, and how many times. */
const KNOWN: Record<string, number> = {
  'components/RecurringSection.tsx': 1,
  'components/ResendVerification.tsx': 1,
  'components/onboarding/OnboardingWizard.tsx': 2,
  'features/CompoundInterestCalculator.tsx': 1,
  'features/EmergencyFundCalculator.tsx': 1,
  'features/Loans.tsx': 2,
  'features/Settings.tsx': 5,
  'features/Tags.tsx': 6,
  'features/Transactions.tsx': 1,
}

const TOASTS = new Set(['toast', 'showToast', 'addToast'])

function isToast(callee: ts.Expression): boolean {
  if (ts.isIdentifier(callee)) return TOASTS.has(callee.text)
  return ts.isPropertyAccessExpression(callee) && TOASTS.has(callee.name.text)
}

/** `(err as Error)`, `err!` and `(err)` are all `err`. */
function unwrap(node: ts.Expression): ts.Expression {
  let inner = node
  while (
    ts.isParenthesizedExpression(inner) ||
    ts.isAsExpression(inner) ||
    ts.isNonNullExpression(inner) ||
    ts.isTypeAssertionExpression(inner) ||
    ts.isSatisfiesExpression(inner)
  ) {
    inner = inner.expression
  }
  return inner
}

/** Does `node` read `<name>.message` anywhere inside it? */
function readsMessageOf(node: ts.Node, name: string): boolean {
  let found = false
  const visit = (n: ts.Node) => {
    if (found) return
    if (ts.isPropertyAccessExpression(n) && n.name.text === 'message') {
      const target = unwrap(n.expression)
      if (ts.isIdentifier(target) && target.text === name) {
        found = true
        return
      }
    }
    ts.forEachChild(n, visit)
  }
  visit(node)
  return found
}

/** Does `node` use any of `names` as a value (not as a property name)? */
function mentions(node: ts.Node, names: Set<string>): boolean {
  let found = false
  const visit = (n: ts.Node) => {
    if (found) return
    if (
      ts.isIdentifier(n) &&
      names.has(n.text) &&
      !(ts.isPropertyAccessExpression(n.parent) && n.parent.name === n)
    ) {
      found = true
      return
    }
    ts.forEachChild(n, visit)
  }
  visit(node)
  return found
}

/** The 1-based lines of every toast in `source` that prints a caught error's message. */
export function rawErrorToasts(source: string, fileName = 'sample.tsx'): number[] {
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  )
  const flagged = new Set<number>()

  const scan = (scope: ts.Node, caught: string) => {
    // Locals assigned from the caught error's message: `const message = err instanceof Error ?
    // err.message : '...'`, then `toast(message)` a few lines on.
    const derived = new Set<string>()
    const collect = (n: ts.Node) => {
      if (
        ts.isVariableDeclaration(n) &&
        ts.isIdentifier(n.name) &&
        n.initializer &&
        readsMessageOf(n.initializer, caught)
      ) {
        derived.add(n.name.text)
      }
      ts.forEachChild(n, collect)
    }
    collect(scope)

    const visit = (n: ts.Node) => {
      if (ts.isCallExpression(n) && isToast(n.expression) && n.arguments.length > 0) {
        const message = n.arguments[0]
        if (readsMessageOf(message, caught) || mentions(message, derived)) {
          flagged.add(n.getStart(file))
        }
      }
      ts.forEachChild(n, visit)
    }
    visit(scope)
  }

  const walk = (n: ts.Node) => {
    if (ts.isCatchClause(n)) {
      const name = n.variableDeclaration?.name
      if (name && ts.isIdentifier(name)) scan(n.block, name.text)
    }
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      n.expression.name.text === 'catch'
    ) {
      const handler = n.arguments.at(0)
      const param = handler && ts.isFunctionLike(handler) ? handler.parameters.at(0) : undefined
      if (handler && param && ts.isIdentifier(param.name)) scan(handler, param.name.text)
    }
    ts.forEachChild(n, walk)
  }
  walk(file)

  return [...flagged]
    .map((pos) => file.getLineAndCharacterOfPosition(pos).line + 1)
    .sort((a, b) => a - b)
}

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry !== '__tests__') sourceFiles(full, found)
    } else if (/\.tsx?$/.test(entry) && !/\.(d|test)\.tsx?$/.test(entry)) {
      found.push(full)
    }
  }
  return found
}

describe('the scanner', () => {
  const flags = (code: string) => rawErrorToasts(code).length

  it.each([
    [
      'a ternary on the caught error',
      `try { save() } catch (err) { showToast(err instanceof Error ? err.message : 'x', 'error') }`,
    ],
    ['an or-fallback', `try { save() } catch (e: any) { toast(e.message || 'x', 'error') }`],
    [
      'a template literal',
      'try { save() } catch (error) { toast(`Restore failed: ${(error as Error).message}`) }',
    ],
    [
      'a local assigned from it',
      `try { save() } catch (error) {
         const message =
           error instanceof Error ? error.message : 'x'
         toast(message, 'error')
       }`,
    ],
    ['a .catch() callback', `save().catch((err) => showToast((err as Error).message, 'error'))`],
    ['a store method', `try { save() } catch (err) { store.addToast(err!.message) }`],
  ])('flags %s', (_name, code) => {
    expect(flags(code)).toBe(1)
  })

  it.each([
    ['a success message from a result', `toast(result.message || 'Done', 'success')`],
    [
      'plainMessage',
      `try { save() } catch (err) { toast(plainMessage(err, 'Could not save. Try again.'), 'error') }`,
    ],
    [
      'a message that only reaches the console',
      `try { save() } catch (err) { console.error(err.message); toast('Could not save.', 'error') }`,
    ],
    [
      'a property named like a tainted local',
      `try { save() } catch (err) { const message = err.message; toast(result.message) }`,
    ],
    ['a toast outside any catch', `const err = new Error('x'); toast(err.message)`],
  ])('leaves %s alone', (_name, code) => {
    expect(flags(code)).toBe(0)
  })

  it('counts a toast once when an inner catch reuses the outer name', () => {
    const code = `try { a() } catch (err) { try { b() } catch (err) { toast(err.message) } }`
    expect(rawErrorToasts(code)).toEqual([1])
  })
})

describe('toasts that print a caught error', () => {
  const found = new Map<string, number[]>()
  for (const file of sourceFiles(SRC)) {
    const lines = rawErrorToasts(readFileSync(file, 'utf8'), file)
    if (lines.length > 0) found.set(relative(SRC, file), lines)
  }

  it('appear in no file that is not on the list', () => {
    const unlisted = [...found]
      .filter(([file]) => !(file in KNOWN))
      .map(([file, lines]) => `${file}:${lines.join(',')}`)
    expect(
      unlisted,
      'Toast plainMessage(err, fallback) for work with no form, or show the error in the form ' +
        '(components/form). A caught error has no words for a person.'
    ).toEqual([])
  })

  it('do not grow in a listed file', () => {
    const grown = [...found]
      .filter(([file, lines]) => file in KNOWN && lines.length > KNOWN[file])
      .map(
        ([file, lines]) => `${file}: ${lines.length} (was ${KNOWN[file]}), lines ${lines.join(',')}`
      )
    expect(grown, 'A listed file has a new one. Use plainMessage(err, fallback).').toEqual([])
  })

  it('shrink the list when one is fixed', () => {
    const shrunk = Object.entries(KNOWN)
      .filter(([file, count]) => (found.get(file)?.length ?? 0) < count)
      .map(([file, count]) => `${file}: ${found.get(file)?.length ?? 0} (listed ${count})`)
    expect(shrunk, 'Lower the count in KNOWN, or take the file out at zero.').toEqual([])
  })
})
