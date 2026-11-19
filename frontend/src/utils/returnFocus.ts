/**
 * Hands focus back to the element that had it before a dialog opened, once the dialog has shut.
 *
 * Only when focus is lost: still inside the shut dialog, or dropped to the page. Someone who has
 * already moved on is left where they are. With nothing to go back to (the opener left the page,
 * or was the page itself), focus at least leaves the shut dialog: a text field holding focus there
 * counts as typing (`isEditableTarget`), which holds back the shortcuts and the update reload.
 */
export function returnFocus(opener: Element | null, dialog: Element | undefined): void {
  const active = document.activeElement
  const lost = active === null || active === document.body || (dialog?.contains(active) ?? false)
  if (!lost) return
  if (opener instanceof HTMLElement && opener !== document.body && opener.isConnected)
    opener.focus()
  const now = document.activeElement
  if (now instanceof HTMLElement && dialog?.contains(now)) now.blur()
}
