/**
 * Prints, on Progress (first week, phase 4): every twelve tracked months in a row make a print,
 * the year drawn as a seal (shared/prints/seal.ts). The section shows in every state: an empty
 * plate before any month is tracked, the plate filling in month by month, then the newest print
 * on paper with the next plate beside it and every print below.
 *
 * Everything here is worked out from the badges' snapshot each time (core/prints/shelf.ts); the
 * view it reads carries seal shares only, so no amount reaches the page.
 */
import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show } from 'solid-js'
import { monthLine, sealSummary } from '../../../shared/prints/describe'
import { drawSeal, PAPER, SEAL_SLOTS, sealSector, THEME } from '../../../shared/prints/seal'
import { snapshot } from '../core/achievementsStore'
import {
  EMPTY_LINE,
  EVERY_HEADING,
  FIRST_EYEBROW,
  gapLine,
  holdsMonth,
  LEGEND,
  MONTHS_HEADING,
  NEXT_HEADING,
  nextStart,
  periodOf,
  plateLine,
  plateTitle,
  PRINT_SAVED,
  printEyebrow,
  printWords,
  READOUT_IDLE,
  runningLine,
  SHAPE_LINE,
  SHARE_FAILED,
  SHARE_LABEL,
  thumbLabel,
} from '../core/prints/copy'
import { sharePrint } from '../core/prints/share'
import { shelfView } from '../core/prints/shelf'
import { inTurn, thumbSrc } from '../core/prints/thumbs'
import { whenNearScreen, whenSettledInView } from '../core/settledInView'
import { addToast } from '../core/toastStore'
import styles from './PrintsShelf.module.css'
import type { JSX } from 'solid-js'
import type { SealSlot } from '../../../shared/prints/seal'
import type { PrintView, ShelfView } from '../core/prints/shelf'

/** No month on it: the frame and the twelve hour marks. */
const EMPTY: PrintView = { from: '', months: 0, slots: Array(SEAL_SLOTS).fill(null) }

/**
 * Petals engraved in this page load, by profile and the first month of their print or plate (or
 * 'empty' for the empty plate's hour marks): a seal shown again engraves only what is new on it,
 * and another profile's seal of the same months is a seal of its own. Nothing is kept past a
 * reload, so each page load engraves once.
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

/**
 * A finished print in Every print: its image on paper, drawn once it comes within a screen of
 * the viewport, two to a task (core/prints/thumbs.ts). Until then the button holds its place.
 */
function PrintThumb(props: { slots: SealSlot[] }): JSX.Element {
  const [due, setDue] = createSignal(false)
  const src = createMemo(() => (due() ? thumbSrc(props.slots) : null))
  let el: HTMLSpanElement | undefined
  onMount(() => {
    let cancel: (() => void) | undefined
    const stop = whenNearScreen(el!, () => {
      cancel = inTurn(() => setDue(true))
    })
    onCleanup(() => {
      stop()
      cancel?.()
    })
  })
  return (
    <span ref={el} class={styles.thumbSeal}>
      <Show when={src()}>
        {(s) => <img src={s()} alt="" width="96" height="96" decoding="async" />}
      </Show>
    </span>
  )
}

/** What the big seal shows: the empty plate, the plate filling in, or a finished print. */
type Featured =
  | { kind: 'empty'; seal: PrintView }
  | { kind: 'plate'; seal: PrintView }
  | { kind: 'print'; seal: PrintView; k: number }

