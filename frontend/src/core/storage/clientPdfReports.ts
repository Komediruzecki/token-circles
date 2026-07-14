/**
 * Client-side PDF Report Generation
 * Uses jsPDF + Chart.js offscreen canvas (via Web Worker) to generate reports.
 */
import { getLocalCurrency } from '../../core/api'
import { moneyRgb, pdfReportTheme } from '../../core/brandPalette'
import { txBaseValue } from '../../core/currency'
import { ensurePdfFonts, PDF_FONT } from '../../core/reportFonts'
import { getDB } from './idb'
import {
  buildCashFlowLine,
  buildCategoryDoughnut,
  buildCategoryOrbitsSvg,
  buildIncomeExpenseBar,
  computeOrbitRings,
  DOUGHNUT_CUTOUT,
} from './reportCharts'
import type { ChartData } from 'chart.js'
import type { jsPDF } from 'jspdf'
import type { PdfReportTheme, RGB } from '../../core/brandPalette'
import type { Category, Transaction } from '../../types/models'
import type { CategoryDatum } from './reportCharts'

/**
 * Shared drawing context: the resolved orbit/dawn theme + the jsPDF font family
 * names (Inter/Fraunces when the brand fonts loaded, else Helvetica). Threaded
 * through the layout helpers so every report draws on the same brand system.
 */
interface ReportCtx {
  theme: PdfReportTheme
  /** Body family — PDF_FONT.body ('Inter') or 'helvetica'. */
  body: string
  /** Display/title family — PDF_FONT.display ('Fraunces') or 'helvetica'. */
  display: string
}

/** Build a doc, register brand fonts, paint the ground, and return the ctx. */
async function initReport(dark: boolean): Promise<{ doc: jsPDF; ctx: ReportCtx }> {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'px', format: 'a4' })
  const theme = pdfReportTheme(dark)
  const fontsOk = await ensurePdfFonts(doc)
  const ctx: ReportCtx = {
    theme,
    body: fontsOk ? PDF_FONT.body : 'helvetica',
    display: fontsOk ? PDF_FONT.display : 'helvetica',
  }
  paintPage(doc, theme)
  return { doc, ctx }
}

/** Fill the current page with the brand ground (deep night / paper blue). */
function paintPage(doc: jsPDF, theme: PdfReportTheme) {
  const w = doc.internal.pageSize.getWidth()
  const h = doc.internal.pageSize.getHeight()
  doc.setFillColor(...theme.rgb.bg)
  doc.rect(0, 0, w, h, 'F')
}

/** Add a page and repaint the ground. */
function addBrandPage(doc: jsPDF, theme: PdfReportTheme) {
  doc.addPage()
  paintPage(doc, theme)
}

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
  theme: PdfReportTheme,
  opts: { cutout?: string; timeoutMs?: number } = {}
): Promise<string> {
  const { cutout, timeoutMs = 15000 } = opts
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
    worker.postMessage({
      id,
      chartType,
      chartData,
      width,
      height,
      dark: theme.dark,
      grid: theme.grid,
      text: theme.textSecondary,
      cutout,
    })
  })
}

/**
 * Rasterize an SVG string to a PNG data URL on the main thread. The chart worker
 * can't decode SVG (no Image in that context), but clientPdfReports runs on the
 * main thread where document fonts + Image decoding exist — so the orbit-ring
 * hero is drawn here. Rejects on load failure so callers fall back to a chart.
 */
function rasterizeSvg(svg: string, displayW: number, displayH: number, scale = 2): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const svgUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(displayW * scale))
        canvas.height = Math.max(1, Math.round(displayH * scale))
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          reject(new Error('no 2d context'))
          return
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/png'))
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    }
    img.onerror = () => {
      reject(new Error('svg raster failed'))
    }
    img.src = svgUrl
  })
}

/**
 * A square PNG for the category orbit hero: the branded SVG rings when possible,
 * else the Chart.js doughnut fallback (worker). Returns '' when there's no data.
 * The total/label are NOT baked in — the caller overlays them with drawOrbitCore
 * so they render in embedded Inter (rasterized SVG can't see document fonts).
 */
async function orbitHeroImage(
  rows: CategoryDatum[],
  theme: PdfReportTheme,
  sizePx: number
): Promise<string> {
  if (!rows.some((r) => r.total > 0)) return ''
  const svg = buildCategoryOrbitsSvg(rows, { theme })
  if (svg) {
    try {
      return await rasterizeSvg(svg, sizePx, sizePx, 2)
    } catch {
      // fall back to the branded doughnut below
    }
  }
  return renderChartViaWorker(
    'doughnut',
    buildCategoryDoughnut(rows, theme),
    sizePx * 2,
    sizePx * 2,
    theme,
    { cutout: DOUGHNUT_CUTOUT }
  )
}

