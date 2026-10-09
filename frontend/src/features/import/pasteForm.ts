/**
 * The Import page's Paste CSV tab, on the form kit: the pasted rows and how their columns are
 * separated.
 *
 * Its button stayed disabled until something was pasted, with nothing to say why, and a paste of
 * one line was "Need at least a header row and one data row" in the banner at the top of the page.
 * Now an empty paste, or one with no row of data under its header, is marked under the box, which
 * keeps focus, and nothing is parsed.
 */
import { createForm } from '../../components/form'
import type { Form } from '../../components/form'
import type { ImportFlow } from './importFlow'

export interface PasteValues {
  text: string
}

export const PASTE_MESSAGES = {
  text: 'Paste a header row and at least one row of data under it, like "date,description,amount".',
} as const

/** A pasted line that holds a value: not blank, and not only separators and quotes. */
const holdsValue = (line: string) => line.replace(/[\s,;"]/g, '') !== ''

/** Whether `text` has a header row and a row of data under it. */
export function checkPaste(values: PasteValues): Record<string, string> {
  const lines = values.text.trim().split('\n')
  const [header, ...rest] = lines
  return holdsValue(header ?? '') && rest.some(holdsValue) ? {} : { text: PASTE_MESSAGES.text }
}

/** The paste field for `flow`, which keeps the pasted text and parses it. */
export function createPasteForm(flow: ImportFlow): Form<PasteValues> {
  // The box is the only thing that writes the flow's text, and it writes both.
  return createForm<PasteValues>({
    initial: { text: flow.pastedText() },
    check: checkPaste,
    send: (values) => {
      flow.parsePastedData(values.text)
    },
    failure: "Couldn't read the pasted rows. Try again.",
  })
}