export default function PrintsShelf(): JSX.Element {
  /**
   * Worked out and drawn a task after Progress's first render, so the shelf never lengthens that
   * task. In the built app at 4x CPU, Progress's first task fell from about 120 ms with the shelf
   * in it to about 80 ms, and the shelf's own task stayed under 50 ms (scripts/prints-perf.mjs).
   * Until then the section holds its place.
   */
  const [started, setStarted] = createSignal(false)
  onMount(() => {
    const later = setTimeout(() => {
      setStarted(true)
    }, 0)
    onCleanup(() => {
      clearTimeout(later)
    })
  })
  const view = createMemo<ShelfView | null>(() => {
    const s = snapshot()
    if (!s || !started()) return null
    return shelfView({
      transactions: s.transactions,
      trackedMonths: s.evaluation.trackedMonths,
      today: s.today,
    })
  })

  /**
   * The profile the snapshot is for. Every example profile has prints from the same months, so a
   * pick is dropped when the profile changes, and what was engraved is kept by profile as well as
   * by first month.
   */
  const profile = (): number | null => snapshot()?.profileId ?? null

  /**
   * The finished print picked from Every print; the newest when none is. A snapshot for another
   * profile drops it, and coming back finds the newest print too.
   */
  const [picked, setPicked] = createSignal<string | null>(null)
  createEffect(
    on(
      profile,
      () => {
        setPicked(null)
      },
      { defer: true }
    )
  )
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
      const empty = f.kind === 'empty'
      const key = `${String(profile())}:${empty ? 'empty' : f.seal.from}`
      const target = empty ? SEAL_SLOTS : f.seal.months
      const from = reducedMotion() ? target : Math.min(engraved.get(key) ?? 0, target)
      return { key, target, from, empty }
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
    const { key, target, from, empty } = e
    el.dataset.engraving = 'armed'
    let finish: ReturnType<typeof setTimeout> | undefined
    const stop = whenSettledInView(el, () => {
      el.dataset.engraving = 'engraving'
      finish = setTimeout(
        () => {
          delete el.dataset.engraving
          engraved.set(key, target)
        },
        engraveMs(target - from, empty)
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

  /**
   * Reading a month: a tap or click picks a month until it is tapped again, and a mouse pointing
   * at a petal previews one. The readout gives its line and the other months fade. A different
   * seal featured clears it.
   */
  const [reading, setReading] = createSignal<number | null>(null)
  const [preview, setPreview] = createSignal<number | null>(null)
  createEffect(
    on(
      () => {
        const f = featured()
        return f ? `${f.kind}:${f.seal.from}` : ''
      },
      () => {
        setReading(null)
        setPreview(null)
      },
      { defer: true }
    )
  )
  /** The filled months, in clock order: the ones that can be read. */
  const filledSlots = createMemo(() => {
    const f = featured()
    return f ? f.seal.slots.flatMap((slot, m) => (slot === null ? [] : [m])) : []
  })
  const shown = createMemo(() => {
    const m = preview() ?? reading()
    return m !== null && filledSlots().includes(m) ? m : null
  })
  const lineOf = (seal: PrintView, m: number): string =>
    monthLine(seal.slots, seal.from, m, printWords)
  const readout = createMemo(() => {
    const f = featured()
    const m = shown()
    return f && m !== null ? lineOf(f.seal, m) : READOUT_IDLE
  })

  /** Fade every month but the one read; the drawing is a string, so this marks its groups. */
  let sealEl: HTMLDivElement | undefined
  createEffect(() => {
    svg()
    const m = shown()
    sealEl?.querySelectorAll<SVGElement>('[data-slot]').forEach((g) => {
      g.toggleAttribute('data-dim', m !== null && g.dataset.slot !== String(m))
    })
  })

  /**
   * Share the featured print as an image: the share sheet where the platform takes files, a
   * download otherwise. A share sheet closed without sharing is no failure, so it says nothing.
   */
  const [sharing, setSharing] = createSignal(false)
  const share = async (): Promise<void> => {
    const f = featured()
    if (f?.kind !== 'print' || sharing()) return
    setSharing(true)
    try {
      const how = await sharePrint(f.seal, f.k === 1)
      if (how === 'downloaded') addToast(PRINT_SAVED, 'success', { channel: 'prints' })
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        addToast(SHARE_FAILED, 'error', { channel: 'prints' })
      }
    } finally {
      setSharing(false)
    }
  }

  const plateThumb = (plate: PrintView): string =>
    drawSeal(plate.slots, { palette: THEME, detail: 'thumb' })

  /**
   * Every print, newest first, as people look for the latest. Listed by first month, not by the
   * print object, so a fresh snapshot keeps each button and its image instead of building them
   * all again.
   */
  const newestFirst = createMemo(() => (view()?.prints ?? []).map((print) => print.from).reverse())
  const printFrom = (from: string): PrintView | undefined =>
    view()?.prints.find((print) => print.from === from)

  return (
    <div
      class={styles.body}
      data-test-id="progress-prints"
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

            {/* The Progress tour's Prints step points here, not at the whole shelf: with every
                print and the month list open, the shelf is taller than a phone's screen (1550 px
                at 390), and a spotlight that tall puts the tip over the words and pulls back
                every scroll. Every state draws the seal: the empty plate, a plate filling in and
                a print. Before the snapshot, the step waits for it (Spotlight's waitForTarget). */}
            <div
              class={styles.figure}
              ref={figure}
              data-test-id="prints-figure"
              data-tour="progress-prints"
            >
              <div
                ref={sealEl}
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
              {/* Each month's whole sector is its tap target; the list below says the same. */}
              <Show when={filledSlots().length > 0}>
                <svg class={styles.wedges} viewBox="0 0 1200 1200" aria-hidden="true">
                  <For each={filledSlots()}>
                    {(m) => (
                      <path
                        d={sealSector(m)}
                        data-test-id="prints-wedge"
                        data-slot={m}
                        onClick={() => {
                          // Tapped again, it lets go, and so does a mouse's preview of it, or
                          // the click would seem to do nothing until the pointer moved off.
                          if (reading() === m) {
                            setReading(null)
                            setPreview(null)
                          } else {
                            setReading(m)
                          }
                        }}
                        onPointerEnter={(e) => {
                          if (e.pointerType === 'mouse') setPreview(m)
                        }}
                        onPointerLeave={() => {
                          setPreview((p) => (p === m ? null : p))
                        }}
                      />
                    )}
                  </For>
                </svg>
              </Show>
            </div>

            <div class={styles.rest}>
              <Show when={f().kind !== 'empty'}>
                <p class={styles.legend}>{LEGEND}</p>
              </Show>
              <Show when={f().kind === 'print'}>
                <p class={styles.legend}>{SHAPE_LINE}</p>
              </Show>
              <Show when={f().kind !== 'empty'}>
                <p class={styles.readout} aria-live="polite" data-test-id="prints-readout">
                  {readout()}
                </p>
                <details class={styles.months} data-test-id="prints-months">
                  <summary>{MONTHS_HEADING}</summary>
                  <ol>
                    <For each={filledSlots()}>{(m) => <li>{lineOf(f().seal, m)}</li>}</For>
                  </ol>
                </details>
              </Show>
              <Show when={f().kind === 'print'}>
                <button
                  type="button"
                  class={styles.share}
                  data-test-id="prints-share"
                  aria-busy={sharing() ? 'true' : undefined}
                  onClick={() => {
                    void share()
                  }}
                >
                  {SHARE_LABEL}
                </button>
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
                {/* On a phone the strip scrolls sideways, and Chromium scrolls a focused print
                    into view only when none of it shows: Tab to one the strip shows a sliver of
                    left it cut off. A print focused from the keyboard comes wholly into view,
                    within the strip's scroll padding, so its ring shows too. At once, as the
                    browser's own focus scroll is, so reduced motion needs nothing more. A print
                    tapped or clicked stays where it was aimed: sliding the strip under a finger
                    as the featured seal changes above would be a jump. */}
                <ul
                  class={styles.strip}
                  data-test-id="prints-every"
                  onFocusIn={(e) => {
                    const thumb = e.target as HTMLElement
                    if (thumb.matches(':focus-visible')) {
                      thumb.scrollIntoView({ block: 'nearest', inline: 'nearest' })
                    }
                  }}
                >
                  <For each={newestFirst()}>
                    {(from) => (
                      <li>
                        <button
                          type="button"
                          class={styles.thumb}
                          aria-label={thumbLabel({ from })}
                          aria-pressed={
                            f().kind === 'print' && f().seal.from === from ? 'true' : 'false'
                          }
                          data-from={from}
                          onClick={() => {
                            setPicked(from)
                          }}
                        >
                          <PrintThumb slots={printFrom(from)?.slots ?? EMPTY.slots} />
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
