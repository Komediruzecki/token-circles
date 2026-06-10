#!/usr/bin/env node
/**
 * Test script to verify PDF export renders charts correctly.
 * Injects sample data into export.html and export-monthly.html,
 * verifies Chart.js renders canvases with content, and generates PDFs.
 */

const http = require('http')
const puppeteer = require('/var/www/finance-manager.clodhost.com/backend/node_modules/puppeteer')

const BASE_URL = 'http://localhost:3847'

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => resolve({ status: res.statusCode, data: Buffer.concat(chunks) }))
      res.on('error', reject)
    }).on('error', reject)
  })
}

function buildSampleAnnualData() {
  const categories = [
    { name: 'Housing', color: '#ef4444', total: 14400 },
    { name: 'Food', color: '#f97316', total: 8400 },
    { name: 'Transport', color: '#eab308', total: 4200 },
    { name: 'Utilities', color: '#22c55e', total: 3600 },
    { name: 'Entertainment', color: '#3b82f6', total: 3000 },
    { name: 'Healthcare', color: '#8b5cf6', total: 2400 },
    { name: 'Shopping', color: '#ec4899', total: 1800 },
    { name: 'Other', color: '#6b7280', total: 1200 },
  ]

  const monthly = []
  let running = 0
  const cashFlow = []
  for (let m = 1; m <= 12; m++) {
    const income = 5000 + Math.round(Math.sin(m * 0.5) * 1000)
    const expense = 3000 + Math.round(Math.cos(m * 0.7) * 800)
    const net = income - expense
    running += net
    monthly.push({ month: `2025-${String(m).padStart(2, '0')}`, income, expense })
    cashFlow.push({ month: `2025-${String(m).padStart(2, '0')}`, cumulative: running })
  }

  const totalIncome = monthly.reduce((s, m) => s + m.income, 0)
  const totalExpense = monthly.reduce((s, m) => s + m.expense, 0)
  const netSavings = totalIncome - totalExpense
  const savingsRate = Math.round((netSavings / totalIncome) * 100)

  return {
    year: 2025,
    currency: 'EUR',
    summary: { totalIncome, totalExpense, netSavings, savingsRate },
    byCategory: categories,
    monthly,
    cashFlow,
  }
}

function buildSampleMonthlyData() {
  const incomeCategories = [
    { name: 'Salary', color: '#059669', total: 5000 },
    { name: 'Freelance', color: '#22c55e', total: 200 },
  ]
  const expenseCategories = [
    { name: 'Housing', color: '#ef4444', total: 1200 },
    { name: 'Food', color: '#f97316', total: 700 },
    { name: 'Transport', color: '#eab308', total: 350 },
    { name: 'Utilities', color: '#22c55e', total: 300 },
    { name: 'Entertainment', color: '#3b82f6', total: 250 },
    { name: 'Other', color: '#6b7280', total: 200 },
  ]

  return {
    yearMonth: '2025-12',
    currency: 'EUR',
    summary: { totalIncome: 5200, totalExpense: 3000, netSavings: 2200 },
    incomeByCategory: incomeCategories,
    expenseByCategory: expenseCategories,
  }
}

