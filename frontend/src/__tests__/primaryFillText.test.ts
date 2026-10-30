/**
 * A primary fill takes its text colour from `--on-primary`, never from a hardcoded colour.
 *
 * When this guard was written, 57 stylesheet rules and 9 inline styles set a hardcoded colour on
 * a primary fill, nearly all of them white. White reads in the light theme (4.63:1) and fails in
 * the dark one (2.69:1), so a new rule written that way looks right to whoever checks it in light
 * mode. The token is dark ink in the dark themes and white in the
 * light one; onPrimaryContrast.test.ts measures it in all three.
 *
 * Two scans:
 * - every stylesheet under src/: a rule whose background reads --primary, --primary-hover or
 *   --primary-strong must not give color, fill or stroke a colour literal (hex, rgb(), hsl() or a
 *   named colour, including as a var() fallback). var(--on-primary, #fff) is fine: the fallback
 *   is never reached, because every theme defines the token.
 * - inline styles in .ts/.tsx: a style string or object literal that sets a primary background
 *   must not carry a colour literal for its text either.
 *
 * Rules that pass for a stated reason are listed in EXCEPTIONS; an exception that no longer
 * matches anything fails, so the list cannot go stale.
 */
/* eslint-disable security/detect-non-literal-fs-filename -- every path is walked from src/, not
   supplied by anything outside this file. */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = resolve(__dirname, '..')

function walk(dir: string, keep: (name: string) => boolean, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry !== '__tests__') walk(full, keep, found)
    } else if (keep(entry)) found.push(full)
  }
  return found
}

/** A background that is a primary fill: --primary itself or one of its solid shades. */
const PRIMARY_FILL = /var\(\s*--primary(?:-hover|-strong)?\s*[,)]/

const NAMED = /(?:^|[\s,(:'"])(white|black|whitesmoke|snow|ghostwhite|ivory)(?=$|[\s,;)'"])/i

/** True when the value names a colour outright rather than through a token. */
function hasColourLiteral(value: string): boolean {
  // --on-primary is the answer; whatever fallback it carries is never reached.
  const v = value.replace(/var\(\s*--on-primary\b[^)]*\)/g, '')
  return /#[0-9a-f]{3,8}\b/i.test(v) || /\b(?:rgba?|hsla?)\(/i.test(v) || NAMED.test(v)
}

interface Rule {
  file: string
  line: number
  selector: string
  decls: [string, string][]
}

/** Innermost blocks of a stylesheet, with their declarations. Nested @media blocks are walked. */
function cssRules(file: string): Rule[] {
  const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, (c) =>
    c.replace(/[^\n]/g, ' ')
  )
  const rules: Rule[] = []
  const open: { selector: string; body: number; line: number }[] = []
  let start = 0
  for (let i = 0; i < css.length; i++) {
    if (css[i] === '{') {
      const selector = css.slice(start, i).split(/[;}]/).pop()!.trim()
      open.push({ selector, body: i + 1, line: css.slice(0, i).split('\n').length })
      start = i + 1
    } else if (css[i] === '}') {
      const block = open.pop()
      if (block) {
        const body = css.slice(block.body, i)
        const decls = body
          .split(';')
          .map((d) => d.trim())
          .filter((d) => /^-?[a-z-]+\s*:/i.test(d))
          .map((d) => {
            const at = d.indexOf(':')
            return [d.slice(0, at).trim().toLowerCase(), d.slice(at + 1).trim()] as [string, string]
          })
        rules.push({ file: relative(SRC, file), line: block.line, selector: block.selector, decls })
      }
      start = i + 1
    }
  }
  return rules
}

const TEXT_PROPS = new Set(['color', 'fill', 'stroke', '-webkit-text-fill-color'])

/**
 * Rules allowed a literal on a primary fill, each for a reason that a reader can check.
 * `where` is `file:selector` for a stylesheet rule, `file:` plus a snippet for an inline style.
 */
const EXCEPTIONS: { where: string; reason: string }[] = [
  {
    where: 'styles/index.css:::selection',
    reason:
      'Selected text paints --primary-strong, #3b6fe0 in both themes. White is 4.63:1 there; ' +
      "--on-primary's dark-theme night ink would be 4.15:1, so this one keeps white.",
  },
  {
    where: "components/BillingPlans.tsx:color: mine() ? '#fff' : 'var(--on-primary)'",
    reason:
      "The plan badge is --success when it is the user's plan and --primary otherwise. The " +
      "'#fff' belongs to the success branch; the primary branch reads --on-primary.",
  },
]

