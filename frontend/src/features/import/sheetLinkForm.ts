/**
 * The Import page's Google Sheets link, on the form kit: the link is checked with the rule both
 * runtimes run (shared/importSourceSchema.ts) before anything is fetched, and a link either
 * refuses, or a sheet that cannot be read, is marked under the field. It used to go in the banner
 * at the top of the page ("Please enter a Google Sheets URL", "Invalid Google Sheets URL or ID"),
 * away from the field it was about.
 */
import { createEffect, on } from 'solid-js'
import { checkSheetFetch } from '../../../../shared/importSourceSchema'
import { fieldErrorsOf } from '../../../../shared/refusal'
import { createForm } from '../../components/form'
import { SHEET_UNREAD } from './importFlow'
import type { Form } from '../../components/form'
import type { ImportFlow } from './importFlow'

export interface SheetLinkValues {
  url: string
}

/** The link field for `flow`, which keeps the link the page fetches. */
export function createSheetLinkForm(flow: ImportFlow): Form<SheetLinkValues> {
  const form = createForm<SheetLinkValues>({
    initial: { url: flow.sheetUrl() },
    check: (values) => fieldErrorsOf(checkSheetFetch(values)),
    send: async () => {
      await flow.fetchGoogleSheet({ rethrow: true })
    },
    failure: SHEET_UNREAD,
  })
  // The flow's link can change without the field: a reset after an import empties it.
  createEffect(
    on(flow.sheetUrl, (url) => {
      if (url !== form.values.url) form.reset({ url })
    })
  )
  return form
}
