/**
 * The copy on redesigned pages keeps to the owner's product voice (plan 05 of the brand redesign):
 * none of the banned mood and sales words, and no em dash, in anything a person can read.
 *
 * It reads each file's JSX text, string literals and template literal text through the TypeScript
 * parser, so comments and code are never mistaken for copy, and a sentence built in a helper such
 * as `loanCopy.ts` is read just as a heading in a component is. A literal use, such as unlocking a
 * device, goes in ALLOWED with the file and the exact text, not by loosening a pattern.
 *
 * It covers the pages redesigned so far and widens as more are: add a page's files to SCOPE when
 * its copy has been through the pass.
 */
/* eslint-disable security/detect-non-literal-fs-filename -- every path is walked from SCOPE,
   not supplied by anything outside this file. */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const SRC = resolve(__dirname, '..')

/** The redesigned surfaces, as files or folders under src/. Tests inside them are skipped. */
const SCOPE = ['features/Loans.tsx', 'features/loans']

/** A literal use of a listed word, by file (relative to src/) and the exact text it appears in. */
const ALLOWED: { file: string; text: string }[] = []

const BANNED: [string, RegExp][] = [
  ['calm', /\bcalm(?:er|est|ing|ly)?\b/i],
  ['seamless', /\bseamless(?:ly)?\b/i],
  ['effortless', /\beffortless(?:ly)?\b/i],
  ['intuitive', /\bintuitive(?:ly)?\b/i],
  ['delightful', /\bdelightful(?:ly)?\b/i],
  ['elevate', /\belevat(?:e|es|ed|ing)\b/i],
  ['empower', /\bempower(?:s|ed|ing|ment)?\b/i],
  ['unlock', /\bunlock(?:s|ed|ing)?\b/i],
  ['journey', /\bjourneys?\b/i],
  ['reimagine', /\breimagin(?:e|es|ed|ing)\b/i],
  ['curated', /\bcurated\b/i],
  ['em dash', /—/],
]

/** What in `text` breaks the voice: the names of the rules it trips, none when it is fine. */
function voiceProblems(text: string): string[] {
  return BANNED.filter(([, pattern]) => pattern.test(text)).map(([name]) => name)
}

function sourceFiles(path: string, found: string[] = []): string[] {
  const full = join(SRC, path)
  if (statSync(full).isDirectory()) {
    for (const entry of readdirSync(full)) {
      if (entry === '__tests__') continue
      sourceFiles(join(path, entry), found)
    }
  } else if (/\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path)) {
    found.push(full)
  }
  return found
}

/** Every piece of text in a file a person could read: JSX text, string and template literals. */
function copyIn(fileName: string, source: string): string[] {
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  )
  const found: string[] = []
  const visit = (node: ts.Node) => {
    // A module path is not copy.
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return
    if (ts.isJsxText(node)) {
      const text = node.text.trim()
      if (text) found.push(text)
    } else if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      if (node.text.trim()) found.push(node.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return found
}

const files = SCOPE.flatMap((path) => sourceFiles(path))
const copy = files.flatMap((full) =>
  copyIn(full, readFileSync(full, 'utf8')).map((text) => ({ file: relative(SRC, full), text }))
)

describe('product voice on redesigned pages', () => {
  it('reads the copy it is meant to guard', () => {
    // A scan that finds nothing passes everything: prove it reaches components and helpers.
    expect(files.length).toBeGreaterThan(5)
    const texts = copy.map((c) => c.text)
    expect(texts).toContain('Compare both modes')
    expect(texts).toContain('What if')
    // A template literal's text, from the sentences loanCopy.ts builds.
    expect(texts.some((t) => t.includes('would never be repaid'))).toBe(true)
  })

  it('catches each banned word, its inflections and an em dash', () => {
    for (const sample of [
      'A calmer view',
      'Seamlessly synced',
      'Effortless saving',
      'An intuitive form',
      'Delightful charts',
      'Elevate your budget',
      'Empowering you',
      'Unlock insights',
      'Your money journey',
      'Loans, reimagined',
      'A curated list',
      'Done — sooner',
    ]) {
      expect(voiceProblems(sample), sample).not.toEqual([])
    }
    expect(voiceProblems('Finish sooner, or pay less each month.')).toEqual([])
  })

  it('finds no banned word and no em dash in the copy', () => {
    const problems = copy
      // eslint-disable-next-line sonarjs/no-empty-collection -- empty until a literal use needs it
      .filter((c) => !ALLOWED.some((a) => a.file === c.file && a.text === c.text))
      .map((c) => ({ ...c, problems: voiceProblems(c.text) }))
      .filter((c) => c.problems.length > 0)
    expect(problems).toEqual([])
  })
})
