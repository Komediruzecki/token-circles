/**
 * Every dialog laid over the app says so: role="dialog" or "alertdialog", and aria-modal="true"
 * while it is open.
 *
 * aria-modal is the one signal a phone's toasts read (Toast.module.css). With no dialog open they
 * stand above the quick add button; with one open they show at the top, because the bottom of the
 * screen is the dialog's own: the quick add sheet's keypad and Add button, a form's last fields.
 * A dialog without it had a toast lie over those for 5 to 10 s, and a tap meant for "0" landed on
 * the toast (PR #695 review). It is also what keeps a screen reader inside the dialog.
 *
 * Read from the source: an overlay that a dialog sits on is a `styles.overlay` or
 * `styles.modalOverlay` class, or a fixed inline layer over the whole screen, and between it and
 * the dialog's heading there must be an aria-modal. A dialog that stays in the page while closed
 * carries it only while open; menu-button-clearance.spec.ts checks a page at rest holds none.
 */
/* eslint-disable security/detect-non-literal-fs-filename -- every path is walked from the repo's
   own source folder, not supplied by anything outside this file. */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(import.meta.dirname, '..')

function sources(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      if (name === '__tests__' || name === 'node_modules') continue
      out.push(...sources(path))
    } else if (/\.tsx$/.test(name) && !/\.test\.tsx$/.test(name)) {
      out.push(path)
    }
  }
  return out
}

/** Where an overlay starts: a class named for one, or a fixed layer over the whole screen. */
const OVERLAY = /\b\w*[sS]tyles\.(?:overlay|modalOverlay)\b|position: 'fixed',\s*inset: 0,/g

/** The dialog's heading, or 2500 characters on, whichever comes first. */
const HEADING = /<h[1-4]\b|class=\{styles\.(?:modalTitle|title)\}/

/** Overlays that are not a dialog of their own, by file. */
const NOT_A_DIALOG: Record<string, string> = {
  'components/Spotlight.tsx': 'the guided tour, which points at the page rather than covering it',
  'components/Dashboard/PeriodNavigator.tsx': 'a month and year menu under the navigator',
  'components/ResetPassword.tsx': 'a screen of its own, shown in place of the app',
  'components/ErrorBoundary.tsx': 'the screen shown when the app fails',
  // Imported nowhere; Transactions renders components/BulkActionBar.tsx.
  'components/BulkActions/BulkCategoryModal.tsx': 'not rendered anywhere',
  'components/BulkActions/BulkTypeModal.tsx': 'not rendered anywhere',
  // #694 makes it a dialog, named by its heading; this branch leaves the file to that merge.
  'components/TourSelectionModal.tsx': 'made a modal dialog by #694',
}

function dialogsWithoutAriaModal(): string[] {
  const missing: string[] = []
  for (const path of sources(SRC)) {
    const file = relative(SRC, path)
    if (file in NOT_A_DIALOG) continue
    const text = readFileSync(path, 'utf8')
    for (const match of text.matchAll(OVERLAY)) {
      const rest = text.slice(match.index, match.index + 2500)
      const heading = rest.slice(1).search(HEADING)
      const upToHeading = heading === -1 ? rest : rest.slice(0, heading + 1)
      if (!/\baria-modal=/.test(upToHeading) || !/\brole="(?:alert)?dialog"/.test(upToHeading)) {
        const line = text.slice(0, match.index).split('\n').length
        missing.push(`${file}:${line}`)
      }
    }
  }
  return missing
}

describe('dialogs over the app', () => {
  it('say they are modal dialogs', () => {
    expect(dialogsWithoutAriaModal()).toEqual([])
  })

  it('finds the overlays it reads, so an empty list means something', () => {
    let overlays = 0
    for (const path of sources(SRC)) {
      overlays += [...readFileSync(path, 'utf8').matchAll(OVERLAY)].length
    }
    // 44 on 4 Nov 2026, the ones in the files above among them.
    expect(overlays).toBeGreaterThanOrEqual(35)
  })
})
