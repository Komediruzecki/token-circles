/**
 * Words in the display face stand as far apart as the body's.
 *
 * Fraunces, the display face, has a narrow space: 0.19em once a heading's -0.01em tracking takes
 * its share, where Inter, the body face, leaves 0.27em. At 15 px that is 2.9 px against 4, and
 * "Map columns" read almost as one word (review of 19 Nov 2026). Widening that one heading left
 * "Recent Imports", on the same page, with the narrow space. So the space goes wherever the face
 * does: every rule that sets `--font-display` also sets `--font-display-word-spacing`. The h1/h2
 * rule sets it on every heading, so a heading that a class moves to another face gives it back.
 *
 * Like cssModuleNaming.test.ts, these read the files off disk: no component test applies the
 * stylesheets.
 */
/* eslint-disable security/detect-non-literal-fs-filename -- every path is walked from src/, not
   supplied by anything outside this file. */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = resolve(__dirname, '..')

function files(dir: string, name: RegExp, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry !== '__tests__') files(full, name, found)
    } else if (name.test(entry)) found.push(full)
  }
  return found
}

interface Rule {
  selectors: string[]
  body: string
}

/** Every rule in a stylesheet. Comments go first, so one that quotes a rule is not read as it. */
function rules(file: string): Rule[] {
  const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ')
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selectors, body]) => ({
    selectors: selectors.split(',').map((selector) => selector.trim().replace(/\s+/g, ' ')),
    body,
  }))
}

const SETS_DISPLAY_FACE = /(?:^|[;\s])font-family\s*:\s*var\(--font-display\b/
const SETS_DISPLAY_SPACE = /(?:^|[;\s])word-spacing\s*:\s*var\(--font-display-word-spacing\)/
const FONT_FAMILY = /(?:^|[;\s])font-family\s*:\s*([^;]+)/
const GIVES_SPACE_BACK = /(?:^|[;\s])word-spacing\s*:\s*normal\b/

const toCamel = (name: string) => name.replace(/-(\w)/g, (_, c: string) => c.toUpperCase())

/** Whether a selector's last compound carries the class a module exports as `name`. */
function endsOnClass(selector: string, name: string): boolean {
  const last = selector.split(/[\s>+~]+/).pop() ?? ''
  return [...last.matchAll(/\.([\w-]+)/g)].some(([, cls]) => cls === name || toCamel(cls) === name)
}

describe('the display face word spacing', () => {
  it('is set by every rule that sets the display face', () => {
    const display: string[] = []
    const bare: string[] = []
    for (const file of files(SRC, /\.css$/)) {
      for (const rule of rules(file)) {
        if (!SETS_DISPLAY_FACE.test(rule.body)) continue
        const where = `${relative(SRC, file)}: ${rule.selectors.join(', ')}`
        display.push(where)
        if (!SETS_DISPLAY_SPACE.test(rule.body)) bare.push(where)
      }
    }
    // The walk found the rule every heading takes, so an empty list below means something.
    expect(display).toContain(`${join('styles', 'index.css')}: h1, h2`)
    expect(bare).toEqual([])
  })

  it('is 0.08em, declared once beside the face', () => {
    const declared = files(SRC, /\.css$/).flatMap((file) =>
      [
        ...readFileSync(file, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, ' ')
          .matchAll(/--font-display-word-spacing\s*:\s*([^;]+);/g),
      ].map(([, value]) => `${relative(SRC, file)}: ${value.trim()}`)
    )
    expect(declared).toEqual([`${join('styles', 'themes', 'dawn-light.css')}: 0.08em`])
  })

  it('is given back by an h1 or h2 that a class sets in another face', () => {
    const moved: string[] = []
    const kept: string[] = []
    for (const file of files(SRC, /\.tsx$/)) {
      const source = readFileSync(file, 'utf8')
      const modules = new Map(
        [...source.matchAll(/import\s+(\w+)\s+from\s+'([^']+\.module\.css)'/g)].map(
          ([, name, path]) => [name, resolve(dirname(file), path)] as const
        )
      )
      for (const [, classes] of source.matchAll(/<h[12]\b[^>]*?\bclass=\{([^}]*)\}/g)) {
        for (const [, module, name] of classes.matchAll(/(\w+)\.(\w+)/g)) {
          const stylesheet = modules.get(module)
          if (!stylesheet) continue
          const own = rules(stylesheet).filter((rule) =>
            rule.selectors.some((selector) => endsOnClass(selector, name))
          )
          const face = own.map((rule) => FONT_FAMILY.exec(rule.body)?.[1].trim()).find(Boolean)
          if (!face || face.startsWith('var(--font-display')) continue
          const where = `${relative(SRC, file)}: ${module}.${name} (${face})`
          moved.push(where)
          if (!own.some((rule) => GIVES_SPACE_BACK.test(rule.body))) kept.push(where)
        }
      }
    }
    // Progress's "Your next step" is an h2 in Inter: the walk has to find it.
    expect(moved).toContain(
      `${join('components', 'guidance', 'NextStepCard.tsx')}: styles.eyebrow (inherit)`
    )
    expect(kept).toEqual([])
  })
})
