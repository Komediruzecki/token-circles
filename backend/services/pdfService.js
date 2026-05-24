/**
 * PDF Service — wraps pdfkit for PDF generation.
 * Lazy-loaded so pdfkit is only required when actually generating a PDF.
 */

function createDocument(options = {}) {
  const PDFDocument = require('pdfkit')
  return new PDFDocument({
    size: 'A4',
    margin: 50,
    ...options,
  })
}

module.exports = { createDocument }