/** Draw the orbit core: total value (Inter bold) + caption, centered on (cx, cy). */
function drawOrbitCore(
  doc: jsPDF,
  ctx: ReportCtx,
  cx: number,
  cy: number,
  value: string,
  label: string
) {
  doc.setFont(ctx.body, 'bold')
  doc.setFontSize(12)
  doc.setTextColor(...ctx.theme.rgb.textPrimary)
  doc.text(value, cx, cy - 1, { align: 'center' })
  doc.setFont(ctx.body, 'normal')
  doc.setFontSize(6.5)
  doc.setTextColor(...ctx.theme.rgb.textSecondary)
  doc.text(label.toUpperCase(), cx, cy + 8, { align: 'center' })
}

/** A chart caption centered under an image (Inter, secondary text). */
function addChartCaption(doc: jsPDF, ctx: ReportCtx, text: string, cx: number, y: number) {
  doc.setFont(ctx.body, 'bold')
  doc.setFontSize(10)
  doc.setTextColor(...ctx.theme.rgb.textPrimary)
  doc.text(text, cx, y, { align: 'center' })
}

/** Footer line in Inter, brand secondary color. */
function addFooter(doc: jsPDF, ctx: ReportCtx) {
  doc.setFont(ctx.body, 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...ctx.theme.rgb.textSecondary)
  doc.text(
    `Generated by Token Circles — ${new Date().toLocaleDateString()}`,
    doc.internal.pageSize.getWidth() / 2,
    doc.internal.pageSize.getHeight() - 15,
    { align: 'center' }
  )
}

// ── jsPDF helpers ────────────────────────────────────────────────────────────

function addTitle(doc: jsPDF, ctx: ReportCtx, title: string, subtitle: string) {
  const { theme } = ctx
  const w = doc.internal.pageSize.getWidth()
  // Display title in Fraunces, subtitle in Inter — the app's type pairing.
  doc.setFont(ctx.display, 'normal')
  doc.setFontSize(20)
  doc.setTextColor(...theme.rgb.textPrimary)
  doc.text(title, w / 2, 30, { align: 'center' })
  doc.setFont(ctx.body, 'normal')
  doc.setFontSize(11)
  doc.setTextColor(...theme.rgb.textSecondary)
  doc.text(subtitle, w / 2, 42, { align: 'center' })
  // Hairline separator with a centered azure "instrument" accent.
  doc.setDrawColor(...theme.rgb.border)
  doc.setLineWidth(0.5)
  doc.line(15, 48, w - 15, 48)
  doc.setDrawColor(...theme.rgb.net)
  doc.setLineWidth(1.6)
  doc.line(w / 2 - 22, 48, w / 2 + 22, 48)
  doc.setLineWidth(0.4)
}

function addSummaryBox(
  doc: jsPDF,
  ctx: ReportCtx,
  items: { label: string; value: string; color: RGB }[],
  y: number,
  title?: string
): number {
  const { theme } = ctx
  const pageW = doc.internal.pageSize.getWidth()
  const boxW = pageW - 30
  const colW = boxW / items.length
  const hasTitle = !!title
  const titleH = hasTitle ? 16 : 0
  const boxH = 32 + titleH
  const x = 15

  // Panel on the ground
  doc.setFillColor(...theme.rgb.surface)
  doc.setDrawColor(...theme.rgb.border)
  doc.setLineWidth(0.4)
  doc.roundedRect(x, y, boxW, boxH, 4, 4, 'FD')

  // Title
  if (hasTitle) {
    doc.setFont(ctx.body, 'bold')
    doc.setFontSize(11)
    doc.setTextColor(...theme.rgb.textSecondary)
    doc.text(title.toUpperCase(), x + boxW / 2, y + 14, { align: 'center' })
  }

  items.forEach((item, i) => {
    const cx = x + i * colW
    const oy = titleH
    // Divider
    if (i > 0) {
      doc.setDrawColor(...theme.rgb.border)
      doc.line(cx, y + oy + 4, cx, y + boxH - 4)
    }
    // Label
    doc.setFont(ctx.body, 'normal')
    doc.setFontSize(9)
    doc.setTextColor(...theme.rgb.textSecondary)
    doc.text(item.label.toUpperCase(), cx + colW / 2, y + oy + 12, { align: 'center' })
    // Value
    doc.setFont(ctx.body, 'bold')
    doc.setFontSize(16)
    doc.setTextColor(item.color[0], item.color[1], item.color[2])
    doc.text(item.value, cx + colW / 2, y + oy + 26, { align: 'center' })
  })

  return y + boxH + 16
}

