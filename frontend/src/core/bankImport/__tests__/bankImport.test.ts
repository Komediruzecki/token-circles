import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { resolveTargetAccount, statementSignature } from '../accountResolver'
import { ersteAdapter } from '../adapters/erste'
import { pbzAdapter } from '../adapters/pbz'
import { revolutAdapter } from '../adapters/revolut'
import { CANONICAL_HEADERS } from '../canonical'
import { matchCategory } from '../categoryRules'
import {
  decodeText,
  normalizeDate,
  parseDotNumber,
  parseEuropeanNumber,
  parseFlexibleNumber,
  splitDelimited,
} from '../parse'
import { processFiles, toDetectInput } from '../process'
import { detectBank } from '../registry'
import type { CategoryRuleSet, TransferRuleSet, TransformContext } from '../types'

const enc = (s: string) => new TextEncoder().encode(s)

const catRules: CategoryRuleSet = [
  { category: 'Groceries', keywords: ['kaufland', 'konzum'] },
  { category: 'Bank Fees', keywords: ['naknad', 'pripis kamate'] },
  { category: 'Subscriptions', keywords: ['netflix'] },
]

const baseCtx = (over: Partial<TransformContext> = {}): TransformContext => ({
  targetAccount: 'Revolut',
  categoryRules: catRules,
  transferRules: { ownAccounts: [], keywords: [], counterparts: {} },
  knownAccounts: [],
  ...over,
})

