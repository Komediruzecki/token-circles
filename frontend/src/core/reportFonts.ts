/**
 * Fonts for the generated PDF reports.
 *
 * The reports embed Inter (body) + Fraunces (display titles) so exported PDFs
 * match the in-app "Orbital Observatory" typography instead of jsPDF's default
 * Helvetica. The same Inter files are loaded into the chart worker's
 * OffscreenCanvas (chartWorker.ts) so chart labels render in Inter too.
 *
 * The .ttf files are bundled as URL assets — Vite emits them as separate,
 * lazily-fetched files, so they never bloat the main JS chunk and only load
 * when a report is generated. jsPDF can embed TTF but not woff2, which is why
 * static per-weight TTFs are vendored under src/assets/fonts.
 */
import frauncesSemiBoldUrl from '../assets/fonts/Fraunces-SemiBold.ttf?url'
import interRegularUrl from '../assets/fonts/Inter-Regular.ttf?url'
import interSemiBoldUrl from '../assets/fonts/Inter-SemiBold.ttf?url'
import type { jsPDF } from 'jspdf'

/** Asset URLs, shared with the chart worker (which FontFace-loads Inter). */
export const FONT_URLS = {
  interRegular: interRegularUrl,
  interSemiBold: interSemiBoldUrl,
  frauncesSemiBold: frauncesSemiBoldUrl,
} as const

/** jsPDF family names registered by ensurePdfFonts(). */
export const PDF_FONT = { body: 'Inter', display: 'Fraunces' } as const

// base64 of each TTF, fetched once and reused across every generated document.
let _base64: Promise<{
  interRegular: string
  interSemiBold: string
  frauncesSemiBold: string
}> | null = null

async function fetchBase64(url: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`font fetch failed: ${url} (${res.status})`)
  const buf = new Uint8Array(await res.arrayBuffer())
  // btoa needs a binary string; chunk it so a ~330 KB font doesn't blow the
  // argument-count limit of String.fromCharCode(...).
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < buf.length; i += CHUNK) {
    binary += String.fromCharCode(...buf.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

function loadAll() {
  if (!_base64) {
    _base64 = Promise.all([
      fetchBase64(interRegularUrl),
      fetchBase64(interSemiBoldUrl),
      fetchBase64(frauncesSemiBoldUrl),
    ]).then(([interRegular, interSemiBold, frauncesSemiBold]) => ({
      interRegular,
      interSemiBold,
      frauncesSemiBold,
    }))
  }
  return _base64
}

/**
 * Register Inter (normal + bold) and Fraunces into a jsPDF document. Call once
 * per doc, then doc.setFont('Inter' | 'Fraunces', 'normal' | 'bold'). Resolves
 * even if the fonts fail to load — callers fall back to the built-in Helvetica.
 * @returns true when the brand fonts are available on the document.
 */
export async function ensurePdfFonts(doc: jsPDF): Promise<boolean> {
  try {
    const b = await loadAll()
    doc.addFileToVFS('Inter-Regular.ttf', b.interRegular)
    doc.addFont('Inter-Regular.ttf', PDF_FONT.body, 'normal')
    doc.addFileToVFS('Inter-SemiBold.ttf', b.interSemiBold)
    doc.addFont('Inter-SemiBold.ttf', PDF_FONT.body, 'bold')
    doc.addFileToVFS('Fraunces-SemiBold.ttf', b.frauncesSemiBold)
    doc.addFont('Fraunces-SemiBold.ttf', PDF_FONT.display, 'normal')
    return true
  } catch {
    return false
  }
}