function addSectionTable(
  doc: jsPDF,
  ctx: ReportCtx,
  title: string,
  columns: string[],
  colWidths: number[],
  rows: string[][],
  y: number,
  color?: RGB
) {
  const { theme } = ctx
  const pageW = doc.internal.pageSize.getWidth()
  const totalW = colWidths.reduce((s, w) => s + w, 0)
  const x = (pageW - totalW) / 2
  const boxW = totalW
  const rowH = 10
  const headerH = 10

  // Card panel
  const totalH = (title ? 14 : 0) + headerH + rows.length * rowH + 6
  doc.setFillColor(...theme.rgb.surface)
  doc.setDrawColor(...theme.rgb.border)
  doc.setLineWidth(0.4)
  doc.roundedRect(x, y, boxW, totalH, 3, 3, 'FD')

  // Section title (accent color when provided, e.g. income green / expense red)
  if (title) {
    doc.setFont(ctx.body, 'bold')
    doc.setFontSize(13)
    doc.setTextColor(...(color ?? theme.rgb.textPrimary))
    doc.text(title, x + 10, y + 10)
    y += 14
  }

  // Table header band
  doc.setFillColor(...theme.rgb.surfaceElev)
  doc.rect(x + 1, y, boxW - 2, headerH, 'F')
  doc.setFont(ctx.body, 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...theme.rgb.textSecondary)
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
      doc.setFillColor(...theme.rgb.zebra)
      doc.rect(x + 1, y, boxW - 2, rowH, 'F')
    }
    doc.setFont(ctx.body, 'normal')
    doc.setFontSize(9)
    let rx = x
    row.forEach((cell, ci) => {
      const align: 'left' | 'right' = ci === 0 ? 'left' : 'right'
      const padding = align === 'left' ? 8 : -8
      let tc: RGB = theme.rgb.textPrimary
      // Color money cells income (positive) / expense (negative). A money cell is
      // a value column that isn't the '-' placeholder, a bare count, or a
      // percentage — currency-symbol agnostic (Intl output for non-EUR
      // currencies no longer starts with '€').
      const isMoney =
        ci > 0 && cell !== '-' && !cell.endsWith('%') && !/^\d+$/.test(cell) && /\d/.test(cell)
      if (isMoney && cell.trimStart().startsWith('-')) {
        tc = theme.rgb.expense
      } else if (isMoney) {
        tc = theme.rgb.income
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

  const incomeRows: CategoryDatum[] = incomeSorted.map((c) => ({
    name: c.name,
    color: c.color,
    total: c.total,
  }))
  const expenseRows: CategoryDatum[] = expenseSorted.map((c) => ({
    name: c.name,
    color: c.color,
    total: c.total,
  }))

  // Build PDF
  const { doc, ctx } = await initReport(dark)
  const { theme } = ctx
  const pageW = doc.internal.pageSize.getWidth()
  addTitle(doc, ctx, 'Monthly Financial Report', `${MONTHS[m - 1]} ${y}`)

  let posY = addSummaryBox(
    doc,
    ctx,
    [
      { label: 'Total Income', value: money(totalIncome), color: theme.rgb.income },
      { label: 'Total Expenses', value: money(totalExpense), color: theme.rgb.expense },
      { label: 'Net Savings', value: money(net), color: moneyRgb(theme, net) },
    ],
    55,
    'Monthly Summary'
  )

  // Category orbit heroes (income + expense): brand rings rasterized here on the
  // main thread, with the total + label overlaid in embedded Inter.
  const colW = (pageW - 45) / 2
  const heroSize = Math.min(colW, 170)
  const [incomeHero, expenseHero] = await Promise.all([
    orbitHeroImage(incomeRows, theme, heroSize),
    orbitHeroImage(expenseRows, theme, heroSize),
  ])
  if (incomeHero || expenseHero) {
    const leftCx = 15 + colW / 2
    const rightCx = 15 + colW + 15 + colW / 2
    const drawHero = (
      url: string,
      cx: number,
      rows: CategoryDatum[],
      coreLabel: string,
      caption: string
    ) => {
      if (!url) return
      doc.addImage(url, 'PNG', cx - heroSize / 2, posY, heroSize, heroSize)
      URL.revokeObjectURL(url)
      const total = computeOrbitRings(rows).total
      drawOrbitCore(doc, ctx, cx, posY + heroSize / 2, money(total), coreLabel)
      addChartCaption(doc, ctx, caption, cx, posY + heroSize + 12)
    }
    drawHero(
      incomeHero,
      leftCx,
      incomeRows,
      `earned · ${MONTHS_SHORT[m - 1]}`,
      'Income by Category'
    )
    drawHero(
      expenseHero,
      rightCx,
      expenseRows,
      `spent · ${MONTHS_SHORT[m - 1]}`,
      'Expenses by Category'
    )
    posY += heroSize + 22
  }

  // Category breakdown table
  if (posY > 550) {
    addBrandPage(doc, theme)
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
      ctx,
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
      posY + 4
    )
  }

  addFooter(doc, ctx)

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

  const topRows: CategoryDatum[] = topCategories.map((c) => ({
    name: c.name,
    color: c.color,
    total: c.total,
  }))

  // Build PDF
  const { doc, ctx } = await initReport(dark)
  const { theme } = ctx
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()

  // 2-column layout: category orbit hero + income/expense bar side by side, the
  // cumulative cash-flow line full-width below. Charts render at 2x for sharpness.
  const chartScale = 2
  const colChartW = (pageW - 45) / 2
  const colChartH = 170
  const heroSize = Math.min(colChartW, colChartH)

  const heroUrl = await orbitHeroImage(topRows, theme, heroSize)

  const barUrl =
    monthly.length > 0
      ? await renderChartViaWorker(
          'bar',
          buildIncomeExpenseBar(monthly, theme),
          colChartW * chartScale,
          colChartH * chartScale,
          theme
        )
      : ''

  const lineDisplayW = pageW - 30
  const lineDisplayH = 120
  const lineUrl =
    cashFlow.length > 0
      ? await renderChartViaWorker(
          'line',
          buildCashFlowLine(
            monthly.map((m) => m.month),
            cashFlow,
            theme
          ),
          lineDisplayW * chartScale,
          lineDisplayH * chartScale,
          theme
        )
      : ''

  addTitle(
    doc,
    ctx,
    `Annual Financial Report — ${year}`,
    `Token Circles | Generated: ${new Date().toLocaleDateString()}`
  )

  let posY = addSummaryBox(
    doc,
    ctx,
    [
      { label: 'Total Income', value: money(totalIncome), color: theme.rgb.income },
      { label: 'Total Expenses', value: money(totalExpense), color: theme.rgb.expense },
      { label: 'Net Savings', value: money(net), color: moneyRgb(theme, net) },
      {
        label: 'Savings Rate',
        value: `${savingsRate.toFixed(1)}%`,
        color: moneyRgb(theme, savingsRate),
      },
    ],
    52,
    'Annual Summary'
  )

  // Charts: category orbit hero + income/expense bar side by side
  if (heroUrl || barUrl) {
    const chartLabelY = posY + colChartH + 12
    if (heroUrl) {
      const heroCx = 15 + colChartW / 2
      doc.addImage(heroUrl, 'PNG', heroCx - heroSize / 2, posY, heroSize, heroSize)
      URL.revokeObjectURL(heroUrl)
      drawOrbitCore(
        doc,
        ctx,
        heroCx,
        posY + heroSize / 2,
        money(computeOrbitRings(topRows).total),
        `spent · ${year}`
      )
      addChartCaption(doc, ctx, 'Spending by Category', heroCx, chartLabelY)
    }
    if (barUrl) {
      const barX = 15 + colChartW + 15
      doc.addImage(barUrl, 'PNG', barX, posY, colChartW, colChartH)
      URL.revokeObjectURL(barUrl)
      addChartCaption(doc, ctx, 'Monthly Income vs Expenses', barX + colChartW / 2, chartLabelY)
    }
    posY += colChartH + 28
  }

  // Cumulative cash-flow line (full-width)
  if (lineUrl && cashFlow.length > 0) {
    if (posY + lineDisplayH + 22 > pageH - 25) {
      addBrandPage(doc, theme)
      posY = 25
    }
    doc.addImage(lineUrl, 'PNG', 15, posY, lineDisplayW, lineDisplayH)
    URL.revokeObjectURL(lineUrl)
    addChartCaption(doc, ctx, 'Cumulative Cash Flow', pageW / 2, posY + lineDisplayH + 12)
    posY += lineDisplayH + 22
  }

  addFooter(doc, ctx)

  // Monthly breakdown table on a fresh page
  addBrandPage(doc, theme)
  posY = 25
  addSectionTable(
    doc,
    ctx,
    'Monthly Breakdown',
    ['Month', 'Income', 'Expenses', 'Net', 'Running Balance'],
    [65, 90, 90, 90, 100],
    monthly.map((m, i) => {
      const n = m.income - m.expense
      const running = monthly.slice(0, i + 1).reduce((s, x) => s + x.income - x.expense, 0)
      return [MONTHS[i], money(m.income), money(m.expense), money(n), money(running)]
    }),
    posY
  )

  addFooter(doc, ctx)

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

  const { doc, ctx } = await initReport(dark)
  const { theme } = ctx
  const pageW = doc.internal.pageSize.getWidth()

  addTitle(doc, ctx, `Year-End Tax Summary — ${year}`, new Date().toLocaleDateString())

  const taxPct = totalExp > 0 ? ((taxTotal / totalExp) * 100).toFixed(1) : '0.0'
  let posY = addSummaryBox(
    doc,
    ctx,
    [
      {
        label: 'Tax-Deductible',
        value: `${money(taxTotal)} (${taxPct}%)`,
        color: theme.rgb.income,
      },
      { label: 'Non-Deductible', value: money(nonTotal), color: theme.rgb.textSecondary },
      { label: 'Total Expenses', value: money(totalExp), color: theme.rgb.textPrimary },
    ],
    55,
    'Tax Summary'
  )

  // Tax-deductible section
  if (taxDeductible.length > 0) {
    posY = addSectionTable(
      doc,
      ctx,
      'Tax-Deductible Expenses',
      ['Category', 'Transactions', 'Amount'],
      [160, 70, 90],
      taxDeductible.map((r) => [r.catName, String(r.count), money(r.total)]),
      posY,
      theme.rgb.income
    )
  }

  // Non-deductible section
  if (nonDeductible.length > 0) {
    if (posY > 500) {
      addBrandPage(doc, theme)
      posY = 25
    }
    posY = addSectionTable(
      doc,
      ctx,
      'Non-Deductible Expenses',
      ['Category', 'Transactions', 'Amount'],
      [160, 70, 90],
      nonDeductible.map((r) => [r.catName, String(r.count), money(r.total)]),
      posY + 6,
      theme.rgb.expense
    )
  }

  // Disclaimer
  doc.setFont(ctx.body, 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...theme.rgb.textSecondary)
  doc.text(
    'This report is for informational purposes only. Consult a tax professional for official tax filing.',
    pageW / 2,
    doc.internal.pageSize.getHeight() - 25,
    { align: 'center' }
  )

  addFooter(doc, ctx)

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

  const { doc, ctx } = await initReport(dark)
  const { theme } = ctx
  const pageW = doc.internal.pageSize.getWidth()

  addTitle(
    doc,
    ctx,
    `Year-End P&L Summary — ${year}`,
    `Token Circles | ${new Date().toLocaleDateString()}`
  )

  let posY = addSummaryBox(
    doc,
    ctx,
    [
      { label: 'Total Income', value: money(totalIncome), color: theme.rgb.income },
      { label: 'Total Expenses', value: money(totalExpense), color: theme.rgb.expense },
      { label: 'Net Savings', value: money(net), color: moneyRgb(theme, net) },
    ],
    55,
    'P&L Summary'
  )

  doc.setFont(ctx.body, 'normal')
  doc.setFontSize(10)
  doc.setTextColor(...theme.rgb.textSecondary)
  doc.text(`Savings Rate: ${savingsRate.toFixed(1)}%`, pageW / 2, posY, { align: 'center' })
  posY += 8

  // Income section
  if (incomeRows.length > 0) {
    posY = addSectionTable(
      doc,
      ctx,
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
      theme.rgb.income
    )
  }

  // Expense section
  if (expenseRows.length > 0) {
    if (posY > 500) {
      addBrandPage(doc, theme)
      posY = 25
    }
    posY = addSectionTable(
      doc,
      ctx,
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
      theme.rgb.expense
    )
  }

  const txnCount =
    incomeRows.reduce((s, r) => s + r.count, 0) + expenseRows.reduce((s, r) => s + r.count, 0)
  doc.setFont(ctx.body, 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...theme.rgb.textSecondary)
  doc.text(
    `Total: ${txnCount} transactions | Net Savings: ${money(net)} (${savingsRate.toFixed(1)}% savings rate)`,
    pageW / 2,
    doc.internal.pageSize.getHeight() - 15,
    { align: 'center' }
  )

  return doc.output('blob')
}
