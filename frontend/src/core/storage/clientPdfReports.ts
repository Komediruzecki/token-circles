/**
 * Client-side PDF Report Generation
 * Uses jsPDF + Chart.js offscreen canvas (via Web Worker) to generate reports.
 */
import { getLocalCurrency } from '../../core/api'
import { txBaseValue } from '../../core/currency'
import { getDB } from './idb'
import type { ChartData } from 'chart.js'
import type { jsPDF } from 'jspdf'
import type { Category, Transaction } from '../../types/models'

// ── Helpers ─────────────────────────────────────────────────────────────────

function getProfileId(): number {
  const stored = localStorage.getItem('currentProfileId')
  return stored ? parseInt(stored, 10) : 1
}

/**
 * Load the raw rows a report needs. Serverless mode reads IndexedDB directly;
 * self-hosted mode fetches from the HTTP API — the worker cannot run Chart.js/
 * canvas, so the rich (charted) PDFs are always composed client-side and only
 * the DATA comes from the server. Dynamic imports avoid a static module cycle
 * (apiFetch → localApiRouter → handlers/reports → this file).
 */
async function loadReportSource(
  dateFrom: string,
  dateTo: string
): Promise<{ txns: Transaction[]; cats: Category[] }> {
  const { getStorageMode } = await import('./storageFactory')
  if (getStorageMode() === 'self-hosted') {
    const { apiFetch } = await import('../apiFetch')
    const headers: Record<string, string> = {}
    const pid = localStorage.getItem('currentProfileId')
    if (pid) headers['X-Profile-Id'] = pid
    try {
      const sel = JSON.parse(localStorage.getItem('selectedProfileIds') || '[]') as unknown
      if (Array.isArray(sel) && sel.length > 1) headers['X-Profile-Ids'] = JSON.stringify(sel)
    } catch {
      // single-profile header only
    }
    const [txRes, catRes] = await Promise.all([
      apiFetch(`/api/transactions?startDate=${dateFrom}&endDate=${dateTo}&limit=100000`, {
        credentials: 'include',
        headers,
      }),
      apiFetch('/api/categories', { credentials: 'include', headers }),
    ])
    if (!txRes.ok || !catRes.ok) throw new Error('Failed to load report data from the server')
    const txBody = (await txRes.json()) as { rows?: Transaction[] } | Transaction[]
    const txns = Array.isArray(txBody) ? txBody : (txBody.rows ?? [])
    const cats = (await catRes.json()) as Category[]
    return { txns, cats }
  }

  const db = await getDB()
  const pid = getProfileId()
  const txns = (
    (await db.getAllFromIndex('transactions', 'by_profile', pid)) as Transaction[]
  ).filter((t) => t.date >= dateFrom && t.date <= dateTo)
  const cats = (await db.getAllFromIndex('categories', 'by_profile', pid)) as Category[]
  return { txns, cats }
}

// Format a signed amount as the user's selected currency. Using Intl currency
// formatting picks the correct symbol and the currency's own fraction digits
// (e.g. JPY has 0, not a forced 2). Negatives render with a leading ASCII '-'.
function money(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: getLocalCurrency(),
  }).format(n)
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

const MONTHS_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

// ── Chart rendering via Web Worker ───────────────────────────────────────────

let _chartWorker: Worker | null = null
let _workerRequestId = 0

function getChartWorker(): Worker {
  if (!_chartWorker) {
    _chartWorker = new Worker(new URL('../../workers/chartWorker.ts', import.meta.url), {
      type: 'module',
    })
  }
  return _chartWorker
}

function renderChartViaWorker(
  chartType: 'doughnut' | 'bar' | 'line',
  chartData: ChartData,
  width: number,
  height: number,
  dark: boolean,
  timeoutMs = 15000
): Promise<string> {
  return new Promise((resolve, reject) => {
    const worker = getChartWorker()
    const id = ++_workerRequestId
    let settled = false

    const cleanup = () => {
      clearTimeout(timer)
      worker.removeEventListener('message', handler)
    }

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true
        cleanup()
        reject(new Error('Chart render timed out'))
      }
    }, timeoutMs)

    const handler = (e: MessageEvent) => {
      if (e.data.id !== id) return
      if (settled) return
      settled = true
      cleanup()

      if (e.data.error) {
        reject(new Error(e.data.error))
      } else if (e.data.blob) {
        const url = URL.createObjectURL(e.data.blob)
        resolve(url)
      } else {
        resolve('')
      }
    }

    worker.addEventListener('message', handler)
    worker.postMessage({ id, chartType, chartData, width, height, dark })
  })
}

