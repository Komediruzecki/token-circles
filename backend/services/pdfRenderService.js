/**
 * PDF Render Service — wraps Puppeteer for server-side PDF generation.
 * Reuses a single browser instance to avoid launching Chromium per-request.
 */

let _browser = null
let _booting = null

function launchOptions() {
  return {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  }
}

async function getBrowser() {
  if (_browser && _browser.isConnected()) return _browser
  if (_booting) return _booting
  const puppeteer = require('puppeteer')
  _booting = puppeteer.launch(launchOptions())
  _browser = await _booting
  _booting = null
  return _browser
}

/**
 * Render an HTML export page to a PDF buffer using headless Chromium.
 * @param {object} exportData — data injected as window.__DATA__
 * @param {object} options
 * @param {string} options.pagePath — path to load, e.g. '/export-monthly.html'
 * @param {number} options.basePort — server port for self-referencing URL
 * @param {object} [options.viewport] — { width, height, deviceScaleFactor }
 * @param {object} [options.pdfMargin] — { top, right, bottom, left } in px
 * @returns {Buffer|null} PDF buffer, or null on failure
 */
async function renderToPdf(exportData, options) {
  try {
    const browser = await getBrowser()
    const exportPage = await browser.newPage()

    try {
      await exportPage.setViewport(
        options.viewport || { width: 800, height: 1000, deviceScaleFactor: 2 }
      )

      await exportPage.evaluateOnNewDocument((data) => {
        window.__DATA__ = data
      }, exportData)

      const baseUrl = `http://localhost:${options.basePort}`
      await exportPage.goto(`${baseUrl}${options.pagePath}`, {
        waitUntil: 'networkidle0',
        timeout: 30000,
      })

      await exportPage.waitForFunction(() => window.__RENDER_DONE__ === true, {
        timeout: 30000,
      })

      return Buffer.from(
        await exportPage.pdf({
          format: 'A4',
          printBackground: true,
          margin: options.pdfMargin || {
            top: '15px',
            right: '15px',
            bottom: '15px',
            left: '15px',
          },
        })
      )
    } finally {
      await exportPage.close()
    }
  } catch (err) {
    console.error('Puppeteer render failed:', err.message)
    return null
  }
}

module.exports = { renderToPdf }
