/**
 * Connected Sources' "Add a sheet" form: a Google Sheet's link and, if the person wants one, a name.
 *
 * The link and the name are checked with the rules both runtimes run
 * (shared/importSourceSchema.ts) before anything is sent. Saving reads the sheet once, to remember
 * its columns by name, then saves the source. A sheet that cannot be read, and a source either
 * runtime refuses, are marked under the field they are about. Both used to end in a toast ("Could
 * not fetch that sheet", "Could not save the source") with the link still in the field and no word
 * at it.
 */
import { checkImportSourceCreate } from '../../../../shared/importSourceSchema'
import { fieldErrorsOf } from '../../../../shared/refusal'
import { createForm } from '../../components/form'
import { ApiError } from '../../core/apiError'
import { autoDetectMapping, mappingToHeaderNames } from '../../core/importMapping'
import { createImportSource } from '../../core/importSources'
import { addToast } from '../../core/toastStore'
import type { FieldErrors } from '../../../../shared/refusal'
import type { Form } from '../../components/form'
import type { ImportSource } from '../../core/importSources'
import type { ImportFlow } from './importFlow'

export interface SheetSourceValues {
  url: string
  label: string
}

/** A source's fields as this form shows them: the link is the source's `config.url`. */
function asFormFields(fields: FieldErrors): FieldErrors {
  const { 'config.url': url, ...rest } = fields
  return url === undefined ? rest : { ...rest, url }
}

/** The body this form saves for a sheet. */
function sourceBody(values: SheetSourceValues, extra: Record<string, unknown> = {}) {
  return {
    kind: 'google_sheet' as const,
    label: values.label,
    config: { url: values.url, sheetName: '' },
    schedule: 'manual' as const,
    ...extra,
  }
}

/**
 * `flow` is the hidden import flow Connected Sources drives; `onSaved` puts the new source in the
 * list and closes the form.
 */
export function createSheetSourceForm(options: {
  flow: ImportFlow
  onSaved: (source: ImportSource) => void
}): Form<SheetSourceValues> {
  const { flow } = options
  return createForm<SheetSourceValues, ImportSource>({
    initial: { url: '', label: '' },
    check: (values) => asFormFields(fieldErrorsOf(checkImportSourceCreate(sourceBody(values)))),
    send: async (values) => {
      // Read the sheet once, to remember its columns by header name: they survive the sheet's
      // owner reordering them.
      flow.resetForm()
      flow.setActiveImportTab('google-sheets')
      flow.setSheetUrl(values.url)
      flow.setSelectedSheet('')
      await flow.fetchGoogleSheet({ navigate: false, rethrow: true })
      const headers = flow.currentHeaders()
      const sheetName = flow.selectedSheet()
      try {
        const created = await createImportSource(
          sourceBody(
            { url: values.url.trim(), label: values.label.trim() || sheetName || 'Google Sheet' },
            {
              config: { url: values.url.trim(), sheetName },
              mapping: mappingToHeaderNames(autoDetectMapping(headers), headers),
            }
          )
        )
        addToast(`Saved "${created.label}". Sync it from here whenever you like.`, 'success')
        return created
      } catch (error) {
        if (error instanceof ApiError) {
          throw new ApiError(error.status, error.message, asFormFields(error.fields))
        }
        throw error
      }
    },
    saved: (created) => {
      options.onSaved(created)
    },
    failure: "Couldn't save the sheet. Try again.",
  })
}