// ── jsPDF helpers ────────────────────────────────────────────────────────────

function addTitle(doc: jsPDF, title: string, subtitle: string, dark: boolean) {
  const tc = dark ? '#E5E7EB' : '#1e293b'
  const sc = dark ? '#94a3b8' : '#64748b'
  doc.setTextColor(tc)
  doc.setFontSize(20)
  doc.text(title, doc.internal.pageSize.getWidth() / 2, 30, { align: 'center' })
  doc.setFontSize(11)
  doc.setTextColor(sc)
  doc.text(subtitle, doc.internal.pageSize.getWidth() / 2, 42, { align: 'center' })
  // Draw a separator line below the title
  doc.setDrawColor(dark ? 51 : 203, dark ? 65 : 213, dark ? 85 : 225)
  doc.line(15, 48, doc.internal.pageSize.getWidth() - 15, 48)
}

function addSummaryBox(
  doc: jsPDF,
  items: { label: string; value: string; color: [number, number, number] }[],
  y: number,
  dark: boolean,
  title?: string
): number {
  const pageW = doc.internal.pageSize.getWidth()
  const boxW = pageW - 30
  const colW = boxW / items.length
  const hasTitle = !!title
  const titleH = hasTitle ? 16 : 0
  const boxH = 32 + titleH
  const x = 15

  // Background
  doc.setFillColor(dark ? 30 : 241, dark ? 41 : 245, dark ? 59 : 249)
  doc.setDrawColor(dark ? 51 : 203, dark ? 65 : 213, dark ? 85 : 225)
  doc.roundedRect(x, y, boxW, boxH, 4, 4, 'FD')

  // Title
  if (hasTitle) {
    doc.setFontSize(12)
    doc.setTextColor(dark ? 226 : 30, dark ? 232 : 41, dark ? 240 : 59)
    doc.text(title.toUpperCase(), x + boxW / 2, y + 14, { align: 'center' })
  }

  items.forEach((item, i) => {
    const cx = x + i * colW
    const oy = titleH
    // Divider
    if (i > 0) {
      doc.setDrawColor(dark ? 51 : 203, dark ? 65 : 213, dark ? 85 : 225)
      doc.line(cx, y + oy + 4, cx, y + boxH - 4)
    }
    // Label
    doc.setFontSize(9)
    doc.setTextColor(dark ? 148 : 100, dark ? 163 : 116, dark ? 184 : 139)
    doc.text(item.label.toUpperCase(), cx + colW / 2, y + oy + 12, { align: 'center' })
    // Value
    doc.setFontSize(16)
    doc.setTextColor(item.color[0], item.color[1], item.color[2])
    doc.text(item.value, cx + colW / 2, y + oy + 26, { align: 'center' })
  })

  return y + boxH + 16
}

