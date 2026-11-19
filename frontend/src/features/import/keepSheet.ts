/**
 * Keeping the Google Sheet an import on the page read (maff, 19 Nov): after the import, the card
 * at the top of the page (ImportAfter.tsx) says whether the sheet is a connected source already,
 * where Sync reads it again, and offers to save it when it is not.
 *
 * Saved as Connected sources' Add a sheet saves one (sheetSourceForm.ts), with the columns as this
 * import matched them, by header name, and the category types it was given. It is marked synced
 * now, since its rows just came in.
 */
import { checkImportSourceCreate } from '../../../../shared/importSourceSchema'
import { fieldErrorsOf } from '../../../../shared/refusal'
import { createForm } from '../../components/form'
import { createImportSource, parseSheetUrl } from '../../core/importSources'
import type { Form } from '../../components/form'
import type { ImportSource } from '../../core/importSources'

/** The sheet an import read, as the card offers to keep it. */
export interface SheetToKeep {
  url: string
  /** The tab's name, as the sheet answered it. */
  sheetName: string
  /** The columns as this import matched them: field to header name. */
  mapping: Record<string, string>
  categoryTypes: Record<string, 'income' | 'expense' | 'account'>
}

/** The tab a link opens on: its gid, or the first tab's, 0, when the link names none. */
const tabOf = (gid: string | null): string => gid ?? '0'

/** The saved source that reads this sheet's tab, if there is one. */
export function sourceForSheet(sources: readonly ImportSource[], url: string): ImportSource | null {
  const wanted = parseSheetUrl(url)
  if (!wanted.id) return null
  return (
    sources.find((source) => {
      if (source.kind !== 'google_sheet') return false
      const saved = parseSheetUrl(source.config?.url ?? '')
      return saved.id === wanted.id && tabOf(saved.gid) === tabOf(wanted.gid)
    }) ?? null
  )
}

/** The source to save: named as typed, else for its tab, as Add a sheet names one. */
export function keepSheetBody(sheet: SheetToKeep, label: string, now: string) {
  return {
    kind: 'google_sheet' as const,
    label: label.trim() || sheet.sheetName || 'Google Sheet',
    config: { url: sheet.url, sheetName: sheet.sheetName },
    mapping: sheet.mapping,
    category_types: sheet.categoryTypes,
    schedule: 'manual' as const,
    last_synced_at: now,
  }
}

export interface KeepSheetValues {
  label: string
}

/** The card's Save sheet: a name, if the person wants one, checked as both runtimes check it. */
export function createKeepSheetForm(options: {
  sheet: SheetToKeep
  onSaved: (source: ImportSource) => void
}): Form<KeepSheetValues> {
  return createForm<KeepSheetValues, ImportSource>({
    initial: { label: '' },
    check: (values) =>
      fieldErrorsOf(
        checkImportSourceCreate(
          keepSheetBody(options.sheet, values.label, new Date().toISOString())
        )
      ),
    send: (values) =>
      createImportSource(keepSheetBody(options.sheet, values.label, new Date().toISOString())),
    saved: (source) => {
      options.onSaved(source)
    },
    failure: "Couldn't save the sheet. Try again.",
  })
}
