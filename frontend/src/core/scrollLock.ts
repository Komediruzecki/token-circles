/**
 * Hold the document still while a full-screen layer covers it.
 *
 * The document is this app's scroller: <body> grows with the page, and a fixed layer on top of it
 * does not stop a wheel or a finger moving on that layer from scrolling the page underneath. On an
 * iPhone that scroll also collapses Safari's toolbars, and the page shows in the gap.
 *
 * `overflow: hidden` on <html> stops the user's scrolling and keeps `scrollY` where it was, so
 * releasing the lock leaves the page at the same place. iOS Safari honours it on the root since
 * iOS 16.
 *
 * Returns the release, which puts back whatever inline overflow <html> had before.
 */
export function lockDocumentScroll(): () => void {
  const root = document.documentElement
  const before = root.style.overflow
  root.style.overflow = 'hidden'
  return () => {
    root.style.overflow = before
  }
}