function addSectionTable(
  doc: jsPDF,
  title: string,
  columns: string[],
  colWidths: number[],
  rows: string[][],
  y: number,
  dark: boolean,
  color?: [number, number, number]
) {
  const pageW = doc.internal.pageSize.getWidth()
  const totalW = colWidths.reduce((s, w) => s + w, 0)
  const x = (pageW - totalW) / 2
  const boxW = totalW
  const rowH = 10
  const headerH = 10

  // Card background
  const totalH = (title ? 14 : 0) + headerH + rows.length * rowH + 6
  doc.setFillColor(dark ? 30 : 255, dark ? 41 : 255, dark ? 59 : 255)
  doc.setDrawColor(dark ? 51 : 203, dark ? 65 : 213, dark ? 85 : 225)
  doc.roundedRect(x, y, boxW, totalH, 3, 3, 'FD')

  // Section title
  if (title) {
    doc.setFontSize(13)
    doc.setTextColor(
      color?.[0] ?? (dark ? 226 : 30),
      color?.[1] ?? (dark ? 232 : 41),
      color?.[2] ?? (dark ? 240 : 59)
    )
    doc.text(title, x + 10, y + 10)
    y += 14
  }

  // Table header
  doc.setFillColor(dark ? 51 : 241, dark ? 65 : 245, dark ? 85 : 249)
  doc.rect(x + 1, y, boxW - 2, headerH, 'F')
  doc.setFontSize(9)
  doc.setTextColor(dark ? 148 : 71, dark ? 163 : 85, dark ? 184 : 95)
  let cx = x
  columns.forEach((col, i) => {
    const align: 'left' | 'right' = i === 0 ? 'left' : 'right'
    const padding = align === 'left' ? 8 : -8
    doc.text(
      col.toUpperCase(),
      cx + (align === 'left' ? padding : colWidths[i] + padding),
      y + 7.2,
      { align }
    )
    cx += colWidths[i]
  })
  y += headerH

  // Rows
  rows.forEach((row, ri) => {
    if (ri % 2 === 0) {
      doc.setFillColor(dark ? 26 : 248, dark ? 34 : 250, dark ? 50 : 252)
      doc.rect(x + 1, y, boxW - 2, rowH, 'F')
    }
    doc.setFontSize(9)
    let rx = x
    row.forEach((cell, ci) => {
      const align: 'left' | 'right' = ci === 0 ? 'left' : 'right'
      const padding = align === 'left' ? 8 : -8
      let tc: [number, number, number] = [dark ? 226 : 30, dark ? 232 : 41, dark ? 240 : 59]
      // Color money cells green (positive) / red (negative). A money cell is a value
      // column that isn't the '-' placeholder, a bare count, or a percentage — this
      // keeps the same columns colored as before while being currency-symbol agnostic
      // (Intl output for non-EUR currencies no longer starts with '€').
      const isMoney =
        ci > 0 && cell !== '-' && !cell.endsWith('%') && !/^\d+$/.test(cell) && /\d/.test(cell)
      if (isMoney && cell.trimStart().startsWith('-')) {
        tc = dark ? [248, 113, 113] : [220, 38, 38]
      } else if (isMoney) {
        tc = dark ? [16, 185, 129] : [5, 150, 105]
      }
      doc.setTextColor(tc[0], tc[1], tc[2])
      doc.text(cell, rx + (align === 'left' ? padding : colWidths[ci] + padding), y + 7, { align })
      rx += colWidths[ci]
    })
    y += rowH
  })

  return y + 6
}

// ── Monthly PDF ─────────────────────────────────────────────────────────────

