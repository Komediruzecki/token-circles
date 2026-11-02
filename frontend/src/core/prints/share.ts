/**
 * A finished print as an image to share (phase 4 design, section 3.7): the seal on its paper at
 * print detail, 1200 by 1200 pixels, through the platform's share sheet where it takes files and
 * a download otherwise, as a badge's card goes. The image holds no text, and no amount: the
 * drawing is made from shares.
 */
import { drawSeal, PAPER } from '../../../../shared/prints/seal'
import { addMonths } from '../achievements/months'
import { shareOrSave, toPng } from '../achievements/shareCard'
import { SHARE_TEXT, shareTitle } from './copy'
import type { SealSlot } from '../../../../shared/prints/seal'

/** The shared image's width and height, in pixels. */
export const PRINT_PX = 1200

/** The print on paper as a document an `<img>` can size: the drawing with its width and height. */
export const printImageSvg = (slots: readonly SealSlot[]): string =>
  drawSeal(slots, { palette: PAPER, detail: 'print' }).replace(
    '<svg ',
    `<svg width="${PRINT_PX}" height="${PRINT_PX}" `
  )

/** `token-circles-print-2025-10-to-2026-09.png`: the months it holds, first and last. */
export const printFileName = (from: string): string =>
  `token-circles-print-${from}-to-${addMonths(from, 11)}.png`

export async function sharePrint(
  print: { from: string; slots: readonly SealSlot[] },
  first: boolean
): Promise<'shared' | 'downloaded'> {
  const png = await toPng(printImageSvg(print.slots), PRINT_PX, PRINT_PX)
  return shareOrSave(png, printFileName(print.from), {
    title: shareTitle(first),
    text: SHARE_TEXT,
  })
}
