/**
 * The app's links to the articles on about.tokencircles.com (shared/articles.ts): one list holds
 * their addresses, and each surface that raises an article's question names it by id. Every id a
 * surface gives resolves in that list, and only the three surfaces' questions carry one.
 */
import { describe, expect, it } from 'vitest'
import { ABOUT_SITE, ARTICLES, articleUrl } from '../../../../shared/articles'
import { placeCircle } from '../../../../shared/guidance/circles'
import { checkRows, circleNumbers } from '../../../../shared/guidance/circleView'
import { nextStepOf } from '../../../../shared/guidance/nextStep'
import { orientationSteps } from '../../../../shared/orientation'
import { MARKETING_SITE, PRIVACY_URL } from '../../components/LegalLinks'
import { facts, words } from './guidanceFixtures'
import type { ArticleId } from '../../../../shared/articles'
import type { CircleNumber } from '../../../../shared/guidance/circles'
import type { GuidanceFacts } from '../../../../shared/guidance/facts'
import type { OrientationFacts } from '../../../../shared/orientation'

const IDS = Object.keys(ARTICLES) as ArticleId[]

/**
 * The site's file names for the three articles (disjoint-colliders packages/tokencircles/src/pages/
 * articles/<name>.md). Its tests pin the same three, so a rename has to land on both sides.
 */
const ON_THE_SITE: Record<ArticleId, string> = {
  'bank-year': 'getting-a-year-out-of-your-bank',
  'one-month': 'why-one-month-lies',
  'first-cushion': 'your-first-cushion',
}

/** Getting started with every rule applying: four months on file, a red September, 15 days put by. */
const EVERY_RULE: OrientationFacts = {
  today: '2026-10-15',
  trackedMonthsInYear: 4,
  subscriptionsSpotted: 2,
  billsSpotted: 0,
  entries: 200,
  uncategorised: 60,
  topUnbudgeted: { categoryId: 7, name: 'Groceries' },
  heavyMonth: '2026-09',
  loans: 1,
  cushionMonths: 0.5,
  cushionAgainst: 'needs',
}

const known = (id: ArticleId | undefined | null) =>
  id === undefined || id === null || IDS.includes(id)

describe('the list of articles', () => {
  it('holds the three, each at /articles/<name>/ on the site the legal pages are on', () => {
    expect(IDS).toEqual(['bank-year', 'one-month', 'first-cushion'])
    for (const id of IDS) {
      expect(ARTICLES[id].path).toBe(`/articles/${ON_THE_SITE[id]}/`)
      expect(articleUrl(id)).toBe(`https://about.tokencircles.com/articles/${ON_THE_SITE[id]}/`)
      expect(ARTICLES[id].title.trim()).not.toBe('')
    }
    expect(new Set(IDS.map((id) => ARTICLES[id].path)).size).toBe(IDS.length)
  })

  it('shares its site with the legal links', () => {
    expect(MARKETING_SITE).toBe(ABOUT_SITE)
    expect(PRIVACY_URL.startsWith(`${ABOUT_SITE}/`)).toBe(true)
  })
})

describe('Getting started', () => {
  it('links the import, heavy-month and cushion steps to their articles, and no other step', () => {
    const steps = orientationSteps(EVERY_RULE)
    expect(Object.fromEntries(steps.map((step) => [step.id, step.article]))).toEqual({
      'import-year': 'bank-year',
      'review-subscriptions': undefined,
      'sort-uncategorised': undefined,
      'budget-top-category': undefined,
      'heavy-month': 'one-month',
      cushion: 'first-cushion',
      'loan-payoff': undefined,
    })
    for (const step of steps) expect(known(step.article)).toBe(true)
  })
})

describe('Your next step', () => {
  const step = (f: GuidanceFacts, orientation: OrientationFacts | null = null) =>
    nextStepOf({
      placement: placeCircle(f),
      facts: f,
      orientation: orientation ? orientationSteps(orientation) : null,
      words,
    })

  it("carries Getting started's article while it takes Getting started's step", () => {
    expect(step(facts({ monthsInYear: 4, firm: false }), EVERY_RULE).article).toBe('bank-year')
  })

  it('links a year on file and the first cushion to their articles', () => {
    expect(step(facts({ monthsInYear: 7, firm: false })).id).toBe('year-on-file')
    expect(step(facts({ monthsInYear: 7, firm: false })).article).toBe('bank-year')
    const short = facts({ liquid: 1000, essentials: 2000, cushionMonths: 0.5 })
    expect(step(short).id).toBe('first-cushion')
    expect(step(short).article).toBe('first-cushion')
  })

  it('links nothing for a step no article answers', () => {
    const solid = facts({ liquid: 4000, essentials: 2000, cushionMonths: 2 })
    expect(step(solid).id).toBe('solid-cushion')
    expect(step(solid).article).toBeUndefined()
  })
})

describe("a circle's view", () => {
  const place = (f: GuidanceFacts, circle: CircleNumber) =>
    placeCircle(f, { freeMoney: true }).circles[circle - 1]

  it('links the months on file to why one month is not enough, and no other number', () => {
    for (const circle of [1, 2, 3, 4, 5, 6, 7] as CircleNumber[]) {
      const rows = circleNumbers(circle, facts(), words, { holdings: null, kindsAsked: false }).rows
      const linked = rows.filter((row) => row.article !== undefined)
      expect(linked.map((row) => [row.label, row.article])).toEqual(
        circle === 1 ? [['Months on file', 'one-month']] : []
      )
    }
  })

  it('links a month of essentials to the first cushion, unless the step on the same view is about it', () => {
    const short = facts({ liquid: 1000, essentials: 2000, cushionMonths: 0.5 })
    const row = (step: 'first-cushion' | null) =>
      checkRows(place(short, 3), short, words, 3, step).find((one) => one.id === 'first-cushion')
    expect(row(null)?.article).toBe('first-cushion')
    expect(row('first-cushion')?.article).toBeUndefined()
  })

  it('links no other check', () => {
    for (const circle of [1, 2, 3, 4, 5, 6, 7] as CircleNumber[]) {
      const rows = checkRows(place(facts(), circle), facts(), words, null)
      const linked = rows.filter((row) => row.article !== undefined).map((row) => row.id)
      expect(linked).toEqual(circle === 3 ? ['first-cushion'] : [])
    }
  })
})