export async function generateMonthlyPdf(month: string, dark: boolean): Promise<Blob> {
  const [y, m] = month.split('-').map(Number)
  // "-31" upper bound is safe for lexicographic YYYY-MM-DD compare in every month
  const { txns, cats } = await loadReportSource(`${month}-01`, `${month}-31`)
  const catMap = new Map(cats.map((c: Category) => [c.id, c]))

  const incomeByCat: Record<string, { name: string; color: string; total: number }> = {}
  const expenseByCat: Record<string, { name: string; color: string; total: number }> = {}
  let totalIncome = 0
  let totalExpense = 0

  for (const t of txns as Transaction[]) {
    const cat =
      t.category_id !== null && t.category_id !== undefined ? catMap.get(t.category_id)! : undefined
    const name = cat?.name || 'Uncategorized'
    const color = cat?.color || '#94a3b8'
    const amt = Math.abs(txBaseValue(t))
    if (t.type === 'income') {
      totalIncome += amt
      if (!incomeByCat[name]) incomeByCat[name] = { name, color, total: 0 }
      incomeByCat[name].total += amt
    } else {
      totalExpense += amt
      if (!expenseByCat[name]) expenseByCat[name] = { name, color, total: 0 }
      expenseByCat[name].total += amt
    }
  }

  const net = totalIncome - totalExpense
  const incomeSorted = Object.values(incomeByCat).sort((a, b) => b.total - a.total)
  const expenseSorted = Object.values(expenseByCat).sort((a, b) => b.total - a.total)

  // Render charts offscreen — 2x for retina sharpness
  const monthlyChartScale = 2
  const incomeChartUrl =
    incomeSorted.length > 0
      ? await renderChartViaWorker(
          'doughnut',
          {
            labels: incomeSorted.map((c) => c.name),
            datasets: [
              {
                data: incomeSorted.map((c) => c.total),
                backgroundColor: incomeSorted.map((c) => c.color),
                borderWidth: 0,
              },
            ],
          },
          275 * monthlyChartScale,
          165 * monthlyChartScale,
          dark
        )
      : ''

  const expenseChartUrl =
    expenseSorted.length > 0
      ? await renderChartViaWorker(
          'doughnut',
          {
            labels: expenseSorted.map((c) => c.name),
            datasets: [
              {
                data: expenseSorted.map((c) => c.total),
                backgroundColor: expenseSorted.map((c) => c.color),
                borderWidth: 0,
              },
            ],
          },
          275 * monthlyChartScale,
          165 * monthlyChartScale,
          dark
        )
      : ''

  // Build PDF
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'px', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  addTitle(doc, 'Monthly Financial Report', `${MONTHS[m - 1]} ${y}`, dark)

  let posY = addSummaryBox(
    doc,
    [
      { label: 'Total Income', value: money(totalIncome), color: [5, 150, 105] },
      { label: 'Total Expenses', value: money(totalExpense), color: [220, 38, 38] },
      {
        label: 'Net Savings',
        value: money(net),
        color: net >= 0 ? [5, 150, 105] : [220, 38, 38],
      },
    ],
    55,
    dark,
    'Monthly Summary'
  )

  // Charts row
  if (incomeChartUrl || expenseChartUrl) {
    const chartW = (pageW - 45) / 2
    const chartH = chartW * 0.6
    if (incomeChartUrl) {
      doc.addImage(incomeChartUrl, 'PNG', 15, posY, chartW, chartH)
      URL.revokeObjectURL(incomeChartUrl)
      doc.setFontSize(10)
      doc.setTextColor(dark ? 226 : 30, dark ? 232 : 41, dark ? 240 : 59)
      doc.text('Income by Category', 15 + chartW / 2, posY + chartH + 12, { align: 'center' })
    }
    if (expenseChartUrl) {
      doc.addImage(expenseChartUrl, 'PNG', 15 + chartW + 15, posY, chartW, chartH)
      URL.revokeObjectURL(expenseChartUrl)
      doc.setFontSize(10)
      doc.setTextColor(dark ? 226 : 30, dark ? 232 : 41, dark ? 240 : 59)
      doc.text('Expenses by Category', 15 + chartW + 15 + chartW / 2, posY + chartH + 12, {
        align: 'center',
      })
    }
    posY += chartH + 22
  }

  // Category breakdown table
  if (posY > 550) {
    doc.addPage()
    posY = 25
  }
  const allCats = new Map<string, { income: number; expense: number }>()
  for (const c of incomeSorted) allCats.set(c.name, { income: c.total, expense: 0 })
  for (const c of expenseSorted) {
    const e = allCats.get(c.name) || { income: 0, expense: 0 }
    e.expense = c.total
    allCats.set(c.name, e)
  }
  const categories = Array.from(allCats.entries())
    .filter(([, v]) => v.income > 0 || v.expense > 0)
    .sort(([, a], [, b]) => b.income + b.expense - (a.income + a.expense))

  if (categories.length > 0) {
    posY = addSectionTable(
      doc,
      'Category Breakdown',
      ['Category', 'Income', 'Expenses', 'Net'],
      [135, 90, 90, 90],
      categories.map(([name, v]) => {
        const net = v.income - v.expense
        return [
          name,
          v.income > 0 ? money(v.income) : '-',
          v.expense > 0 ? money(v.expense) : '-',
          money(net),
        ]
      }),
      posY + 4,
      dark
    )
  }

  // Footer
  const fc = dark ? '#64748b' : '#94a3b8'
  doc.setFontSize(8)
  doc.setTextColor(fc)
  doc.text(
    `Generated by Token Circles — ${new Date().toLocaleDateString()}`,
    pageW / 2,
    doc.internal.pageSize.getHeight() - 15,
    { align: 'center' }
  )

  return doc.output('blob')
}

// ── Annual PDF ──────────────────────────────────────────────────────────────