async function testExportPage(pageUrl, sampleData, label) {
  console.log(`\n=== Testing ${label} ===`)

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  })

  try {
    const exportPage = await browser.newPage()
    await exportPage.setViewport({ width: 900, height: 1200, deviceScaleFactor: 1 })

    // Inject data before navigation (matching backend behavior)
    await exportPage.evaluateOnNewDocument((data) => {
      window.__DATA__ = data
    }, sampleData)

    // Navigate to the export page
    console.log(`  Navigating to ${BASE_URL}${pageUrl}...`)
    await exportPage.goto(`${BASE_URL}${pageUrl}`, {
      waitUntil: 'networkidle0',
      timeout: 30000,
    })

    // Check if Chart.js loaded
    const chartJsLoaded = await exportPage.evaluate(() => typeof Chart !== 'undefined')
    console.log(`  Chart.js loaded: ${chartJsLoaded}`)
    if (!chartJsLoaded) {
      console.log('  FAIL: Chart.js not loaded')
      return false
    }

    // Check if data was injected
    const dataInjected = await exportPage.evaluate(() => !!window.__DATA__)
    console.log(`  Data injected: ${dataInjected}`)

    // Wait for render to complete
    try {
      await exportPage.waitForFunction(() => window.__RENDER_DONE__ === true, { timeout: 15000 })
      console.log(`  Render completed`)
    } catch (e) {
      console.log(`  WARN: Render timeout, continuing anyway`)
    }

    // Count canvas elements and check if they have content
    const canvasInfo = await exportPage.evaluate(() => {
      const canvases = document.querySelectorAll('canvas')
      const results = []
      canvases.forEach((canvas) => {
        const ctx = canvas.getContext('2d')
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
        let nonEmpty = 0
        for (let i = 0; i < imageData.data.length; i += 4) {
          if (imageData.data[i + 3] > 0) nonEmpty++
        }
        results.push({
          id: canvas.id || 'unnamed',
          width: canvas.width,
          height: canvas.height,
          hasContent: nonEmpty > 100,
          nonEmptyPixels: nonEmpty,
        })
      })
      return results
    })

    console.log(`  Canvas elements: ${canvasInfo.length}`)
    let allChartsRendered = true
    canvasInfo.forEach((c) => {
      const status = c.hasContent ? 'OK' : 'EMPTY'
      if (!c.hasContent) allChartsRendered = false
      console.log(`    ${c.id}: ${c.width}x${c.height} - ${status} (${c.nonEmptyPixels} drawn pixels)`)
    })

    // Generate PDF to verify it works
    const pdfBuffer = await exportPage.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '20px', right: '20px', bottom: '20px', left: '20px' },
    })
    console.log(`  PDF generated: ${pdfBuffer.length} bytes`)
    console.log(`  PDF valid: ${pdfBuffer.length > 10000 ? 'YES' : 'NO (too small, likely text-only fallback)'}`)

    if (allChartsRendered && pdfBuffer.length > 10000) {
      console.log(`  PASS: ${label} - charts rendered, PDF generated successfully`)
      return true
    } else {
      console.log(`  FAIL: ${label} - charts did not render or PDF too small`)
      return false
    }
  } finally {
    await browser.close()
  }
}

async function testLivePdfEndpoint(endpoint, label) {
  console.log(`\n=== Testing Live ${label} ===`)

  // Call the actual backend PDF endpoint
  const resp = await fetchJSON(`${BASE_URL}${endpoint}`)
  if (resp.status !== 200) {
    console.log(`  FAIL: Endpoint returned ${resp.status}`)
    return false
  }

  const size = resp.data.length
  const isPdf = resp.data.slice(0, 5).toString() === '%PDF-'
  console.log(`  Response size: ${size} bytes`)
  console.log(`  Is PDF: ${isPdf}`)
  console.log(`  PDF valid: ${size > 10000 ? 'YES (charts likely rendered)' : 'NO (too small, likely text-only)'}`)

  if (isPdf && size > 10000) {
    console.log(`  PASS: ${label} - live endpoint returned valid PDF with content`)
    return true
  } else {
    console.log(`  FAIL: ${label} - live endpoint returned invalid or empty PDF`)
    return false
  }
}

async function main() {
  console.log('PDF Export Test Suite')
  console.log('====================')

  // Check if backend is running
  try {
    const health = await fetchJSON(`${BASE_URL}/api/health`)
    if (health.status !== 200) {
      console.error('Backend not running! Start it with: systemctl start finance-manager.service')
      process.exit(1)
    }
    console.log('Backend is running')
  } catch (e) {
    console.error('Backend not reachable! Start it first.')
    process.exit(1)
  }

  let allPassed = true

  // Test 1: Direct HTML rendering with sample data (annual)
  const annualResult = await testExportPage(
    '/export.html',
    buildSampleAnnualData(),
    'Annual Export HTML (sample data)'
  )
  if (!annualResult) allPassed = false

  // Test 2: Direct HTML rendering with sample data (monthly)
  const monthlyResult = await testExportPage(
    '/export-monthly.html',
    buildSampleMonthlyData(),
    'Monthly Export HTML (sample data)'
  )
  if (!monthlyResult) allPassed = false

  // Test 3: Live PDF endpoint (annual)
  const liveAnnualResult = await testLivePdfEndpoint(
    '/api/reports/annual-pdf?year=2025',
    'Annual PDF Endpoint (2025)'
  )
  if (!liveAnnualResult) allPassed = false

  // Test 4: Live PDF endpoint (monthly)
  const liveMonthlyResult = await testLivePdfEndpoint(
    '/api/reports/monthly-pdf?year=2025&month=12',
    'Monthly PDF Endpoint (Dec 2025)'
  )
  if (!liveMonthlyResult) allPassed = false

  console.log('\n====================')
  console.log(allPassed ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED')
  process.exit(allPassed ? 0 : 1)
}

main().catch((err) => {
  console.error('Test failed:', err)
  process.exit(1)
})
