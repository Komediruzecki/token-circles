/**
 * A statement the setup wizard could not import by itself, handed to the Import page.
 *
 * The wizard's first import reads the banks it knows and nothing else. Any other file gets a way
 * out instead of a dead end: setup finishes and the Import page opens with that file on the tab
 * that can read it. Bank Imports for a bank the app knows whose file still did not read, File
 * Upload for any other table, where the person matches its columns.
 */
import { createRoot, createSignal } from 'solid-js'
import type { ImportTab } from './importFlow'

export interface HandedImportFile {
  file: File
  tab: Extract<ImportTab, 'bank-imports' | 'file-upload'>
}

const handoff = createRoot(() => createSignal<HandedImportFile | null>(null))

/** The file waiting for the Import page, if any. */
export const handedImportFile = handoff[0]

/** Give the Import page `file`, to open on `tab` the next time it shows. */
export function handFileToImport(file: File, tab: HandedImportFile['tab']): void {
  handoff[1]({ file, tab })
}

/** Take the waiting file: once, by the page that opens it. */
export function takeHandedImportFile(): HandedImportFile | null {
  const handed = handoff[0]()
  handoff[1](null)
  return handed
}