export async function generateAnnualPdf(year: number, dark: boolean): Promise<Blob> {
  const { txns, cats } = await loadReportSource(`${year}-01-01`, `${year}-12-31`)
  const catMap = new Map(cats.map((c: Category) => [c.id, c]))

  // Category breakdown
  const byCategory: Record<string, { name: string; color: string; total: number }> = {}
  const monthly: { month: string; income: number; expense: number }[] = []
  let totalIncome = 0
  let totalExpense = 0

  for (let m = 1; m <= 12; m++) {
    monthly.push({ month: MONTHS_SHORT[m - 1], income: 0, expense: 0 })
  }

  for (const t of txns as Transaction[]) {
    const cat =
      t.category_id !== null && t.category_id !== undefined ? catMap.get(t.category_id)! : undefined
    const name = cat?.name || 'Uncategorized'
    const color = cat?.color || '#94a3b8'
    const amt = Math.abs(txBaseValue(t))
    const moIdx = parseInt(t.date.substring(5, 7)) - 1
    if (t.type === 'income') {
      totalIncome += amt
      monthly[moIdx].income += amt
    } else {
      totalExpense += amt
      if (!byCategory[name]) byCategory[name] = { name, color, total: 0 }
      byCategory[name].total += amt
      monthly[moIdx].expense += amt
    }
  }

  const net = totalIncome - totalExpense
  const savingsRate = totalIncome > 0 ? (net / totalIncome) * 100 : 0
  const topCategories = Object.values(byCategory).sort((a, b) => b.total - a.total)
  const cashFlow = monthly.map((_, i) => {
    const cumulative = monthly.slice(0, i + 1).reduce((s, m) => s + m.income - m.expense, 0)
    return cumulative
  })

  // Build PDF
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'px', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()

  // Render charts — use 2x resolution for retina sharpness.
  // Display sizes are calculated first, then charts are rendered at 2x.
  const chartScale = 2

  // 2-column layout: doughnut + bar side by side, line full-width below
  const colChartW = (pageW - 45) / 2
  const colChartH = 170
  const doughnutDisplayW = colChartW
  const doughnutDisplayH = colChartH
  const doughnutUrl =
    topCategories.length > 0
      ? await renderChartViaWorker(
          'doughnut',
          {
            labels: topCategories.map((c) => c.name),
            datasets: [
              {
                data: topCategories.map((c) => c.total),
                backgroundColor: topCategories.map((c) => c.color),
                borderWidth: 0,
              },
            ],
          },
          doughnutDisplayW * chartScale,
          doughnutDisplayH * chartScale,
          dark
        )
      : ''

  const barDisplayW = colChartW
  const barDisplayH = colChartH
  const barUrl =
    monthly.length > 0
      ? await renderChartViaWorker(
          'bar',
          {
            labels: monthly.map((m) => m.month),
            datasets: [
              {
                label: 'Income',
                data: monthly.map((m) => m.income),
                backgroundColor: dark ? 'rgba(16,185,129,0.7)' : 'rgba(5,150,105,0.7)',
                borderColor: dark ? '#10b981' : '#059669',
                borderWidth: 1,
              },
              {
                label: 'Expenses',
                data: monthly.map((m) => m.expense),
                backgroundColor: dark ? 'rgba(248,113,113,0.7)' : 'rgba(220,38,38,0.7)',
                borderColor: dark ? '#f87171' : '#dc2626',
                borderWidth: 1,
              },
            ],
          },
          barDisplayW * chartScale,
          barDisplayH * chartScale,
          dark
        )
      : ''

  const lineDisplayW = pageW - 30
  const lineDisplayH = 120
  const lineUrl =
    cashFlow.length > 0
      ? await renderChartViaWorker(
          'line',
          {
            labels: monthly.map((m) => m.month),
            datasets: [
              {
                label: 'Cash Flow',
                data: cashFlow,
                borderColor: '#3B82F6',
                backgroundColor: 'rgba(59,130,246,0.1)',
                fill: true,
                tension: 0.3,
                pointRadius: 2,
              },
            ],
          },
          lineDisplayW * chartScale,
          lineDisplayH * chartScale,
          dark
        )
      : ''

  addTitle(
    doc,
    `Annual Financial Report — ${year}`,
    `Token Circles | Generated: ${new Date().toLocaleDateString()}`,
    dark
  )

  let posY = addSummaryBox(
    doc,
    [
      { label: 'Total Income', value: money(totalIncome), color: [5, 150, 105] },
      { label: 'Total Expenses', value: money(totalExpense), color: [220, 38, 38] },
      {
        label: 'Net Savings',
        value: money(net),
        color: net >= 0 ? [5, 150, 105] : [220, 38, 38],
      },
      {
        label: 'Savings Rate',
        value: `${savingsRate.toFixed(1)}%`,
        color: savingsRate >= 0 ? [5, 150, 105] : [220, 38, 38],
      },
    ],
    52,
    dark,
    'Annual Summary'
  )

  // Charts: 2-column grid (doughnut + bar side by side), then line full-width
  if (doughnutUrl || barUrl) {
    const chartLabelY = posY + colChartH + 12
    if (doughnutUrl) {
      doc.addImage(doughnutUrl, 'PNG', 15, posY, doughnutDisplayW, doughnutDisplayH)
      doc.setFontSize(10)
      doc.setTextColor(dark ? 226 : 30, dark ? 232 : 41, dark ? 240 : 59)
      doc.text('Spending by Category', 15 + doughnutDisplayW / 2, chartLabelY, { align: 'center' })
    }
    if (barUrl) {
      const barX = 15 + colChartW + 15
      doc.addImage(barUrl, 'PNG', barX, posY, barDisplayW, barDisplayH)
      doc.setFontSize(10)
      doc.setTextColor(dark ? 226 : 30, dark ? 232 : 41, dark ? 240 : 59)
      doc.text('Monthly Income vs Expenses', barX + barDisplayW / 2, chartLabelY, {
        align: 'center',
      })
    }
    posY += colChartH + 28
  }

  // Cash flow line chart (full-width)
  if (lineUrl && cashFlow.length > 0) {
    if (posY + lineDisplayH + 22 > pageH - 25) {
      doc.addPage()
      posY = 25
    }
    doc.addImage(lineUrl, 'PNG', 15, posY, lineDisplayW, lineDisplayH)
    doc.setFontSize(10)
    doc.setTextColor(dark ? 226 : 30, dark ? 232 : 41, dark ? 240 : 59)
    doc.text('Cumulative Cash Flow', pageW / 2, posY + lineDisplayH + 12, { align: 'center' })
    posY += lineDisplayH + 22
  }

  // Footer on first page
  const fc = dark ? '#64748b' : '#94a3b8'
  doc.setFontSize(8)
  doc.setTextColor(fc)
  doc.text(
    `Generated by Token Circles — ${new Date().toLocaleDateString()}`,
    pageW / 2,
    doc.internal.pageSize.getHeight() - 15,
    { align: 'center' }
  )

  // Monthly breakdown table on page 2
  doc.addPage()
  posY = 25
  addSectionTable(
    doc,
    'Monthly Breakdown',
    ['Month', 'Income', 'Expenses', 'Net', 'Running Balance'],
    [65, 90, 90, 90, 100],
    monthly.map((m, i) => {
      const n = m.income - m.expense
      const running = monthly.slice(0, i + 1).reduce((s, x) => s + x.income - x.expense, 0)
      return [MONTHS[i], money(m.income), money(m.expense), money(n), money(running)]
    }),
    posY,
    dark
  )

  // Footer on page 2
  doc.setFontSize(8)
  doc.setTextColor(fc)
  doc.text(
    `Generated by Token Circles — ${new Date().toLocaleDateString()}`,
    pageW / 2,
    doc.internal.pageSize.getHeight() - 15,
    { align: 'center' }
  )

  return doc.output('blob')
}

