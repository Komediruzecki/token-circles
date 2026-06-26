import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

// Worker-native PDF generation with pdf-lib (pure JS — no PDFKit/Puppeteer/Node).
// Enough for clean, structured financial reports: title, period, labeled value rows,
// and simple section tables. Returns the PDF bytes to stream back.

export interface PdfSection {
  heading?: string
  /** [label, value] pairs; value is right-aligned and bold. */
  rows: string[][]
}

export interface PdfReport {
  title: string
  subtitle?: string
  sections: PdfSection[]
}

const A4: [number, number] = [595.28, 841.89]

export async function buildReportPdf(report: PdfReport): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)

  const margin = 50
  const ink = rgb(0.1, 0.12, 0.15)
  const muted = rgb(0.45, 0.48, 0.52)
  const rule = rgb(0.85, 0.87, 0.9)

  let page = doc.addPage(A4)
  const pageWidth = page.getWidth()
  let y = page.getHeight() - margin

  const newPageIfNeeded = (need: number) => {
    if (y - need < margin) {
      page = doc.addPage(A4)
      y = page.getHeight() - margin
    }
  }
  const left = (s: string, size: number, f = font, color = ink) =>
    page.drawText(s, { x: margin, y, size, font: f, color })
  const right = (s: string, size: number, f = bold, color = ink) =>
    page.drawText(s, { x: pageWidth - margin - f.widthOfTextAtSize(s, size), y, size, font: f, color })

  left(report.title, 20, bold)
  y -= 26
  if (report.subtitle) {
    left(report.subtitle, 11, font, muted)
    y -= 20
  }
  page.drawLine({ start: { x: margin, y }, end: { x: pageWidth - margin, y }, thickness: 1, color: rule })
  y -= 24

  for (const section of report.sections) {
    newPageIfNeeded(40)
    if (section.heading) {
      left(section.heading, 13, bold)
      y -= 20
    }
    for (const [label, value] of section.rows) {
      newPageIfNeeded(18)
      left(label, 11, font, ink)
      right(value, 11, bold, ink)
      y -= 17
    }
    y -= 12
  }

  newPageIfNeeded(20)
  left(`Generated ${new Date().toISOString().slice(0, 10)}`, 8, font, muted)
  return doc.save()
}
