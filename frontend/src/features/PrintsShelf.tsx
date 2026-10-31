/**
 * Prints, on Progress (first week, phase 4): every twelve tracked months in a row make a print,
 * the year drawn as a seal (shared/prints/seal.ts). The section shows in every state: an empty
 * plate before any month is tracked, the plate filling in month by month, then the newest print
 * on paper with the next plate beside it and every print below.
 *
 * Everything here is worked out from the badges' snapshot each time (core/prints/shelf.ts); the
 * view it reads carries seal shares only, so no amount reaches the page.
 */
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from 'solid-js'
import { sealSummary } from '../../../shared/prints/describe'
import { drawSeal, PAPER, SEAL_SLOTS, THEME } from '../../../shared/prints/seal'
import { snapshot } from '../core/achievementsStore'
import {
  EMPTY_LINE,
  EVERY_HEADING,
  FIRST_EYEBROW,
  gapLine,
  holdsMonth,
  LEGEND,
  NEXT_HEADING,
  nextStart,
  periodOf,
  plateLine,
  plateTitle,
  printEyebrow,
  printWords,
  runningLine,
  SHAPE_LINE,
  thumbLabel,
} from '../core/prints/copy'
import { shelfView } from '../core/prints/shelf'
import { whenSettledInView } from '../core/settledInView'
import styles from './PrintsShelf.module.css'
import type { JSX } from 'solid-js'
import type { PrintView, ShelfView } from '../core/prints/shelf'

/** No month on it: the frame and the twelve hour marks. */
const EMPTY: PrintView = { from: '', months: 0, slots: Array(SEAL_SLOTS).fill(null) }

/**
 * Petals engraved in this page load, by the first month of their print or plate (or 'empty' for
 * the empty plate's hour marks): a seal shown again engraves only what is new on it. Nothing is
 * kept past a reload, so each page load engraves once.
 */
const engraved = new Map<string, number>()

/** Forget what has been engraved, so each seal engraves again when next shown. */
export function resetEngravings(): void {
  engraved.clear()
}

/**
 * How long an engraving runs, to match PrintsShelf.module.css: petals draw in 450 ms, 55 ms apart;
 * the band's months fade in 300 ms each, 35 ms apart, from 500 ms; an empty plate's twelve hour
 * marks take 240 ms each, 55 ms apart. A little over, so the last frame has landed.
 */
export function engraveMs(count: number, empty: boolean): number {
  if (empty) return 240 + 55 * 11 + 100
  const n = Math.max(1, count)
  return Math.max(450 + 55 * (n - 1), 800 + 35 * (n - 1)) + 100
}

const reducedMotion = (): boolean =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** What the big seal shows: the empty plate, the plate filling in, or a finished print. */
type Featured =
  | { kind: 'empty'; seal: PrintView }
  | { kind: 'plate'; seal: PrintView }
  | { kind: 'print'; seal: PrintView; k: number }