// ---------------------------------------------------------------------------
// category matching — longest keyword wins
// ---------------------------------------------------------------------------
describe('matchCategory (longest match)', () => {
  const rules: CategoryRuleSet = [
    { category: 'Groceries', keywords: ['spar'] },
    { category: 'Fuel', keywords: ['spar food & fuel'] },
  ]
  it('prefers the longer (more specific) keyword regardless of rule order', () => {
    // "spar" (Groceries) is listed first, but the longer "spar food & fuel" wins.
    expect(matchCategory('SPAR Food & Fuel Zapresic', rules)).toBe('Fuel')
    // A plain SPAR line still matches the short keyword.
    expect(matchCategory('SPAR supermarket', rules)).toBe('Groceries')
  })
  it('returns null when nothing matches', () => {
    expect(matchCategory('Kaufland', rules)).toBeNull()
    expect(matchCategory('', rules)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// parse utilities
// ---------------------------------------------------------------------------
describe('parse utils', () => {
  it('parses number conventions', () => {
    expect(parseDotNumber('-169.80')).toBeCloseTo(-169.8)
    expect(parseDotNumber('1,234.56')).toBeCloseTo(1234.56)
    expect(parseEuropeanNumber('3.177,94')).toBeCloseTo(3177.94)
    expect(parseEuropeanNumber('100,00')).toBeCloseTo(100)
    expect(parseEuropeanNumber('-1,59')).toBeCloseTo(-1.59)
    expect(parseFlexibleNumber('-60')).toBeCloseTo(-60)
    expect(parseFlexibleNumber('1.234,56')).toBeCloseTo(1234.56)
    expect(parseFlexibleNumber('1,234.56')).toBeCloseTo(1234.56)
  })

  it('normalizes dates from every bank format', () => {
    expect(normalizeDate('2026-05-01 12:58:02')).toBe('2026-05-01') // Revolut
    expect(normalizeDate('08.04.2026')).toBe('2026-04-08') // Erste
    expect(normalizeDate('8.4.2026')).toBe('2026-04-08')
    expect(normalizeDate(new Date(2026, 2, 31))).toBe('2026-03-31') // PBZ xls date cell
    expect(normalizeDate('')).toBe('')
    expect(normalizeDate('not a date')).toBe('')
  })

  it('splits quoted delimited text', () => {
    const rows = splitDelimited('a;b;c\n1;"x;y";3', ';')
    expect(rows).toEqual([
      ['a', 'b', 'c'],
      ['1', 'x;y', '3'],
    ])
  })

  it('decodes windows-1250 bytes (Croatian diacritics)', () => {
    // 0xE8 = 'č', 0x9A = 'š' in windows-1250
    const bytes = new Uint8Array([0xe8, 0x9a])
    expect(decodeText(bytes, 'windows-1250')).toBe('čš')
  })
})

// ---------------------------------------------------------------------------
// Revolut
// ---------------------------------------------------------------------------
describe('revolut adapter', () => {
  const csv = [
    'Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance',
    'Card Payment,Current,2026-04-30 16:00:26,2026-05-01 12:58:02,Kaufland,-15.69,0.00,EUR,COMPLETED,175.45',
    'Topup,Current,2026-05-15 19:21:32,2026-05-15 19:21:34,Top-up by *1399,50.00,0.00,EUR,COMPLETED,212.10',
    'Card Payment,Current,2026-04-09 14:19:06,,Kaufland,-20.34,0.00,EUR,PENDING,',
  ].join('\n')

  it('detects, skips PENDING, classifies by sign', async () => {
    const bytes = enc(csv)
    expect(revolutAdapter.detect(toDetectInput('account-statement.csv', bytes))).toBeGreaterThan(
      0.9
    )
    const parsed = await revolutAdapter.parse(bytes, 'account-statement.csv')
    const txns = revolutAdapter.transform(parsed, baseCtx())
    expect(txns).toHaveLength(2) // PENDING dropped
    const kauf = txns[0]
    expect(kauf).toMatchObject({
      date: '2026-05-01',
      type: 'Expense',
      meansOfPayment: 'Revolut',
      category: 'Groceries',
      amount: 15.69,
      currency: 'EUR',
    })
  })

  it('emits a two-sided transfer when the counterpart resolves', async () => {
    const rules: TransferRuleSet = {
      ownAccounts: ['Erste Current', 'Revolut'],
      keywords: ['top-up'],
      counterparts: { '1399': 'Erste Current' },
    }
    const parsed = await revolutAdapter.parse(enc(csv), 'x.csv')
    const txns = revolutAdapter.transform(parsed, baseCtx({ transferRules: rules }))
    const topup = txns.find((t) => t.description.includes('Top-up'))!
    // Inbound to Revolut from Erste Current → source=Erste, dest=Revolut.
    expect(topup).toMatchObject({
      type: 'Transfer',
      meansOfPayment: 'Erste Current',
      category: 'Revolut',
      amount: 50,
    })
  })

  it('falls back to signed income/expense when the counterpart is unknown', async () => {
    const rules: TransferRuleSet = { ownAccounts: [], keywords: ['top-up'], counterparts: {} }
    const parsed = await revolutAdapter.parse(enc(csv), 'x.csv')
    const txns = revolutAdapter.transform(parsed, baseCtx({ transferRules: rules }))
    const topup = txns.find((t) => t.description.includes('Top-up'))!
    expect(topup.type).toBe('Income') // +50, unresolved transfer → income on Revolut
    expect(topup.notes).toContain('possible transfer')
  })
})

// ---------------------------------------------------------------------------
// Erste
// ---------------------------------------------------------------------------
describe('erste adapter', () => {
  // ASCII-only fixture (windows-1250 == utf-8 in the ASCII range).
  const csv = [
    'Izvod prometa po racunu HR4024020063212347144 za period od 01.05.2026. do 31.05.2026. Valuta EUR OIB 95768120848',
    'Redni broj;Datum valute;Datum izvrsenja;Opis placanja;Broj racuna;Isplate;Uplate;Stanje;PNB pl;PNB pr;Platitelj/Primatelj;Mjesto;Referenca',
    '',
    '1;01.05.2026;01.05.2026;Kaufland shop;HR99;23,49;;3.450,26;HR99;HR99;KAUFLAND;ZAGREB;111',
    '2;04.05.2026;04.05.2026;Isplata place;HR08;;3.177,94;6.415,37;HR67;HR69;RIMAC;SVETA NEDELJA;222',
  ].join('\n')

  it('maps debit→expense and credit→income with European amounts', async () => {
    const bytes = enc(csv)
    expect(ersteAdapter.detect(toDetectInput('ERSTE Izvadak.csv', bytes))).toBeGreaterThan(0.9)
    const parsed = await ersteAdapter.parse(bytes, 'ERSTE Izvadak.csv')
    expect(parsed.meta.currency).toBe('EUR')
    expect(parsed.meta.iban).toBe('HR4024020063212347144')
    const txns = ersteAdapter.transform(parsed, baseCtx({ targetAccount: 'Erste Current' }))
    expect(txns).toHaveLength(2)
    expect(txns[0]).toMatchObject({
      date: '2026-05-01',
      type: 'Expense',
      meansOfPayment: 'Erste Current',
      category: 'Groceries',
      amount: 23.49,
    })
    expect(txns[1]).toMatchObject({ type: 'Income', amount: 3177.94 })
  })
})

// ---------------------------------------------------------------------------
// PBZ (synthetic .xls built in-memory — no personal data in the repo)
// ---------------------------------------------------------------------------
function makePbzXls(): Uint8Array {
  const aoa: unknown[][] = [
    ['', 'TRANSAKCIJSKI RACUN:', '', '', '', ''],
    ['', 'HR7823400093236264436', '', '', '', ''],
    ['', 'OD:', 'DO:', '', '', ''],
    ['', '01.01.2026', '02.04.2026', '', '', ''],
    ['DATUM', 'VRSTA TRANSAKCIJE', 'OPIS PLACANJA', 'IZNOS', 'VALUTA', ''],
    [new Date(2026, 2, 31), 'Naplacene naknade', 'PRIPIS KAMATE placeholder', -1.59, ' EUR ', ''],
    [new Date(2026, 2, 30), 'POS placanje', 'POS Revolut**0418* Dublin', -60, ' EUR ', ''],
    [new Date(2026, 3, 1), 'Pripisane kamate', 'PRIPIS KAMATE', 0.08, ' EUR ', ''],
  ]
  const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true })
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xls' }))
}

describe('pbz adapter', () => {
  it('parses the binary xls, skips metadata rows, classifies by sign', async () => {
    const bytes = makePbzXls()
    expect(
      pbzAdapter.detect(toDetectInput('Izvjesce o transakcijama_HR78.xls', bytes))
    ).toBeGreaterThan(0.9)
    const parsed = await pbzAdapter.parse(bytes, 'Izvjesce.xls')
    expect(parsed.rows).toHaveLength(3) // 3 data rows, metadata + header skipped
    expect(parsed.meta.iban).toBe('HR7823400093236264436')

    const rules: TransferRuleSet = {
      ownAccounts: [],
      keywords: ['revolut'],
      counterparts: { '0418': 'Revolut' },
    }
    const txns = pbzAdapter.transform(
      parsed,
      baseCtx({ targetAccount: 'PBZ Giro', transferRules: rules })
    )
    expect(txns).toHaveLength(3)
    // POS Revolut**0418 → two-sided transfer PBZ Giro → Revolut
    const pos = txns.find((t) => t.description.includes('Revolut'))!
    expect(pos).toMatchObject({
      type: 'Transfer',
      meansOfPayment: 'PBZ Giro',
      category: 'Revolut',
      amount: 60,
    })
    // Interest credit → income, currency trimmed
    const interest = txns.find((t) => t.description === 'PRIPIS KAMATE')!
    expect(interest).toMatchObject({
      type: 'Income',
      category: 'Bank Fees',
      amount: 0.08,
      currency: 'EUR',
    })
  })
})

// ---------------------------------------------------------------------------
// registry + process
// ---------------------------------------------------------------------------
describe('registry + process', () => {
  it('detects the right bank from content', () => {
    const rev = detectBank(
      toDetectInput(
        'x.csv',
        enc(
          'Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance\n'
        )
      )
    )
    expect(rev?.adapter.id).toBe('revolut')
    const erste = detectBank(toDetectInput('x.csv', enc('Izvod prometa po racunu HR40 ...\n')))
    expect(erste?.adapter.id).toBe('erste')
  })

  it('aggregates multiple files into one canonical table', async () => {
    const revCsv = enc(
      'Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance\n' +
        'Card Payment,Current,2026-04-30,2026-05-01,Netflix,-9.99,0.00,EUR,COMPLETED,1.0'
    )
    const result = await processFiles(
      [{ filename: 'rev.csv', bytes: revCsv, targetAccount: 'Revolut' }],
      { categoryRules: catRules }
    )
    expect(result.headers).toEqual([...CANONICAL_HEADERS])
    expect(result.rows).toHaveLength(1)
    expect(result.perFile[0]).toMatchObject({
      bankId: 'revolut',
      count: 1,
      targetAccount: 'Revolut',
    })
    // Column order: Date, Type, Means of Payment, Category, Amount, Currency, Description
    expect(result.rows[0].slice(0, 7)).toEqual([
      '2026-05-01',
      'Expense',
      'Revolut',
      'Subscriptions',
      '9.99',
      'EUR',
      'Netflix',
    ])
  })
})

// ---------------------------------------------------------------------------
// account resolver
// ---------------------------------------------------------------------------
describe('account resolver', () => {
  const accounts = [{ name: 'Erste Current', bank_name: 'Erste' }, { name: 'Revolut Joint' }]

  it('remembers a prior choice by signature', () => {
    const sig = statementSignature('revolut', {}, '2026-05-04T17-33-57_account-statement_x.csv')
    const remembered = { [sig]: 'Revolut Joint' }
    expect(
      resolveTargetAccount(
        'revolut',
        {},
        '2026-05-04T17-33-57_account-statement_x.csv',
        accounts,
        remembered
      )
    ).toBe('Revolut Joint')
  })

  it('matches by stored IBAN identifier, then falls back to bank name', () => {
    const ids = { 'Erste Current': ['HR4024020063212347144'] }
    expect(
      resolveTargetAccount('erste', { iban: 'HR4024020063212347144' }, 'f.csv', accounts, {}, ids)
    ).toBe('Erste Current')
    expect(resolveTargetAccount('erste', {}, 'f.csv', accounts, {}, {})).toBe('Erste Current') // bank_name match
  })
})

// ---------------------------------------------------------------------------
// canonical headers must auto-map onto the app's import fields (contract guard)
// ---------------------------------------------------------------------------
describe('canonical header auto-mapping', () => {
  // Mirror of Import.tsx HEADER_VARIANTS — if that changes, this guard should too.
  const FIELD_ORDER = [
    'date',
    'description',
    'amount',
    'category',
    'currency',
    'beneficiary',
    'payor',
    'means_of_payment',
    'exchange_rate',
    'notes',
    'type',
    'amount_local',
  ]
  const HEADER_VARIANTS: Record<string, string[]> = {
    date: ['date', 'datum', 'trans date', 'transaction date'],
    description: ['description', 'desc', 'memo', 'note', 'narration', 'details'],
    amount: ['amount', 'sum', 'total', 'value', 'suma'],
    category: ['category', 'cat', 'kategoria'],
    currency: ['currency', 'waluta', 'curr'],
    beneficiary: ['beneficiary', 'beneficjent', 'recipient', 'payee'],
    payor: ['payor', 'payer', 'from'],
    means_of_payment: ['payment', 'method', 'means', 'payment method'],
    exchange_rate: ['rate', 'exchange rate', 'kurs'],
    notes: ['notes', 'note', 'remark', 'comments'],
    type: ['type', 'typ', 'tx type', 'transaction type'],
    amount_local: ['amount local', 'local amount', 'amount in local currency'],
  }
  const autoDetect = (headers: string[]) => {
    const mapping: Record<string, number> = {}
    for (const field of FIELD_ORDER) {
      const lower = headers.map((h) => h.toLowerCase())
      const idx = lower.findIndex((h) => HEADER_VARIANTS[field].some((v) => h.includes(v)))
      if (idx !== -1) mapping[field] = idx
    }
    return mapping
  }

  it('maps each canonical header to the intended field/index', () => {
    const m = autoDetect([...CANONICAL_HEADERS])
    expect(m.date).toBe(0)
    expect(m.type).toBe(1)
    expect(m.means_of_payment).toBe(2)
    expect(m.category).toBe(3)
    expect(m.amount).toBe(4)
    expect(m.currency).toBe(5)
    expect(m.description).toBe(6)
    expect(m.beneficiary).toBe(7)
    expect(m.payor).toBe(8)
    expect(m.notes).toBe(9)
  })
})
