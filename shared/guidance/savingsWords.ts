/**
 * The savings rate in the person's own words, for the savings card (cards.ts, behind the benchmarks
 * gate) and the Dashboard gauge (in every build): the title with their rate over the window, and
 * the D6 line on loan principal. Own numbers only: nothing here quotes a regional figure, so the
 * gauge can say it with the gate closed.
 */
import type { GuidanceFacts } from './facts';
import type { LedgerWords } from './ledger';

/** A percentage, floored to one decimal so it never reads as past an edge it has not reached. */
export function percentText(value: number): string {
  const floored = Math.floor(value * 10 + 1e-9) / 10;
  return Number.isInteger(floored) ? String(floored) : floored.toFixed(1);
}

/**
 * The rate a person sees: the one with loan principal added back (D6), unless cash alone runs
 * below zero, when the cash fact leads, as cash is what drains the cushion. Null without a rate.
 */
export function shownRate(facts: GuidanceFacts): number | null {
  const { rate, cash } = facts.savings;
  if (rate === null || cash === null || facts.income === null || facts.spending === null) {
    return null;
  }
  return cash < 0 ? cash : rate;
}

/** "You kept 16.7% of your income", or with cash below zero "€120 a month more out than in". */
export function savingsTitle(facts: GuidanceFacts, words: LedgerWords): string | null {
  const shown = shownRate(facts);
  if (shown === null || facts.income === null || facts.spending === null) return null;
  return facts.savings.cash !== null && facts.savings.cash < 0
    ? `${words.money(Math.round(facts.spending - facts.income))} a month more out than in`
    : `You kept ${percentText(shown)}% of your income`;
}

/**
 * The D6 line: loan principal paid down counts as saving, as it does in the national figures. Only
 * when it moves the rate by more than a point.
 */
export function principalLine(facts: GuidanceFacts, words: LedgerWords): string | null {
  const { cash, withPrincipal } = facts.savings;
  const principal = facts.principalRepaid ?? 0;
  if (cash === null || withPrincipal === null || principal <= 0 || withPrincipal - cash <= 1) {
    return null;
  }
  const money = words.money(Math.round(principal));
  return cash < 0
    ? `Of your loan payments, ${money} a month paid the debt down. Counting that, you saved ${percentText(withPrincipal)}%.`
    : `Of your loan payments, ${money} a month on average paid the debt down; that counts as saving here. Cash alone: ${percentText(cash)}%.`;
}
