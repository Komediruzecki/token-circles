/**
 * The Loans page's addresses: `#loans` for every loan, `#loans/<id>/<tab>` for one of them.
 *
 * A comparison lives in the query, not in storage (decision R7), so it survives a reload and can
 * be bookmarked: `#loans/12/compare?b=one-payment.10000.12.lower&a=more-each-month.100.shorten`.
 * `b` is the what-if being looked at; `a`, when present, is one pinned with "Use as A" to compare
 * against instead of the loan as planned.
 *
 * A pick is written `<template>.<value>…[.<mode>]`, its values in the order of FIELDS and every
 * one a whole number: the presets always are. The parser is defensive, because a URL is typed,
 * pasted and edited by hand: anything it cannot read is no pick at all rather than a guess.
 */
import { TEMPLATE_IDS, templateTakesMode } from '../../../../shared/loanScenarios'
import type { TemplateId, WhatIfChoice } from '../../../../shared/loanScenarios'

export type LoanTab = 'compare' | 'schedule' | 'extras'

export const LOAN_TABS: readonly LoanTab[] = ['compare', 'schedule', 'extras']

/** What a pick's extra payments do: finish sooner, pay less each month, or both side by side. */
export type ScenarioMode = 'shorten' | 'lower' | 'both'

/** A what-if as the address carries it. */
export interface ScenarioPick {
  choice: WhatIfChoice
  mode: ScenarioMode
}

export type LoansRoute =
  | { view: 'overview' }
  | {
      view: 'loan'
      /** 0 when the address names no loan that could exist. */
      loanId: number
      tab: LoanTab
      b: ScenarioPick | null
      a: ScenarioPick | null
    }

/** Each template's values, in the order the address writes them, with the range each may take. */
const FIELDS: Record<TemplateId, readonly { key: string; min: number; max: number }[]> = {
  'more-each-month': [{ key: 'amount', min: 1, max: 1e12 }],
  'round-up': [{ key: 'target', min: 1, max: 1e12 }],
  'one-payment': [
    { key: 'amount', min: 1, max: 1e12 },
    { key: 'inMonths', min: 1, max: 1200 },
  ],
  'yearly-bonus': [
    { key: 'amount', min: 1, max: 1e12 },
    { key: 'monthOfYear', min: 1, max: 12 },
  ],
  'extra-installment': [{ key: 'monthOfYear', min: 1, max: 12 }],
  'done-by': [{ key: 'yearsEarlier', min: 1, max: 100 }],
  'rate-change': [{ key: 'points', min: -100, max: 100 }],
}

const MODES: readonly ScenarioMode[] = ['shorten', 'lower', 'both']

/** A pick as the address writes it. */
export function formatPick(pick: ScenarioPick): string {
  const { choice } = pick
  const values = FIELDS[choice.template].map((f) =>
    String((choice as unknown as Record<string, number>)[f.key])
  )
  const mode = templateTakesMode(choice.template) ? [pick.mode] : []
  return [choice.template, ...values, ...mode].join('.')
}

/**
 * The pick an address value names, or null when it names none: an unknown template, a missing
 * or extra value, a value that is not a whole number or is out of range, or a rate change of 0
 * points. A template that takes a mode and has none finishes sooner; one that takes no mode
 * ignores one written after its values.
 */
export function parsePick(text: string | null | undefined): ScenarioPick | null {
  if (!text) return null
  const [template, ...rest] = text.split('.')
  if (!(TEMPLATE_IDS as readonly string[]).includes(template)) return null
  const id = template as TemplateId
  const fields = FIELDS[id]
  if (rest.length < fields.length || rest.length > fields.length + 1) return null
  const choice: Record<string, string | number> = { template: id }
  for (let i = 0; i < fields.length; i++) {
    const { key, min, max } = fields[i]
    if (!/^-?\d+$/.test(rest[i])) return null
    const value = Number(rest[i])
    if (value < min || value > max) return null
    choice[key] = value
  }
  if (id === 'rate-change' && choice.points === 0) return null
  const written = rest[fields.length]
  if (written !== undefined && !(MODES as readonly string[]).includes(written)) return null
  const mode: ScenarioMode =
    templateTakesMode(id) && written !== undefined ? (written as ScenarioMode) : 'shorten'
  return { choice: choice as unknown as WhatIfChoice, mode }
}

/** The route a fragment names: null for a fragment that is not the Loans page's. */
export function parseLoansHash(hash: string): LoansRoute | null {
  const raw = hash.replace(/^#/, '')
  const q = raw.indexOf('?')
  const path = q < 0 ? raw : raw.slice(0, q)
  const segments = path.split('/')
  if (segments[0] !== 'loans') return null
  const [id, tab] = segments.slice(1).filter((s) => s !== '')
  if (id === undefined) return { view: 'overview' }
  const params = new URLSearchParams(q < 0 ? '' : raw.slice(q + 1))
  const loanId = /^\d+$/.test(id) && Number.isSafeInteger(Number(id)) ? Number(id) : 0
  const b = parsePick(params.get('b'))
  const a = parsePick(params.get('a'))
  return {
    view: 'loan',
    loanId,
    tab: (LOAN_TABS as readonly string[]).includes(tab) ? (tab as LoanTab) : 'compare',
    b,
    // A pinned pick is one scenario, never both modes at once.
    a: a && a.mode === 'both' ? { ...a, mode: 'shorten' } : a,
  }
}

/**
 * The fragment for a route. `keep` carries query values that belong to the rest of the app, the
 * focus period that every page's address holds, so writing a route does not drop them.
 */
export function loansHash(route: LoansRoute, keep?: URLSearchParams): string {
  if (route.view === 'overview') {
    const rest = withoutPicks(keep)
    return rest ? `#loans?${rest}` : '#loans'
  }
  const params = new URLSearchParams()
  if (route.b) params.set('b', formatPick(route.b))
  if (route.a) params.set('a', formatPick(route.a))
  const rest = withoutPicks(keep)
  const query = [params.toString(), rest].filter(Boolean).join('&')
  return `#loans/${route.loanId}/${route.tab}${query ? `?${query}` : ''}`
}

function withoutPicks(keep: URLSearchParams | undefined): string {
  if (!keep) return ''
  const rest = new URLSearchParams(keep)
  rest.delete('a')
  rest.delete('b')
  return rest.toString()
}

/** The query of the current fragment, for `loansHash`'s `keep`. */
export function currentQuery(hash: string = window.location.hash): URLSearchParams {
  const q = hash.indexOf('?')
  return new URLSearchParams(q < 0 ? '' : hash.slice(q + 1))
}
