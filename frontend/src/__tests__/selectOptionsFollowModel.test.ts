/**
 * A `<select>` whose options are fetched objects must mark the selected option itself.
 *
 * WHY THIS GUARD EXISTS. `<select value={model()}>` is applied when `model()` changes, and only
 * then. Data refetches while forms are open — every write refreshes its readers (#570), and the
 * app refetches everything on resume (#573) — and a refetch returns new objects. `<For>` is keyed
 * by reference, so it rebuilds every `<option>`; removing the selected one resets the select to its
 * first entry while the model keeps the old id. The form showed "Uncategorized" and saved a
 * category the user could no longer see.
 *
 * The fix is `selected={key === model()}` on each option, so a rebuilt option takes its state from
 * the model. transactionFormSelectsSurviveRefetch.test.tsx proves it on the real form; this test
 * fails when a new select is written in the old shape.
 *
 * NOT flagged: options over a module constant (`CURRENCIES`, `MONTH_NAMES`) — the same objects
 * every render, so `<For>` never rebuilds them — and options over primitives (`value={year}`),
 * which `<For>` keys by value.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(import.meta.dirname, '..')

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue
      sourceFiles(full, acc)
      continue
    }
    if (entry.endsWith('.tsx')) acc.push(full)
  }
  return acc
}

/** The `<option ...>` opening tag starting at `from`, reading past `>` inside `{...}`. */
function openingTag(source: string, from: number): string {
  let depth = 0
  for (let i = from; i < source.length; i++) {
    const ch = source[i]
    if (ch === '{') depth++
    else if (ch === '}') depth--
    else if (ch === '>' && depth === 0) return source.slice(from, i + 1)
  }
  return source.slice(from)
}

/** Options rendered by a `<For>` over fetched objects that do not mark themselves selected. */
export function unmarkedOptions(source: string): number[] {
  const lines: number[] = []
  for (const select of source.matchAll(/<select\b[\s\S]*?<\/select>/g)) {
    for (const loop of select[0].matchAll(/<For each=\{([^}]*)\}>([\s\S]*?)<\/For>/g)) {
      const each = loop[1].trim()
      if (/^[A-Z][A-Z0-9_]*$/.test(each)) continue // module constant: stable identity
      const body = loop[2]
      for (const option of body.matchAll(/<option\b/g)) {
        const tag = openingTag(body, option.index)
        const value = /\bvalue=\{([^}]*)\}/.exec(tag)?.[1] ?? ''
        if (!value.includes('.')) continue // a primitive item, keyed by value
        if (/\bselected=\{/.test(tag)) continue
        const offset = select.index + loop.index + loop[0].indexOf(body) + option.index
        lines.push(source.slice(0, offset).split('\n').length)
      }
    }
  }
  return lines
}

describe('selects over fetched objects follow the model', () => {
  it('every option rendered from fetched objects carries selected={...}', () => {
    const offenders = sourceFiles(SRC).flatMap((file) =>
      unmarkedOptions(readFileSync(file, 'utf8')).map(
        (line) => `${file.slice(SRC.length + 1)}:${line}`
      )
    )

    expect(offenders).toEqual([])
  })

  it('the guard can actually detect the old shape', () => {
    // A self-test, so a pattern that silently stops matching cannot make this suite pass by
    // finding nothing anywhere.
    const bad = `<select value={cat()}>
      <For each={categories()}>{(c) => <option value={c.id}>{c.name}</option>}</For>
    </select>`
    const good = `<select value={cat()}>
      <For each={categories()}>
        {(c) => <option value={c.id} selected={c.id === cat()}>{c.name}</option>}
      </For>
    </select>`
    const constant = `<select value={cur()}>
      <For each={CURRENCIES}>{(c) => <option value={c.code}>{c.label}</option>}</For>
    </select>`
    const primitive = `<select value={year()}>
      <For each={years()}>{(y) => <option value={y}>{y}</option>}</For>
    </select>`

    expect(unmarkedOptions(bad)).toEqual([2])
    expect(unmarkedOptions(good)).toEqual([])
    expect(unmarkedOptions(constant)).toEqual([])
    expect(unmarkedOptions(primitive)).toEqual([])
  })
})
