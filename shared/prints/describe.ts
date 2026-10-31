/**
 * The words for a seal: its text alternative and the line for each month, worked out from the
 * same shares the drawing uses, so they can never say more than the picture shows. No amounts,
 * no categories, no names: how the months compare, and which kept money.
 *
 * Shared because the print mail (phase 5) needs the same description as the app's alt text. The
 * caller says how a month is named (`monthName`, 'YYYY-MM' to "March 2026"), as the browser and
 * the Worker each have their own way of formatting dates.
 */
import { addCalendarMonths } from '../calendarMonths';
import type { SealSlot } from './seal';

export interface SealWords {
  /** 'YYYY-MM' to the month's name and year, like "March 2026". */
  monthName: (month: string) => string;
}

const ORDINALS = [
  '',
  '',
  'second',
  'third',
  'fourth',
  'fifth',
  'sixth',
  'seventh',
  'eighth',
  'ninth',
  'tenth',
  'eleventh',
];

const monthAt = (from: string, i: number): string => addCalendarMonths(`${from}-01`, i).slice(0, 7);

function list(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** Each filled slot's rank by spending, 1 for the most; months that spent the same share a rank. */
function ranks(slots: readonly SealSlot[]): Map<number, { rank: number; of: number }> {
  const values = [...new Set(slots.filter((s) => s !== null).map((s) => s!.spent))].sort(
    (a, b) => b - a
  );
  const out = new Map<number, { rank: number; of: number }>();
  slots.forEach((s, i) => {
    if (s !== null) out.set(i, { rank: values.indexOf(s.spent) + 1, of: values.length });
  });
  return out;
}

const filled = (slots: readonly SealSlot[]): number => slots.filter((s) => s !== null).length;

/** The line a tapped petal shows. */
export function monthLine(
  slots: readonly SealSlot[],
  from: string,
  i: number,
  words: SealWords
): string {
  const slot = slots[i];
  const name = words.monthName(monthAt(from, i));
  if (!slot) return `${name} is not on this print yet.`;
  const n = filled(slots);
  const kept =
    slot.kept > 0 ? 'kept money' : slot.kept < 0 ? 'more than came in' : 'came out about even';
  if (n === 1) {
    return slot.kept < 0
      ? `${name} is the only month here so far. It spent more than came in.`
      : `${name} is the only month here so far, and it ${kept}.`;
  }
  const { rank, of } = ranks(slots).get(i)!;
  const most = rank === 1 ? 'the most' : rank === of ? 'the least' : `the ${ORDINALS[rank]} most`;
  return `${name} spent ${most} of these ${n} months, and ${kept}.`;
}

/** The text alternative: what the seal shows, in two or three sentences. */
export function sealSummary(slots: readonly SealSlot[], from: string, words: SealWords): string {
  const n = filled(slots);
  if (n === 0) return 'An empty seal with twelve places, one for each month you track.';
  const names = slots.map((s, i) => (s === null ? null : words.monthName(monthAt(from, i))));
  const r = ranks(slots);
  const pick = (rank: number) => names.filter((_, i) => r.get(i)?.rank === rank) as string[];
  const lastFilled = slots.reduce((last, s, i) => (s === null ? last : i), 0);
  const period = `${words.monthName(from)} to ${words.monthName(monthAt(from, n === 12 ? 11 : lastFilled))}`;
  const head =
    n === 12
      ? `A seal of twelve petals in a woven band, ${period}.`
      : `A seal with ${n} of its 12 petals so far, ${period}.`;
  const spread =
    n === 1
      ? ''
      : ` ${list(pick(1))} spent the most, ${list(pick(Math.max(...[...r.values()].map((v) => v.rank))))} the least.`;
  const red = names.filter((_, i) => slots[i] !== null && slots[i]!.kept < 0) as string[];
  const band =
    red.length === 0
      ? ' Every month kept money or came out about even.'
      : ` The band turns copper for ${list(red)}, ${red.length === 1 ? 'which' : 'which each'} spent more than came in.`;
  return head + spread + band;
}