function cssOffenders(): string[] {
  const found: string[] = []
  for (const file of walk(SRC, (n) => n.endsWith('.css'))) {
    for (const rule of cssRules(file)) {
      const fill = rule.decls.some(([p, v]) => p.startsWith('background') && PRIMARY_FILL.test(v))
      if (!fill) continue
      for (const [prop, value] of rule.decls) {
        if (TEXT_PROPS.has(prop) && hasColourLiteral(value)) {
          found.push(
            `${rule.file}:${rule.selector.replace(/\s+/g, ' ')}|${rule.line}: ${prop}: ${value}`
          )
        }
      }
    }
  }
  return found
}

/** Split an object literal's body at the commas and line breaks outside quotes and parentheses. */
function topLevelParts(body: string): string[] {
  const parts: string[] = []
  let depth = 0
  let quote = ''
  let from = 0
  for (let i = 0; i < body.length; i++) {
    const c = body[i]
    if (quote) {
      if (c === quote) quote = ''
    } else if (c === "'" || c === '"' || c === '`') quote = c
    else if (c === '(') depth++
    else if (c === ')') depth--
    else if ((c === ',' || c === '\n') && depth === 0) {
      parts.push(body.slice(from, i))
      from = i + 1
    }
  }
  parts.push(body.slice(from))
  return parts
}

/** Inline style strings (`style="a: b; c: d"`) and innermost object literals in .ts/.tsx. */
function inlineOffenders(): string[] {
  const found: string[] = []
  const files = walk(
    SRC,
    (n) => /\.tsx?$/.test(n) && !/\.(test|spec)\.tsx?$/.test(n) && !n.endsWith('.d.ts')
  )
  for (const file of files) {
    const src = readFileSync(file, 'utf8')
    const rel = relative(SRC, file)
    const lineOf = (at: number) => src.slice(0, at).split('\n').length

    for (const m of src.matchAll(/style="([^"]*)"/g)) {
      const decls = m[1].split(';').map((d) => d.split(':').map((s) => s.trim()))
      const fill = decls.some(([p, v]) => p?.startsWith('background') && v && PRIMARY_FILL.test(v))
      const text = decls.find(([p, v]) => p && TEXT_PROPS.has(p) && v && hasColourLiteral(v))
      if (fill && text) found.push(`${rel}:${text.join(': ')}|${lineOf(m.index)}`)
    }

    // Object literals: `key: value` pairs, a value running to the next top-level comma.
    for (const m of src.matchAll(/\{[^{}]*\}/g)) {
      const pairs = topLevelParts(m[0].slice(1, -1)).flatMap((part) => {
        const kv = /^['"]?([a-z-]+)['"]?\s*:([\s\S]*)$/i.exec(part.trim())
        return kv ? [[kv[1].toLowerCase(), kv[2].trim()] as const] : []
      })
      const fill = pairs.some(([k, v]) => k.startsWith('background') && PRIMARY_FILL.test(v))
      if (!fill) continue
      for (const [k, v] of pairs) {
        if (TEXT_PROPS.has(k) && hasColourLiteral(v))
          found.push(`${rel}:${k}: ${v}|${lineOf(m.index)}`)
      }
    }
  }
  return found
}

describe('text on a primary fill', () => {
  const offenders = [...cssOffenders(), ...inlineOffenders()]
  const excused = (o: string) => EXCEPTIONS.some((e) => o.split('|')[0] === e.where)

  it('reads var(--on-primary), never a hardcoded colour', () => {
    expect(offenders.filter((o) => !excused(o))).toEqual([])
  })

  it('every exception still matches a rule', () => {
    const stale = EXCEPTIONS.filter((e) => !offenders.some((o) => o.split('|')[0] === e.where))
    expect(stale.map((e) => e.where)).toEqual([])
  })

  it('finds the white text it is there to stop', () => {
    // The scan itself, on the shapes the sweep fixed: if this stops finding them, the guard above
    // passes for the wrong reason.
    expect(hasColourLiteral('#fff')).toBe(true)
    expect(hasColourLiteral('white')).toBe(true)
    expect(hasColourLiteral('rgba(255, 255, 255, 0.9)')).toBe(true)
    expect(hasColourLiteral('var(--primary-contrast, #fff)')).toBe(true)
    expect(hasColourLiteral("interval() === opt ? '#fff' : 'var(--text-secondary)'")).toBe(true)
    expect(hasColourLiteral('var(--on-primary)')).toBe(false)
    expect(hasColourLiteral('var(--on-primary, #fff)')).toBe(false)
    expect(hasColourLiteral('var(--text)')).toBe(false)
    expect(hasColourLiteral('inherit')).toBe(false)
  })
})