// ── Tax Summary PDF ─────────────────────────────────────────────────────────

export async function generateTaxSummaryPdf(year: number, dark: boolean): Promise<Blob> {
  const source = await loadReportSource(`${year}-01-01`, `${year}-12-31`)
  const txns = source.txns.filter((t) => t.type === 'expense')
  const cats = source.cats
  const catMap = new Map(cats.map((c: Category) => [c.id, c]))

  const taxMap: Record<string, { count: number; total: number }> = {}
  const nonMap: Record<string, { count: number; total: number }> = {}

  for (const t of txns as Transaction[]) {
    const cat =
      t.category_id !== null && t.category_id !== undefined ? catMap.get(t.category_id)! : undefined
    const name = cat?.name || 'Uncategorized'
    const amt = Math.abs(txBaseValue(t))
    if (cat?.tax_deductible) {
      if (!taxMap[name]) taxMap[name] = { count: 0, total: 0 }
      taxMap[name].count++
      taxMap[name].total += amt
    } else {
      if (!nonMap[name]) nonMap[name] = { count: 0, total: 0 }
      nonMap[name].count++
      nonMap[name].total += amt
    }
  }

  const taxDeductible = Object.entries(taxMap)
    .map(([catName, v]) => ({ catName, count: v.count, total: v.total }))
    .sort((a, b) => b.total - a.total)
  const nonDeductible = Object.entries(nonMap)
    .map(([catName, v]) => ({ catName, count: v.count, total: v.total }))
    .sort((a, b) => b.total - a.total)

  const taxTotal = taxDeductible.reduce((s, r) => s + r.total, 0)
  const nonTotal = nonDeductible.reduce((s, r) => s + r.total, 0)
  const totalExp = taxTotal + nonTotal

  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'px', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()

  addTitle(doc, `Year-End Tax Summary — ${year}`, new Date().toLocaleDateString(), dark)

  const taxPct = totalExp > 0 ? ((taxTotal / totalExp) * 100).toFixed(1) : '0.0'
  let posY = addSummaryBox(
    doc,
    [
      { label: 'Tax-Deductible', value: `${money(taxTotal)} (${taxPct}%)`, color: [5, 150, 105] },
      {
        label: 'Non-Deductible',
        value: money(nonTotal),
        color: (dark ? [148, 163, 184] : [100, 116, 139]) as [number, number, number],
      },
      {
        label: 'Total Expenses',
        value: money(totalExp),
        color: (dark ? [226, 232, 240] : [30, 41, 59]) as [number, number, number],
      },
    ],
    55,
    dark,
    'Tax Summary'
  )

  // Tax-deductible section
  if (taxDeductible.length > 0) {
    posY = addSectionTable(
      doc,
      'Tax-Deductible Expenses',
      ['Category', 'Transactions', 'Amount'],
      [160, 70, 90],
      taxDeductible.map((r) => [r.catName, String(r.count), money(r.total)]),
      posY,
      dark,
      [5, 150, 105]
    )
  }

  // Non-deductible section
  if (nonDeductible.length > 0) {
    if (posY > 500) {
      doc.addPage()
      posY = 25
    }
    posY = addSectionTable(
      doc,
      'Non-Deductible Expenses',
      ['Category', 'Transactions', 'Amount'],
      [160, 70, 90],
      nonDeductible.map((r) => [r.catName, String(r.count), money(r.total)]),
      posY + 6,
      dark,
      [220, 38, 38]
    )
  }

  // Disclaimer
  doc.setFontSize(8)
  doc.setTextColor(dark ? 148 : 100, dark ? 163 : 116, dark ? 184 : 139)
  doc.text(
    'This report is for informational purposes only. Consult a tax professional for official tax filing.',
    pageW / 2,
    doc.internal.pageSize.getHeight() - 25,
    { align: 'center' }
  )

  const fc = dark ? '#64748b' : '#94a3b8'
  doc.setFontSize(8)
  doc.setTextColor(fc)
  doc.text(
    `Generated by Token Circles — ${new Date().toLocaleDateString()}`,
    pageW / 2,
    doc.internal.pageSize.getHeight() - 15,
    { align: 'center' }
  )

  return doc.output('blob')
}

