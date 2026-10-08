/**
 * An amount to the cent.
 *
 * Amounts exact to the cent do not stay exact in floating point once they are added up or taken
 * away: 10.3 - 0.1 - 0.2 is 10.000000000000002, and 1000.1 - 260.45 is 739.6500000000001. A figure
 * a person reads as money, or compares with another, is worked out to the cent, as they would.
 */
export function toCents(amount: number): number {
  return Math.round(amount * 100) / 100;
}
