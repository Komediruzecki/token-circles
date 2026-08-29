/**
 * Bank statement import — the injected spreadsheet reader.
 *
 * `shared/` sits at the repo root, so a bare `import 'xlsx'` from here does not
 * resolve: the package is installed under `frontend/` and `worker/`, and node
 * resolution walks up from the importing file. Rather than hoist a dependency to
 * the workspace root, the one adapter that needs a workbook parser (PBZ's legacy
 * binary .xls) takes the module as a parameter, and each runtime supplies its own
 * `() => import('xlsx')`. All the sheet→matrix logic stays here in `parse.ts`, so
 * the per-runtime shim is a single line and cannot drift.
 */

/** The slice of the `xlsx` API `parseXls` actually calls. */
export interface XlsxModule {
  read(
    data: Uint8Array,
    opts: { type: 'array'; cellDates: boolean }
  ): { SheetNames: string[]; Sheets: Record<string, unknown> };
  utils: {
    sheet_to_json(sheet: never, opts: { header: 1; blankrows: false; defval: string }): unknown[];
  };
}

/** Lazily produce the reader, so a runtime only pays for it on an .xls upload. */
export type XlsxLoader = () => Promise<XlsxModule>;

/** Optional capabilities handed to `BankAdapter.parse`. */
export interface ParseDeps {
  xlsx?: XlsxLoader;
}
