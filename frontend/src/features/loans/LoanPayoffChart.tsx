/**
 * A loan's balance over its whole life, from the amount borrowed to the last payment, with today
 * marked on it. It is drawn the way the seven circles are (design.md, the circles): the stretch
 * already paid is solid, in the blue of a ring that is reached; the stretch still to come is
 * dotted, like a ring not reached yet; and today is the warm dot the circles give the one being
 * worked on. Extra payments sit on the line where they bring the balance down, and the year axis
 * gives every year its own span, with this year lit.
 *
 * Drawn at the width it is given, so its text stays 12 px on a phone. Its figures are read out in
 * words beside it (LoanChartPanel), so the drawing is one labelled image for a screen reader.
 */
import { createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import { niceStep } from './LoanBalanceChart'
import { monthShort } from './loanCopy'
import styles from './Loans.module.css'
import type { Formats } from './loanCopy'
import type { LoanTimeline } from './loanTimeline'

interface Props {
  timeline: LoanTimeline
  /** A balance on the axis: whole units, compact. */
  axisMoney: (amount: number) => string
  formats: Formats
  /** YYYY-MM-DD: which year is this one. */
  today: string
  /** Makes the ids inside unique: the gradients and the title. */
  id: string
  /** What the chart shows, for a screen reader. */
  description: string
}

/** Above the plot: room for the Today pill. */
const PAD_TOP = 34
const PAD_RIGHT = 16
/** Under the plot: the row of years. */
const AXIS = 30
const PILL_H = 22
/** 12 px text: a generous average advance, so a label is never placed tighter than it is. */
const CHAR = 7.2
/** Each extra payment gets a label while they are this few. */
const MAX_EXTRA_LABELS = 6
/** The glow around today's dot. */
const HALO = 11

const f1 = (n: number) => n.toFixed(1)

interface Box {
  x0: number
  x1: number
}

const overlaps = (a: Box, b: Box, gap = 8) => a.x0 < b.x1 + gap && a.x1 > b.x0 - gap

export default function LoanPayoffChart(props: Props) {
  const [width, setWidth] = createSignal(0)
  let wrap!: HTMLDivElement

  onMount(() => {
    // Measured before the first paint, so the chart never shows at a made-up width.
    setWidth(Math.round(wrap.clientWidth))
    if (typeof ResizeObserver === 'undefined') return
    let frame = 0
    const observer = new ResizeObserver(([entry]) => {
      const w = Math.round(entry.contentRect.width)
      cancelAnimationFrame(frame)
      // A frame later: a new width gives the chart a new height, and a size changed inside this
      // callback is a resize loop the browser reports as an error.
      if (w > 0) frame = requestAnimationFrame(() => setWidth(w))
    })
    observer.observe(wrap)
    onCleanup(() => {
      observer.disconnect()
      cancelAnimationFrame(frame)
    })
  })

  const t = () => props.timeline
  const w = () => width() || 640
  const n = () => Math.max(1, t().rows.length)
  const balanceAt = (month: number) => (month <= 0 ? t().principal : t().rows[month - 1].balance)

  const yMax = createMemo(() => {
    let top = t().principal
    for (const row of t().rows) if (row.balance > top) top = row.balance
    return top > 0 ? top : 1
  })
  const step = createMemo(() => niceStep(yMax() / 4))
  const yTop = createMemo(() => Math.ceil(yMax() / step()) * step())
  const yTicks = createMemo(() => {
    const ticks: number[] = []
    for (let v = 0; v <= yTop() + step() / 2; v += step()) ticks.push(v)
    return ticks
  })
  const padLeft = createMemo(() =>
    Math.max(40, Math.max(...yTicks().map((v) => props.axisMoney(v).length)) * CHAR + 12)
  )
  const plotW = () => Math.max(1, w() - padLeft() - PAD_RIGHT)
  const plotH = () => Math.round(Math.min(240, Math.max(150, w() * 0.2)))
  const base = () => PAD_TOP + plotH()
  const height = () => base() + AXIS

  const sx = (month: number) => padLeft() + (month / n()) * plotW()
  const sy = (balance: number) => base() - (balance / yTop()) * plotH()

  const points = (from: number, to: number) => {
    const pts: string[] = []
    for (let m = from; m <= to; m++) pts.push(`${f1(sx(m))},${f1(sy(balanceAt(m)))}`)
    return pts
  }
  const made = () => Math.min(t().made, t().rows.length)
  const past = createMemo(() => (made() > 0 ? points(0, made()) : []))
  const future = createMemo(() => (made() < t().rows.length ? points(made(), t().rows.length) : []))
  const area = (pts: string[], from: number, to: number) =>
    `M${f1(sx(from))},${f1(base())}L${pts.join('L')}L${f1(sx(to))},${f1(base())}Z`

  /**
   * Today: where the payments made end. Not on a loan with no dates, nor one paid off, nor one
   * whose first payment falls in a later year: the axis starts in that year, and a Today at its
   * start would stand in next year.
   */
  const showToday = () =>
    t().dated &&
    !t().paidOff &&
    (t().made > 0 || t().rows[0].date.slice(0, 4) <= props.today.slice(0, 4))
  const todayX = () => sx(made())
  const todayY = () => sy(t().owed)
  const pillW = 52
  const pillX = () =>
    Math.min(Math.max(todayX(), padLeft() + pillW / 2), padLeft() + plotW() - pillW / 2)

  /** The payoff month, on the axis under the end of the line. */
  const endLabel = createMemo(() => {
    const last = t().rows[t().rows.length - 1]
    if (!last || t().neverPaysOffFrom !== null) return null
    const text = monthShort(last.date, last.month)
    const x1 = sx(t().rows.length) + 6
    return { text, x: x1, box: { x0: x1 - text.length * CHAR, x1 } }
  })

  /**
   * Each calendar year's span of the axis, the months it pays in, with its name in the middle of
   * it. Short years first and last; this year always named; the rest thinned out to fit.
   */
  const years = createMemo(() => {
    if (!t().dated) return []
    const spans: { year: string; from: number; to: number }[] = []
    t().rows.forEach((row, i) => {
      const year = row.date.slice(0, 4)
      const last = spans[spans.length - 1]
      if (last && last.year === year) last.to = i + 1
      else spans.push({ year, from: i + 1, to: i + 1 })
    })
    const thisYear = props.today.slice(0, 4)
    const perYear = (12 / n()) * plotW()
    const every = perYear >= 44 ? 1 : Math.ceil(44 / perYear)
    const laid = spans.map((s, i) => {
      const x0 = i === 0 ? sx(0) : sx(s.from - 0.5)
      const x1 = i === spans.length - 1 ? sx(n()) : sx(s.to + 0.5)
      const half = (s.year.length * CHAR) / 2
      const mid = Math.min(Math.max((x0 + x1) / 2, padLeft() + half), padLeft() + plotW() - half)
      return {
        year: s.year,
        x0,
        x1,
        mid,
        box: { x0: mid - half, x1: mid + half },
        current: s.year === thisYear,
        odd: i % 2 === 1,
        named: false,
      }
    })
    // Named in order of importance: this year, then every `every`th year counted from it, so the
    // names stand evenly either side of today, as far as they fit.
    const taken: Box[] = endLabel() ? [endLabel()!.box] : []
    const order = [...laid.filter((y) => y.current), ...laid.filter((y) => !y.current)]
    for (const y of order) {
      if (!y.current && Math.abs(Number(y.year) - Number(thisYear)) % every !== 0) continue
      if (y.x1 - y.x0 < 8 && !y.current) continue
      if (taken.some((b) => overlaps(b, y.box))) continue
      y.named = true
      taken.push(y.box)
    }
    return laid
  })
  const bands = () => (12 / n()) * plotW() >= 24

  /**
   * Extra payments: a mark on the line each, and a label for the first few that fit: right of its
   * mark, or left of it where the right runs off the chart or into another label. Neither may
   * cover the Today pill, nor today's dot and the glow around it; a mark inside that glow has its
   * label set out past it.
   */
  const extras = createMemo(() => {
    const placed: Box[] = []
    const today = showToday()
    const pill = today ? { x0: pillX() - pillW / 2, x1: pillX() + pillW / 2 } : null
    const glow = today ? { x: todayX(), y: todayY(), r: HALO } : null
    const labelled = t().extras.length <= MAX_EXTRA_LABELS
    return t().extras.map((e) => {
      const x = sx(e.month)
      const y = sy(balanceAt(e.month))
      const text = `+${props.formats.wholeMoney(e.amount)}`
      const width = text.length * CHAR
      // The label's line: 12 px text standing on y - 7, from 19 px above the mark to 4 px above.
      const top = y - 19
      const bottom = y - 4
      const level = glow !== null && top < glow.y + glow.r && bottom > glow.y - glow.r
      const inGlow = glow !== null && level && Math.abs(x - glow.x) <= glow.r
      const rightFrom = glow !== null && inGlow ? glow.x + glow.r + 3 : x + 7
      const leftTo = glow !== null && inGlow ? glow.x - glow.r - 3 : x - 7
      const sides = [
        { x0: rightFrom, x1: rightFrom + width, at: rightFrom, anchor: 'start' as const },
        { x0: leftTo - width, x1: leftTo, at: leftTo, anchor: 'end' as const },
      ]
      const fits = (box: Box) =>
        box.x0 >= padLeft() &&
        box.x1 <= padLeft() + plotW() &&
        !placed.some((b) => overlaps(b, box)) &&
        !(pill && top < PAD_TOP - 6 && overlaps(pill, box)) &&
        !(glow !== null && level && box.x0 < glow.x + glow.r && box.x1 > glow.x - glow.r)
      const side = labelled ? sides.find(fits) : undefined
      if (side) placed.push(side)
      return { ...e, x, y, text, label: side ?? null }
    })
  })

  const extraTitle = (e: { amount: number; month: number; date: string; made: boolean }) =>
    `${e.made ? 'Extra payment' : 'Planned extra payment'} of ${props.formats.money(e.amount)} with payment ${e.month}, ${monthShort(e.date, e.month)}`

  return (
    <div ref={wrap} class={styles.payoffWrap}>
      <svg
        class={styles.payoffChart}
        width={w()}
        height={height()}
        viewBox={`0 0 ${w()} ${height()}`}
        role="img"
        aria-labelledby={`${props.id}-title`}
        aria-describedby={`${props.id}-desc`}
        data-test-id="loans-payoff-chart"
      >
        <title id={`${props.id}-title`}>What is owed, from the first payment to the last</title>
        <desc id={`${props.id}-desc`}>{props.description}</desc>
        <defs>
          <linearGradient id={`${props.id}-fill`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="var(--primary)" stop-opacity="0.3" />
            <stop offset="1" stop-color="var(--primary)" stop-opacity="0.03" />
          </linearGradient>
          <linearGradient
            id={`${props.id}-line`}
            gradientUnits="userSpaceOnUse"
            x1={padLeft()}
            y1="0"
            x2={Math.max(padLeft() + 1, todayX())}
            y2="0"
          >
            <stop offset="0" stop-color="var(--ring-a)" />
            <stop offset="1" stop-color="var(--ring-b)" />
          </linearGradient>
        </defs>

        {/* The years: a faint band every other year, this year in the accent. */}
        <For each={years()}>
          {(y) => (
            <Show when={y.current || (bands() && y.odd)}>
              <rect
                class={y.current ? styles.payoffBandNow : styles.payoffBand}
                x={f1(y.x0)}
                y={PAD_TOP}
                width={f1(Math.max(0, y.x1 - y.x0))}
                height={plotH()}
                data-test-id={y.current ? 'loans-payoff-this-year' : undefined}
              />
            </Show>
          )}
        </For>

        <For each={yTicks()}>
          {(v) => (
            <g>
              <line
                class={v === 0 ? styles.payoffBase : styles.payoffGrid}
                x1={padLeft()}
                x2={padLeft() + plotW()}
                y1={f1(sy(v))}
                y2={f1(sy(v))}
              />
              <text
                class={styles.payoffAxisLabel}
                x={padLeft() - 10}
                y={f1(sy(v) + 4)}
                text-anchor="end"
              >
                {props.axisMoney(v)}
              </text>
            </g>
          )}
        </For>

        <For each={years()}>
          {(y, i) => (
            <>
              <Show when={i() > 0}>
                <line
                  class={styles.payoffBase}
                  x1={f1(y.x0)}
                  x2={f1(y.x0)}
                  y1={f1(base())}
                  y2={f1(base() + 5)}
                />
              </Show>
              <Show when={y.named}>
                <text
                  class={styles.payoffYear}
                  x={f1(y.mid)}
                  y={f1(base() + 20)}
                  text-anchor="middle"
                  data-current={y.current ? '' : undefined}
                  data-test-id="loans-payoff-year"
                >
                  {y.year}
                </text>
              </Show>
            </>
          )}
        </For>

        <g class={styles.payoffData}>
          <Show when={past().length > 0}>
            <path
              d={area(past(), 0, made())}
              fill={`url(#${props.id}-fill)`}
              data-test-id="loans-payoff-past-area"
            />
          </Show>
          <Show when={future().length > 0}>
            <path class={styles.payoffFutureArea} d={area(future(), made(), t().rows.length)} />
            <polyline
              class={styles.payoffFutureLine}
              points={future().join(' ')}
              data-test-id="loans-payoff-future"
            />
          </Show>
          <Show when={past().length > 0}>
            <polyline
              class={styles.payoffPastLine}
              points={past().join(' ')}
              stroke={`url(#${props.id}-line)`}
              data-test-id="loans-payoff-past"
            />
          </Show>

          <For each={extras()}>
            {(e) => (
              <g data-test-id="loans-payoff-extra" data-made={e.made ? 'true' : 'false'}>
                <title>{extraTitle(e)}</title>
                <circle class={styles.payoffExtra} cx={f1(e.x)} cy={f1(e.y)} r="4.5" />
                <Show when={e.label}>
                  {(label) => (
                    <text
                      class={`${styles.payoffExtraLabel} ${styles.chartLabelHalo}`}
                      x={f1(label().at)}
                      y={f1(e.y - 7)}
                      text-anchor={label().anchor}
                    >
                      {e.text}
                    </text>
                  )}
                </Show>
              </g>
            )}
          </For>

          <Show when={endLabel()}>
            {(end) => (
              <g
                class={styles.payoffEnd}
                data-test-id="loans-payoff-end"
                data-paid={t().paidOff ? '' : undefined}
              >
                <circle cx={f1(sx(t().rows.length))} cy={f1(base())} r="6" />
                <text
                  class={styles.payoffEndLabel}
                  x={f1(end().x)}
                  y={f1(base() + 20)}
                  text-anchor="end"
                >
                  {end().text}
                </text>
              </g>
            )}
          </Show>
          <Show when={t().neverPaysOffFrom !== null && t().rows.length > 0}>
            <text
              class={`${styles.payoffEndLabel} ${styles.chartLabelHalo}`}
              x={f1(sx(t().rows.length))}
              y={f1(sy(balanceAt(t().rows.length)) - 12)}
              text-anchor="end"
              data-test-id="loans-payoff-never"
            >
              Never repaid at this rate
            </text>
          </Show>
        </g>

        <Show when={showToday()}>
          <g class={styles.payoffToday} data-test-id="loans-payoff-today">
            <line
              class={styles.payoffTodayLine}
              x1={f1(todayX())}
              x2={f1(todayX())}
              y1={PAD_TOP - 6}
              y2={f1(base())}
            />
            <rect
              class={styles.payoffPill}
              x={f1(pillX() - pillW / 2)}
              y={PAD_TOP - 6 - PILL_H}
              width={pillW}
              height={PILL_H}
              rx={PILL_H / 2}
            />
            <text
              class={styles.payoffPillText}
              x={f1(pillX())}
              y={PAD_TOP - 6 - PILL_H / 2 + 4}
              text-anchor="middle"
            >
              Today
            </text>
            <circle class={styles.payoffTodayHalo} cx={f1(todayX())} cy={f1(todayY())} r={HALO} />
            <circle class={styles.payoffTodayDot} cx={f1(todayX())} cy={f1(todayY())} r="5.5" />
          </g>
        </Show>
      </svg>
    </div>
  )
}
