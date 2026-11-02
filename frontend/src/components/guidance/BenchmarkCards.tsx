/**
 * The benchmark cards under How you compare (design.md 2.2, shared/guidance/cards.ts): the metric,
 * its tags, a title with the person's number, a sentence or two, the band bar, one next step, and
 * "Where this comes from". The words come from cards.ts; this draws them. A card that asks a
 * question (the housing card's "How do you live?") gets it from the view, which saves the answer.
 */
import { For, Index, Show } from 'solid-js'
import styles from './BenchmarkCards.module.css'
import { ArrowIcon } from './NextStepCard'
import type { JSX } from 'solid-js'
import type { BenchmarkCard, CardBar, CardQuestion } from '../../../../shared/guidance/cards'

/** Low, typical and high on one scale, the person's mark on it, and the edges labelled. */
function BandBar(props: { bar: CardBar }): JSX.Element {
  const span = () => props.bar.to - props.bar.from
  const at = (value: number) => `${(((value - props.bar.from) / span()) * 100).toFixed(2)}%`
  return (
    <div class={styles.bar} role="img" aria-label={props.bar.label} data-test-id="benchmark-bar">
      <div class={styles.track} aria-hidden="true">
        <For each={props.bar.bands}>
          {(band) => (
            <i
              data-band={band.band}
              style={{
                left: at(band.from),
                width: `${(((band.to - band.from) / span()) * 100).toFixed(2)}%`,
              }}
            />
          )}
        </For>
        <b class={styles.mark} style={{ left: at(props.bar.mark) }} />
      </div>
      <div class={styles.edges} aria-hidden="true">
        <For each={props.bar.edges}>
          {(edge) => <span style={{ left: at(edge.at) }}>{edge.text}</span>}
        </For>
      </div>
    </div>
  )
}

/** Draws the question a card asks. */
export type CardQuestionSlot = (ask: CardQuestion) => JSX.Element

function Card(props: { card: BenchmarkCard; question?: CardQuestionSlot }): JSX.Element {
  return (
    <article
      class={styles.card}
      data-test-id="benchmark-card"
      data-card={props.card.id}
      aria-label={`${props.card.eyebrow}: ${props.card.title}`}
    >
      <div class={styles.head}>
        <p class={styles.eyebrow}>{props.card.eyebrow}</p>
        <Show when={props.card.tags.length > 0}>
          <ul class={styles.tags}>
            <For each={props.card.tags}>
              {(tag) => (
                <li class={styles.tag} data-kind={tag.kind}>
                  {tag.text}
                </li>
              )}
            </For>
          </ul>
        </Show>
      </div>
      <h4 class={styles.title} data-test-id="benchmark-title">
        {props.card.title}
      </h4>
      <For each={props.card.body}>
        {(paragraph) => (
          <p class={styles.body} data-test-id="benchmark-body">
            {paragraph}
          </p>
        )}
      </For>
      {/* Keyed: a place in the list that holds another card asks that card's question. */}
      <Show when={props.question && props.card.ask} keyed>
        {(ask) => props.question?.(ask)}
      </Show>
      <Show when={props.card.bar}>{(bar) => <BandBar bar={bar()} />}</Show>
      <Show when={props.card.note}>
        <p class={styles.note} data-test-id="benchmark-note">
          {props.card.note}
        </p>
      </Show>
      <Show when={props.card.provisional}>
        <p class={styles.note}>{props.card.provisional}</p>
      </Show>
      <Show when={props.card.step}>
        {(step) => (
          <a class={styles.step} href={step().hash} data-test-id="benchmark-step">
            {step().label}
            <ArrowIcon />
          </a>
        )}
      </Show>
      <Show when={props.card.where}>
        {(where) => (
          <details class={styles.where} data-test-id="benchmark-where">
            <summary>Where this comes from</summary>
            <p>{where().rule}</p>
            <ul class={styles.sources}>
              <For each={where().sources}>
                {(source) => (
                  <li>
                    <a href={source.url} target="_blank" rel="noopener noreferrer">
                      {source.title}
                    </a>
                    , {source.publisher}, {source.year}
                  </li>
                )}
              </For>
            </ul>
            <p>{where().strength}</p>
          </details>
        )}
      </Show>
    </article>
  )
}

export default function BenchmarkCards(props: {
  cards: readonly BenchmarkCard[]
  question?: CardQuestionSlot
}): JSX.Element {
  return (
    <div class={styles.cards} data-test-id="benchmark-cards">
      {/* Keyed by place: a card's "Where this comes from" stays open when its numbers change. */}
      <Index each={props.cards}>{(card) => <Card card={card()} question={props.question} />}</Index>
    </div>
  )
}
