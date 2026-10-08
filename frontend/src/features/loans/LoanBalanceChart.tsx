/**
 * What is still owed, month by month, for the two sides of a comparison: one chart, two lines,
 * each payoff marked and labelled on the line itself (plan 01: A in the accent, B in strong
 * neutral ink, direct labels instead of a legend). Drawn at the width it is given, so its text
 * stays 12 px on a phone.
 */
import { createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import { monthShort } from './loanCopy'
import styles from './Loans.module.css'
import type { ScheduleRow } from '../../../../shared/loanSchedule'

export interface ChartSeries {
  key: 'a' | 'b'
  /** Shown beside the payoff point: "A" or "B", or a mode's name. */
  label: string
  rows: ScheduleRow[]
  payoffMonth: number | null
}

interface Props {
  series: ChartSeries[]
  /** The month the comparison starts from; the line starts the month before, at `startBalance`. */
  from: number
  startBalance: number
  /** Formats a balance for the axis: whole units, compact. */
  axisMoney: (amount: number) => string
  /** A sentence for screen readers saying what the chart shows. */
  description: string
}

/** The plot, with room above for a line that is never repaid to be labelled where it stops. */
const PLOT_HEIGHT = 184
const PAD = { top: 28, right: 16, left: 64 }
/** Below the zero line: a row for each row of payoff labels, then the year labels. */
const LABEL_ROW = 18
const AXIS_ROW = 28

/** 1, 2, 2.5 or 5 times a power of ten: the smallest such step at least `raw`. */
function niceStep(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 1
  const power = 10 ** Math.floor(Math.log10(raw))
  for (const s of [1, 2, 2.5, 5, 10]) if (s * power >= raw) return s * power
  return 10 * power
}

let chartIds = 0

export default function LoanBalanceChart(props: Props) {
  const id = `loan-chart-${++chartIds}`
  const [width, setWidth] = createSignal(640)
  let wrap!: HTMLDivElement

  onMount(() => {
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      const w = Math.round(entry.contentRect.width)
      if (w > 0) setWidth(w)
    })
    observer.observe(wrap)
    onCleanup(() => {
      observer.disconnect()
    })
  })

  const x0 = () => props.from - 1
  const x1 = createMemo(() => {
    let last = props.from
    for (const s of props.series) {
      const end = s.payoffMonth ?? s.rows[s.rows.length - 1]?.month ?? props.from
      last = Math.max(last, end)
    }
    return last
  })
  const yMax = createMemo(() => {
    let top = props.startBalance
    for (const s of props.series) {
      for (const r of s.rows) if (r.month >= props.from && r.balance > top) top = r.balance
    }
    return top > 0 ? top : 1
  })
  const step = createMemo(() => niceStep(yMax() / 4))
  const yTop = createMemo(() => Math.ceil(yMax() / step()) * step())

  const plotW = () => Math.max(1, width() - PAD.left - PAD.right)
  const plotH = PLOT_HEIGHT
  const sx = (month: number) => PAD.left + ((month - x0()) / Math.max(1, x1() - x0())) * plotW()
  const sy = (balance: number) => PAD.top + plotH - (balance / yTop()) * plotH

  const points = (s: ChartSeries) => {
    const pts = [`${sx(x0()).toFixed(1)},${sy(props.startBalance).toFixed(1)}`]
    for (const r of s.rows) {
      if (r.month < props.from) continue
      pts.push(`${sx(r.month).toFixed(1)},${sy(r.balance).toFixed(1)}`)
    }
    return pts.join(' ')
  }

  const yTicks = createMemo(() => {
    const ticks: number[] = []
    for (let v = 0; v <= yTop() + step() / 2; v += step()) ticks.push(v)
    return ticks
  })

  /** Ticks at the start of each year (or every 12 months without dates), at most six. */
  const xTicks = createMemo(() => {
    // The longest line carries every month's date.
    const ref = props.series.reduce<ScheduleRow[]>(
      (longest, s) => (s.rows.length > longest.length ? s.rows : longest),
      []
    )
    const span = x1() - x0()
    const years = Math.max(1, Math.ceil(span / 12 / 6))
    const ticks: { month: number; label: string }[] = []
    const dated = ref.some((r) => r.date)
    for (let m = props.from; m <= x1(); m++) {
      const row = ref[m - 1]
      if (dated && row?.date) {
        const [y, mo] = [Number(row.date.slice(0, 4)), Number(row.date.slice(5, 7))]
        if (mo === 1 && y % years === 0) ticks.push({ month: m, label: String(y) })
      } else if (!dated && m % (12 * years) === 0) {
        ticks.push({ month: m, label: `Month ${m}` })
      }
    }
    return ticks
  })

  /**
   * Where each payoff label goes. A repaid line ends on the zero line, so its label goes just
   * below it, under its own point, where no line can ever be: the payoff points stay readable
   * however steeply the lines come down. The later payoff takes the first row; an earlier one
   * that would run into it takes a second. A line never repaid is labelled above where it stops,
   * on the card's colour so the other line cannot run through the words.
   */
  const labels = createMemo(() => {
    const ends = props.series
      .map((s) => {
        const last = s.rows[s.rows.length - 1]
        const month = s.payoffMonth ?? last?.month ?? props.from
        const repaid = s.payoffMonth !== null
        return {
          key: s.key,
          x: sx(month),
          y: repaid ? sy(0) : sy(last?.balance ?? 0),
          text: repaid
            ? `${s.label}: ${monthShort(last?.date, month)}`
            : `${s.label}: never repaid`,
          repaid,
        }
      })
      .sort((a, b) => b.x - a.x)
    // 12 px text: a generous average advance, so a label is never placed tighter than it is.
    const widthOf = (text: string) => text.length * 7
    const spans: [number, number][] = []
    return ends.map((e) => {
      const w = widthOf(e.text)
      if (!e.repaid) {
        return { ...e, w, row: -1, anchor: 'end' as const, lx: e.x - 8, ly: e.y - 10 }
      }
      // Ending under the point, unless that runs into the axis labels on the left.
      const endsAtPoint = e.x + 5 - w >= PAD.left
      const span: [number, number] = endsAtPoint ? [e.x + 5 - w, e.x + 5] : [e.x - 5, e.x - 5 + w]
      const row = spans.some(([lo, hi]) => span[0] < hi + 8 && span[1] > lo - 8) ? 1 : 0
      if (row === 0) spans.push(span)
      return {
        ...e,
        w,
        row,
        anchor: endsAtPoint ? ('end' as const) : ('start' as const),
        lx: endsAtPoint ? e.x + 5 : e.x - 5,
        ly: sy(0) + 16 + row * LABEL_ROW,
      }
    })
  })

  const labelRows = () => (labels().some((l) => l.row === 1) ? 2 : 1)
  const height = () => PAD.top + plotH + labelRows() * LABEL_ROW + AXIS_ROW

  return (
    <div ref={wrap} style={{ width: '100%' }}>
      <svg
        class={styles.chart}
        width={width()}
        height={height()}
        viewBox={`0 0 ${width()} ${height()}`}
        role="img"
        aria-labelledby={`${id}-title ${id}-desc`}
        data-test-id="loans-compare-chart"
      >
        <title id={`${id}-title`}>Balance owed over time</title>
        <desc id={`${id}-desc`}>{props.description}</desc>
        <For each={yTicks()}>
          {(v) => (
            <g>
              <line
                class={styles.chartGrid}
                x1={PAD.left}
                x2={PAD.left + plotW()}
                y1={sy(v)}
                y2={sy(v)}
              />
              <text class={styles.chartAxisLabel} x={PAD.left - 8} y={sy(v) + 4} text-anchor="end">
                {props.axisMoney(v)}
              </text>
            </g>
          )}
        </For>
        <For each={xTicks()}>
          {(t) => (
            <text
              class={styles.chartAxisLabel}
              x={sx(t.month)}
              y={height() - 8}
              text-anchor="middle"
            >
              {t.label}
            </text>
          )}
        </For>
        <For each={props.series}>
          {(s) => (
            <polyline
              class={s.key === 'a' ? styles.chartLineA : styles.chartLineB}
              points={points(s)}
              stroke-linejoin="round"
              stroke-dasharray={s.key === 'b' ? '6 4' : undefined}
              data-test-id={`loans-chart-line-${s.key}`}
            />
          )}
        </For>
        <For each={labels()}>
          {(l) => (
            <g data-test-id={`loans-chart-end-${l.key}`}>
              {/* The card's own colour behind the text: a label moved up a row may sit over a
                  line, and stays readable there. */}
              <rect
                class={styles.chartLabelBack}
                x={l.anchor === 'end' ? l.lx - l.w - 3 : l.lx - 3}
                y={l.ly - 12}
                width={l.w + 6}
                height={16}
                rx={4}
              />
              <Show when={l.repaid}>
                <circle
                  class={l.key === 'a' ? styles.chartPointA : styles.chartPointB}
                  cx={l.x}
                  cy={l.y}
                  r={5}
                />
              </Show>
              <text
                class={`${styles.chartLabel} ${styles.chartLabelHalo}`}
                x={l.lx}
                y={l.ly}
                text-anchor={l.anchor}
              >
                {l.text}
              </text>
            </g>
          )}
        </For>
      </svg>
    </div>
  )
}
