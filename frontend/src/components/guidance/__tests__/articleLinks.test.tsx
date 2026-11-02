/**
 * The "why" links to the articles on about.tokencircles.com, where each surface draws them: under a
 * Getting started step, under Your next step, and on a Worth a look card. Each opens the article
 * from the one list (shared/articles.ts) in a new tab, and a surface with no article shows none.
 */
import { render } from 'solid-js/web'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ARTICLES, articleUrl } from '../../../../../shared/articles'
import AdviceList from '../../../features/ProgressAdvice'
import { NextSteps } from '../../GettingStarted'
import ArticleLink from '../ArticleLink'
import NextStepCard from '../NextStepCard'
import type { JSX } from 'solid-js'
import type { ArticleId } from '../../../../../shared/articles'
import type { NextStep } from '../../../../../shared/guidance/nextStep'
import type { OrientationStep } from '../../../../../shared/orientation'
import type { AdviceCard } from '../../../core/achievements/advice'
import type { GuidanceView } from '../../../core/guidance'

let host: HTMLDivElement
let dispose: (() => void) | undefined
afterEach(() => {
  dispose?.()
  host?.remove()
})

const mount = (el: () => JSX.Element): HTMLDivElement => {
  host = document.createElement('div')
  document.body.appendChild(host)
  dispose = render(el, host)
  return host
}

/** Every article link inside `c`, as what it opens and what it says. */
const links = (c: ParentNode) =>
  [...c.querySelectorAll<HTMLAnchorElement>('[data-test-id="article-link"]')].map((a) => ({
    article: a.dataset.article,
    href: a.getAttribute('href'),
    target: a.getAttribute('target'),
    rel: a.getAttribute('rel'),
  }))

const opens = (article: ArticleId) => ({
  article,
  href: articleUrl(article),
  target: '_blank',
  rel: 'noopener noreferrer',
})

describe('an article link', () => {
  it('opens the article in a new tab, named by its title, and says so to a screen reader', () => {
    const c = mount(() => <ArticleLink article="one-month" />)
    const a = c.querySelector<HTMLAnchorElement>('a')!
    expect(links(c)).toEqual([opens('one-month')])
    expect(a.textContent).toBe(`${ARTICLES['one-month'].title} (article, opens in a new tab)`)
    expect(a.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true')
  })
})

describe('Getting started', () => {
  const step = (over: Partial<OrientationStep>): OrientationStep => ({
    id: 'sort-uncategorised',
    title: 'Sort the 3 entries without a category',
    reason: "That's 30% of your entries.",
    link: { hash: '#transactions?uncategorised=1', label: 'Transactions' },
    ...over,
  })

  it('puts the article under the reason of a step that has one, and none under one that does not', () => {
    const c = mount(() => (
      <NextSteps
        steps={[
          step({ id: 'import-year', title: 'Import the rest of your year', article: 'bank-year' }),
          step({}),
          step({
            id: 'heavy-month',
            title: 'See what put September in the red',
            article: 'one-month',
          }),
        ]}
      />
    ))
    const rows = [...c.querySelectorAll<HTMLElement>('[data-test-id="next-step"]')]
    expect(rows.map((row) => links(row))).toEqual([[opens('bank-year')], [], [opens('one-month')]])
    // Under the reason, not inside the step's own link or its reason.
    const first = rows[0]
    expect(
      first.querySelector('[data-test-id="next-step-link"] [data-test-id="article-link"]')
    ).toBeNull()
    expect(first.querySelector('[data-test-id="next-step-reason"]')!.textContent).toBe(
      "That's 30% of your entries."
    )
    expect(
      first.querySelector('[data-test-id="next-step-reason"] + [data-test-id="article-link"]')
    ).not.toBeNull()
  })
})

describe('Your next step', () => {
  // The card reads its circle's row and the region from the view; a step with no circle needs neither.
  const view = {
    rows: [],
    region: { region: 'EU27' },
    inputs: { currency: 'EUR' },
    profileId: 1,
  } as unknown as GuidanceView
  const nextStep = (over: Partial<NextStep>): NextStep => ({
    id: 'first-cushion',
    circle: null,
    title: 'Build a one-month cushion',
    why: 'The money you can reach covers 15 days of what you need.',
    whyHere: '€1,000 to go.',
    action: { kind: 'open', hash: '#goals', label: 'Open Goals' },
    meter: null,
    then: null,
    fine: null,
    ...over,
  })

  it('links the article under the why, on the card and inside its circle', () => {
    for (const inCircle of [false, true]) {
      const c = mount(() => (
        <NextStepCard
          step={nextStep({ article: 'first-cushion' })}
          view={view}
          inCircle={inCircle}
        />
      ))
      expect(links(c)).toEqual([opens('first-cushion')])
      expect(
        c.querySelector('[data-test-id="next-step-why"] + [data-test-id="article-link"]')
      ).not.toBeNull()
      dispose?.()
      host.remove()
      dispose = undefined
    }
  })

  it('shows no article link for a step without one', () => {
    const c = mount(() => (
      <NextStepCard
        step={nextStep({ id: 'solid-cushion', title: 'Grow your cushion to three months' })}
        view={view}
      />
    ))
    expect(links(c)).toEqual([])
  })
})

describe('Worth a look', () => {
  const card = (over: Partial<AdviceCard>): AdviceCard => ({
    id: 'budget-drift:1',
    kind: 'budget-drift',
    circle: 2,
    tone: 'warn',
    title: 'Groceries is running ahead',
    detail: 'At this pace it ends the month over.',
    figure: '€40 over',
    weight: 1,
    ...over,
  })

  it('links a card that has an article, after the circle it counts toward', () => {
    const c = mount(() => (
      <AdviceList
        cards={[
          card({
            id: 'in-the-red:2026-09',
            kind: 'in-the-red',
            title: 'September 2026 spent more than it earned',
            article: 'one-month',
          }),
          card({}),
        ]}
        onOpen={vi.fn()}
        onDismiss={vi.fn()}
      />
    ))
    const cards = [...c.querySelectorAll<HTMLElement>('[data-advice-card]')]
    expect(cards.map((one) => links(one))).toEqual([[opens('one-month')], []])
    expect(
      cards[0].querySelector('[data-test-id="advice-why"] + [data-test-id="article-link"]')
    ).not.toBeNull()
  })
})