// ── P&L Summary PDF ─────────────────────────────────────────────────────────

export async function generatePlSummaryPdf(year: number, dark: boolean): Promise<Blob> {
  const { txns, cats } = await loadReportSource(`${year}-01-01`, `${year}-12-31`)
  const catMap = new Map(cats.map((c: Category) => [c.id, c]))

  const incomeMap: Record<string, { count: number; total: number }> = {}
  const expenseMap: Record<string, { count: number; total: number }> = {}
  let totalIncome = 0
  let totalExpense = 0

  for (const t of txns as Transaction[]) {
    const cat =
      t.category_id !== null && t.category_id !== undefined ? catMap.get(t.category_id)! : undefined
    const name = cat?.name || 'Uncategorized'
    const amt = Math.abs(txBaseValue(t))
    if (t.type === 'income') {
      totalIncome += amt
      if (!incomeMap[name]) incomeMap[name] = { count: 0, total: 0 }
      incomeMap[name].count++
      incomeMap[name].total += amt
    } else {
      totalExpense += amt
      if (!expenseMap[name]) expenseMap[name] = { count: 0, total: 0 }
      expenseMap[name].count++
      expenseMap[name].total += amt
    }
  }

  const net = totalIncome - totalExpense
  const savingsRate = totalIncome > 0 ? (net / totalIncome) * 100 : 0
  const incomeRows = Object.entries(incomeMap)
    .map(([name, v]) => ({
      name,
      count: v.count,
      total: v.total,
      pct: totalIncome > 0 ? (v.total / totalIncome) * 100 : 0,
    }))
    .sort((a, b) => b.total - a.total)
  const expenseRows = Object.entries(expenseMap)
    .map(([name, v]) => ({
      name,
      count: v.count,
      total: v.total,
      pct: totalExpense > 0 ? (v.total / totalExpense) * 100 : 0,
    }))
    .sort((a, b) => b.total - a.total)

  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'px', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()

  addTitle(
    doc,
    `Year-End P&L Summary — ${year}`,
    `Token Circles | ${new Date().toLocaleDateString()}`,
    dark
  )

  let posY = addSummaryBox(
    doc,
    [
      { label: 'Total Income', value: money(totalIncome), color: [5, 150, 105] },
      { label: 'Total Expenses', value: money(totalExpense), color: [220, 38, 38] },
      {
        label: 'Net Savings',
        value: money(net),
        color: net >= 0 ? [5, 150, 105] : [220, 38, 38],
      },
    ],
    55,
    dark,
    'P&L Summary'
  )

  doc.setFontSize(10)
  doc.setTextColor(dark ? 148 : 100, dark ? 163 : 116, dark ? 184 : 139)
  doc.text(`Savings Rate: ${savingsRate.toFixed(1)}%`, pageW / 2, posY, { align: 'center' })
  posY += 8

  // Income section
  if (incomeRows.length > 0) {
    posY = addSectionTable(
      doc,
      'Income',
      ['Category', 'Txns', 'Amount', '% of Total'],
      [150, 55, 95, 65],
      [
        ...incomeRows.map((r) => [r.name, String(r.count), money(r.total), `${r.pct.toFixed(1)}%`]),
        [
          'TOTAL',
          String(incomeRows.reduce((s, r) => s + r.count, 0)),
          money(totalIncome),
          '100.0%',
        ],
      ],
      posY + 4,
      dark,
      [5, 150, 105]
    )
  }

  // Expense section
  if (expenseRows.length > 0) {
    if (posY > 500) {
      doc.addPage()
      posY = 25
    }
    posY = addSectionTable(
      doc,
      'Expenses',
      ['Category', 'Txns', 'Amount', '% of Total'],
      [150, 55, 95, 65],
      [
        ...expenseRows.map((r) => [
          r.name,
          String(r.count),
          money(r.total),
          `${r.pct.toFixed(1)}%`,
        ]),
        [
          'TOTAL',
          String(expenseRows.reduce((s, r) => s + r.count, 0)),
          money(totalExpense),
          '100.0%',
        ],
      ],
      posY + 6,
      dark,
      [220, 38, 38]
    )
  }

  const txnCount =
    incomeRows.reduce((s, r) => s + r.count, 0) + expenseRows.reduce((s, r) => s + r.count, 0)
  const fc = dark ? '#64748b' : '#94a3b8'
  doc.setFontSize(8)
  doc.setTextColor(fc)
  doc.text(
    `Total: ${txnCount} transactions | Net Savings: ${money(net)} (${savingsRate.toFixed(1)}% savings rate)`,
    pageW / 2,
    doc.internal.pageSize.getHeight() - 15,
    { align: 'center' }
  )

  return doc.output('blob')
}