export default function PrintsShelf(): JSX.Element {
  const view = createMemo<ShelfView | null>(() => {
    const s = snapshot()
    if (!s) return null
    return shelfView({
      transactions: s.transactions,
      trackedMonths: s.evaluation.trackedMonths,
      today: s.today,
    })
  })

  /** The finished print picked from Every print; the newest when none is. */
  const [picked, setPicked] = createSignal<string | null>(null)
  createEffect(() => {
    const p = picked()
    if (p !== null && !view()?.prints.some((print) => print.from === p)) setPicked(null)
  })

  const featured = createMemo<Featured | null>(() => {
    const v = view()
    if (!v) return null
    if (v.prints.length === 0) {
      return v.plate ? { kind: 'plate', seal: v.plate } : { kind: 'empty', seal: EMPTY }
    }
    const found = v.prints.findIndex((print) => print.from === picked())
    const at = found >= 0 ? found : v.prints.length - 1
    return { kind: 'print', seal: v.prints[at], k: at + 1 }
  })

  /** What is still to engrave on the featured seal: from `from` up to `target`. */
  const engraving = createMemo(
    () => {
      const f = featured()
      if (!f) return null
      const key = f.kind === 'empty' ? 'empty' : f.seal.from
      const target = f.kind === 'empty' ? SEAL_SLOTS : f.seal.months
      const from = reducedMotion() ? target : Math.min(engraved.get(key) ?? 0, target)
      return { key, target, from }
    },
    null,
    { equals: (a, b) => a?.key === b?.key && a?.target === b?.target && a?.from === b?.from }
  )

  const svg = createMemo(() => {
    const f = featured()
    if (!f) return ''
    return drawSeal(f.seal.slots, {
      palette: f.kind === 'print' ? PAPER : THEME,
      detail: 'screen',
      engraveFrom: f.kind === 'empty' ? 0 : (engraving()?.from ?? f.seal.months),
    })
  })

  /**
   * Engrave once the seal has settled in view (70% for 500 ms, or 3 s after it first shows): the
   * new petals draw clockwise, then the band's months fade in. Until then the new parts are held
   * back, and only once this is waiting, so a seal is never hidden with nothing to show it.
   */
  let figure: HTMLDivElement | undefined
  createEffect(() => {
    const e = engraving()
    const el = figure
    if (!e || !el || e.from >= e.target) return
    const { key, target, from } = e
    el.dataset.engraving = 'armed'
    let finish: ReturnType<typeof setTimeout> | undefined
    const stop = whenSettledInView(el, () => {
      el.dataset.engraving = 'engraving'
      finish = setTimeout(
        () => {
          delete el.dataset.engraving
          engraved.set(key, target)
        },
        engraveMs(target - from, key === 'empty')
      )
    })
    onCleanup(() => {
      stop()
      clearTimeout(finish)
      delete el.dataset.engraving
    })
  })

  const label = createMemo(() => {
    const f = featured()
    if (!f) return ''
    return sealSummary(f.seal.slots, f.seal.from || '2000-01', printWords)
  })

  const plateThumb = (plate: PrintView): string =>
    drawSeal(plate.slots, { palette: THEME, detail: 'thumb' })

  const printThumb = (print: PrintView): string =>
    drawSeal(print.slots, { palette: PAPER, detail: 'thumb' })

  /** Newest first, as people look for the latest. */
  const newestFirst = createMemo(() => [...(view()?.prints ?? [])].reverse())

  return (
    <div
      class={styles.body}
      data-test-id="progress-prints"
      data-tour="progress-prints"
      aria-busy={view() === null ? 'true' : undefined}
    >
      <Show when={featured()} fallback={<div class={styles.pending} />}>
        {(f) => (
          <div class={styles.shelf} data-state={f().kind}>
            <div class={styles.head}>
              <p class={styles.eyebrow} data-test-id="prints-eyebrow">
                {f().kind === 'print' ? printEyebrow((f() as { k: number }).k) : FIRST_EYEBROW}
              </p>
              <Show when={f().kind !== 'empty'} fallback={<p class={styles.line}>{EMPTY_LINE}</p>}>
                <h3 class={styles.title} data-test-id="prints-title">
                  {f().kind === 'print' ? periodOf(f().seal) : plateTitle(f().seal, view()!)}
                </h3>
                <Show when={f().kind === 'plate' && plateLine(f().seal, view()!)}>
                  {(line) => (
                    <p class={styles.line} data-test-id="prints-plate-line">
                      {line()}
                    </p>
                  )}
                </Show>
                <Show when={holdsMonth(f().seal, view()!.running)}>
                  <p class={styles.line}>{runningLine(view()!.running!)}</p>
                </Show>
              </Show>
            </div>

            <div class={styles.figure} ref={figure} data-test-id="prints-figure">
              <div
                class={styles.seal}
                classList={{ [styles.paper]: f().kind === 'print' }}
                role="img"
                aria-label={label()}
                data-test-id="prints-seal"
                data-kind={f().kind}
                data-from={f().seal.from}
                data-months={f().seal.months}
                innerHTML={svg()}
              />
            </div>

            <div class={styles.rest}>
              <Show when={f().kind !== 'empty'}>
                <p class={styles.legend}>{LEGEND}</p>
              </Show>
              <Show when={f().kind === 'print'}>
                <p class={styles.legend}>{SHAPE_LINE}</p>
              </Show>
              <Show when={f().kind === 'print' && view()!.plate}>
                {(plate) => (
                  <div class={styles.next} data-test-id="prints-next">
                    <div
                      class={styles.nextSeal}
                      aria-hidden="true"
                      innerHTML={plateThumb(plate())}
                    />
                    <div>
                      <h3 class={styles.nextHeading}>{NEXT_HEADING}</h3>
                      <p class={styles.line} data-test-id="prints-next-status">
                        {plate().months === 0
                          ? nextStart(plate(), view()!)
                          : plateTitle(plate(), view()!)}
                      </p>
                      <Show
                        when={
                          plate().months > 0
                            ? plateLine(plate(), view()!)
                            : view()!.gap && gapLine(view()!.gap!)
                        }
                      >
                        {(line) => <p class={styles.line}>{line()}</p>}
                      </Show>
                    </div>
                  </div>
                )}
              </Show>
            </div>

            <Show when={newestFirst().length > 1}>
              <div class={styles.every}>
                <h3 class={styles.everyHeading}>{EVERY_HEADING}</h3>
                <ul class={styles.strip} data-test-id="prints-every">
                  <For each={newestFirst()}>
                    {(print) => (
                      <li>
                        <button
                          type="button"
                          class={styles.thumb}
                          aria-label={thumbLabel(print)}
                          aria-pressed={
                            f().kind === 'print' && f().seal.from === print.from ? 'true' : 'false'
                          }
                          data-from={print.from}
                          onClick={() => {
                            setPicked(print.from)
                          }}
                        >
                          <span class={styles.thumbSeal} innerHTML={printThumb(print)} />
                        </button>
                      </li>
                    )}
                  </For>
                </ul>
              </div>
            </Show>
          </div>
        )}
      </Show>
    </div>
  )
}
