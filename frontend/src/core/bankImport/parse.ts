/**
 * Bank statement import — low-level parsing utilities.
 *
 * Encoding-aware text decoding, quote-aware delimited splitting, .xls parsing
 * via the bundled `xlsx`, plus date and number normalization helpers. All pure
 * (except `parseXls`, which lazy-imports xlsx) and unit-tested.
 */
import type { WorkBook } from 'xlsx'

/**
 * Decode bytes to text. `encoding` is a WHATWG label — 'utf-8', 'windows-1250'
 * (Erste/PBZ Croatian statements), etc. Non-fatal: undecodable bytes become the
 * replacement character rather than throwing.
 */
export function decodeText(bytes: Uint8Array, encoding = 'utf-8'): string {
  return new TextDecoder(encoding, { fatal: false }).decode(bytes)
}

/**
 * Split delimited text into a trimmed string matrix (RFC 4180-ish). A `"` opens a
 * quoted field ONLY at the start of a field; inside a quoted field a delimiter is
 * literal and `""` is an escaped quote. A `"` anywhere else (mid-field) is a plain
 * character — so a stray quote in a description (e.g. `PROMO 24" TV`) can't swallow
 * the rest of the row's delimiters and drop the transaction.
 */
export function splitDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = []
  // Normalize CRLF/CR → LF and drop a single trailing newline so the terminal
  // line break doesn't yield a phantom empty row.
  const lines = text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n')
  for (const line of lines) {
    const cols: string[] = []
    let cur = ''
    let inQuotes = false
    let fieldStart = true // nothing consumed into the current field yet
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (inQuotes) {
        if (ch === '"') {
          if (line[i + 1] === '"') {
            cur += '"' // escaped quote
            i++
          } else {
            inQuotes = false // closing quote
          }
        } else {
          cur += ch
        }
      } else if (ch === '"' && fieldStart) {
        inQuotes = true // opening quote (only valid at field start)
        fieldStart = false
      } else if (ch === delimiter) {
        cols.push(cur)
        cur = ''
        fieldStart = true
      } else {
        cur += ch
        fieldStart = false
      }
    }
    cols.push(cur)
    rows.push(cols.map((c) => c.trim()))
  }
  return rows
}

/**
 * Parse an .xls/.xlsx workbook's first sheet into a string matrix. Date cells
 * are converted to yyyy-mm-dd (via `cellDates`), everything else is stringified,
 * so downstream adapters see a uniform `string[][]`.
 */
export async function parseXls(bytes: Uint8Array): Promise<string[][]> {
  const XLSX = await import('xlsx')
  const wb: WorkBook = XLSX.read(bytes, { type: 'array', cellDates: true })
  const first = wb.SheetNames[0]
  if (!first) return []
  const sheet = wb.Sheets[first]
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    blankrows: false,
    defval: '',
  })
  return matrix.map((row) => (row as unknown[]).map(cellToString))
}

/** Stringify an xlsx cell: dates → ISO, primitives → String, objects → ''. */
function cellToString(cell: unknown): string {
  if (cell === null || cell === undefined) return ''
  if (cell instanceof Date) return dateToIso(cell)
  if (typeof cell === 'string') return cell
  if (typeof cell === 'number' || typeof cell === 'boolean') return String(cell)
  return ''
}

/** Format a Date as a local (not UTC) yyyy-mm-dd string. */
function dateToIso(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * Normalize a bank date value to yyyy-mm-dd. Handles: already-ISO strings,
 * DD.MM.YYYY (Erste), DD/MM/YYYY, YYYY-MM-DD HH:MM:SS (Revolut completed date),
 * and Date objects. Returns '' when it can't be parsed (caller decides fallback).
 */
export function normalizeDate(value: unknown): string {
  if (value instanceof Date && !isNaN(value.getTime())) return dateToIso(value)
  const s = (
    typeof value === 'string' ? value : typeof value === 'number' ? String(value) : ''
  ).trim()
  if (!s) return ''
  // ISO date, optionally with a time part (Revolut: "2026-05-01 12:58:02").
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T].*)?$/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  // DD.MM.YYYY or DD/MM/YYYY (optionally with a trailing time).
  const dmy = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})(?:[ T].*)?$/)
  if (dmy) {
    const d = dmy[1].padStart(2, '0')
    const m = dmy[2].padStart(2, '0')
    return `${dmy[3]}-${m}-${d}`
  }
  return ''
}

/**
 * Parse a US/JS-formatted number: dot decimal, optional comma thousands.
 * Used for Revolut ("-169.80", "1,234.56").
 */
export function parseDotNumber(value: string): number {
  const cleaned = value.replace(/\s/g, '').replace(/,/g, '')
  const n = parseFloat(cleaned)
  return Number.isFinite(n) ? n : 0
}

/**
 * Parse a European-formatted number: comma decimal, dot thousands.
 * Used for Erste ("3.177,94", "100,00", "-1,59").
 */
export function parseEuropeanNumber(value: string): number {
  const cleaned = value.replace(/\s/g, '').replace(/\./g, '').replace(',', '.')
  const n = parseFloat(cleaned)
  return Number.isFinite(n) ? n : 0
}

/**
 * Parse a number of unknown convention. If both separators are present, the last
 * one is the decimal separator (handles both "1.234,56" and "1,234.56"). If only
 * a comma is present, it's the decimal separator. Otherwise plain parseFloat.
 * Used for PBZ, whose amounts arrive from xlsx either numeric or European text.
 */
export function parseFlexibleNumber(value: string): number {
  const s = value.replace(/\s/g, '')
  if (!s) return 0
  const hasDot = s.includes('.')
  const hasComma = s.includes(',')
  if (hasDot && hasComma) {
    return s.lastIndexOf(',') > s.lastIndexOf('.') ? parseEuropeanNumber(s) : parseDotNumber(s)
  }
  if (hasComma) return parseEuropeanNumber(s)
  return parseDotNumber(s)
}

/** Extract a Croatian IBAN (HR + 19 digits) from arbitrary text, if present. */
export function extractIban(text: string): string | undefined {
  const m = text.match(/\bHR\d{19}\b/)
  return m ? m[0] : undefined
}
