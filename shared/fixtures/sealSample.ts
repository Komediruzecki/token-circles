/**
 * One seal both runtimes draw, to show the drawing is the same text in each: the journey plan's
 * Sample Household year (invented; October 2025 to September 2026) as seal shares. Shares only:
 * no amounts were ever in this file. The browser suite (printsSeal.test.ts) and the Worker suite
 * (seal-drawing.test.ts) both hash drawSeal's output and compare it with these.
 *
 * A change to the drawing changes these hashes on purpose: bump SEAL_VERSION when a stored print
 * would look different (shared/prints/seal.ts), then put the new hashes here.
 */
import type { SealSlot } from '../prints/seal';

export const SAMPLE_FROM = '2025-10';

export const SAMPLE_SLOTS: SealSlot[] = [
  { spent: 61, kept: 31 },
  { spent: 74, kept: 31 },
  { spent: 77, kept: 93 },
  { spent: 68, kept: 6 },
  { spent: 63, kept: 65 },
  { spent: 74, kept: -13 },
  { spent: 69, kept: 1 },
  { spent: 72, kept: 35 },
  { spent: 64, kept: 61 },
  { spent: 63, kept: 67 },
  { spent: 100, kept: -100 },
  { spent: 69, kept: 2 },
];

/** SHA-256 of drawSeal(SAMPLE_SLOTS, { palette: PAPER, detail }), as hex. */
export const SAMPLE_SHA256 = {
  print: '2257386ad14aead823ee51734b7a9c95c72337fd299f8c7cd646b924c62fab3d',
  screen: '62476b2c301f7da99d65b52300957c468fa3daad3e894a3f5d7231b521672d20',
  thumb: 'f3b786c4134190213939012dfb675b7504377879359dc2ce03722995440e369c',
} as const;
