import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { autoDetectMapping, FIELD_NAMES } from '../../importMapping'
import { resolveTargetAccount, statementSignature } from '../accountResolver'
import { dkbAdapter } from '../adapters/dkb'
import { ersteAdapter } from '../adapters/erste'
import { ingAdapter } from '../adapters/ing'
import { n26Adapter } from '../adapters/n26'
import { pbzAdapter } from '../adapters/pbz'
import { revolutAdapter } from '../adapters/revolut'
import { sparkasseAdapter } from '../adapters/sparkasse'
import { wiseAdapter } from '../adapters/wise'
import { ynabAdapter } from '../adapters/ynab'
import { CANONICAL_HEADERS } from '../canonical'
import { matchCategory } from '../categoryRules'
import {
  decodeText,
  decodeTextSniffed,
  indexHeader,
  normalizeDate,
  parseDotNumber,
  parseEuropeanNumber,
  parseFlexibleNumber,
  splitDelimited,
} from '../parse'
import { processFiles, toDetectInput } from '../process'
import { detectBank } from '../registry'
import { resolveCounterpart } from '../transferRules'
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

describe('resolveCounterpart (longest signature wins)', () => {
  it('prefers a specific card last-4 over a generic keyword', () => {
    const rules = {
      ownAccounts: [],
      keywords: [],
      counterparts: { revolut: 'Revolut EUR', '0418': 'Revolut USD' },
    }
    // A generic "revolut" is listed first but the specific "0418" must win.
    expect(resolveCounterpart('POS Revolut**0418* Dublin', rules)).toBe('Revolut USD')
    // Without the card suffix, the generic keyword still resolves.
    expect(resolveCounterpart('POS Revolut Dublin', rules)).toBe('Revolut EUR')
  })
  it('falls back to an own-account name, else null', () => {
    const rules = { ownAccounts: ['Erste Current'], keywords: [], counterparts: {} }
    expect(resolveCounterpart('Top-up to Erste Current', rules)).toBe('Erste Current')
    expect(resolveCounterpart('Nothing here', rules)).toBeNull()
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

  it('treats a stray mid-field quote as literal (does not collapse the row)', () => {
    // The lone " must NOT open a quoted field, or the following ";" get swallowed
    // and the 5-column row collapses (which would drop the transaction).
    const rows = splitDelimited('1;PROMO 24" TV;9,99;EUR;x', ';')
    expect(rows[0]).toHaveLength(5)
    expect(rows[0]).toEqual(['1', 'PROMO 24" TV', '9,99', 'EUR', 'x'])
  })

  it('keeps balanced mid-field quotes and handles escaped quotes', () => {
    expect(splitDelimited('a;KEKS za "I send";b', ';')[0]).toEqual(['a', 'KEKS za "I send"', 'b'])
    // "" inside a properly quoted field is one literal quote.
    expect(splitDelimited('"a""b";c', ';')[0]).toEqual(['a"b', 'c'])
    // A comma inside a quoted Revolut field stays intact.
    expect(splitDelimited('Card,"Top-up, extra",5.00', ',')[0]).toEqual([
      'Card',
      'Top-up, extra',
      '5.00',
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
// within-batch duplicate detection (raw-row dedup, not the coarse canonical row)
// ---------------------------------------------------------------------------
describe('duplicate detection', () => {
  const header =
    'Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance'
  const mk = (lines: string[]) => enc([header, ...lines].join('\n'))

  it('does NOT flag distinct same-day transactions with different timestamps', async () => {
    // Same day, same amount, same description → identical CANONICAL rows, but the
    // raw rows differ (times + balance), so they must not be treated as duplicates.
    const csv = mk([
      'Card Payment,Current,2026-06-11 10:00:00,2026-06-11 11:00:00,CLAUDE,-12.5,0.00,EUR,COMPLETED,100.00',
      'Card Payment,Current,2026-06-11 14:30:05,2026-06-11 15:00:00,CLAUDE,-12.5,0.00,EUR,COMPLETED,87.50',
    ])
    const result = await processFiles([{ filename: 'r.csv', bytes: csv, targetAccount: 'Revolut' }])
    expect(result.rows).toHaveLength(2)
    expect(result.rows[0].slice(0, 7)).toEqual(result.rows[1].slice(0, 7)) // canonical rows equal
    expect(result.duplicateIndices).toEqual([]) // …but not flagged as duplicates
  })

  it('flags a true duplicate (identical raw statement row twice)', async () => {
    const line =
      'Card Payment,Current,2026-06-11 10:00:00,2026-06-11 11:00:00,CLAUDE,-12.5,0.00,EUR,COMPLETED,100.00'
    const result = await processFiles([
      { filename: 'r.csv', bytes: mk([line, line]), targetAccount: 'Revolut' },
    ])
    expect(result.rows).toHaveLength(2)
    expect(result.duplicateIndices).toEqual([1]) // the second copy is the duplicate
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
  // Exercises the REAL importMapping.autoDetectMapping (not a hand-copy), so this
  // guard actually fails if a HEADER_VARIANTS change ever misroutes the bank-import
  // canonical headers in production.
  it('maps each canonical header to the intended field/index', () => {
    const m = autoDetectMapping([...CANONICAL_HEADERS])
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

  it('maps every required import field', () => {
    const m = autoDetectMapping([...CANONICAL_HEADERS])
    for (const field of FIELD_NAMES.filter((f) => f.required)) {
      expect(m[field.key], `required field "${field.key}" must auto-map`).toBeGreaterThanOrEqual(0)
    }
  })
})

// ---------------------------------------------------------------------------
// New parse utils (added with the EU adapter batch)
// ---------------------------------------------------------------------------
describe('parse utils — EU adapter additions', () => {
  it('normalizes the newly supported date shapes', () => {
    expect(normalizeDate('20241228')).toBe('2024-12-28') // ING compact ISO
    expect(normalizeDate('28-01-2026')).toBe('2026-01-28') // Wise day-first hyphens
    expect(normalizeDate('14.07.26')).toBe('2026-07-14') // Sparkasse/DKB DD.MM.YY
    expect(normalizeDate('31.12.99')).toBe('1999-12-31') // century pivot
    expect(normalizeDate('06/22/2026')).toBe('2026-06-22') // US order, month>12 impossible → swap
    expect(normalizeDate('22.13.2026')).toBe('') // impossible either way
    expect(normalizeDate('99999999')).toBe('') // 8 digits but month 99
  })

  it('indexes headers by normalized name', () => {
    const col = indexHeader(['"Booking Date"', 'Betrag (€)', ''])
    expect(col['bookingdate']).toBe(0)
    expect(col['betrag(€)']).toBe(1)
  })

  it('sniffs legacy encodings when bytes are not valid UTF-8', () => {
    expect(decodeTextSniffed(new TextEncoder().encode('Bäckerei'))).toBe('Bäckerei')
    // 0xE4 = 'ä' in windows-1252 but an invalid UTF-8 sequence.
    expect(decodeTextSniffed(new Uint8Array([0x42, 0xe4, 0x72]))).toBe('Bär')
  })
})

// ---------------------------------------------------------------------------
// N26 (synthetic fixture per the current post-2023 export format)
// ---------------------------------------------------------------------------
describe('n26 adapter', () => {
  const csv = [
    '"Booking Date","Value Date","Partner Name","Partner Iban",Type,"Payment Reference","Account Name","Amount (EUR)","Original Amount","Original Currency","Exchange Rate"',
    '2025-03-03,2025-03-03,"Backhaus Muster",,Presentment,,"Main Account",-4.85,4.85,EUR,1',
    '2025-03-04,2025-03-05,"Erika Beispiel","DE02120300000000202051","Outgoing Transfer","Miete Maerz","Main Account",-850.0,,,',
    '2025-03-05,2025-03-05,"Acme GmbH","DE02500105170137075030","Credit Transfer","Gehalt 03/2025","Main Account",2600.0,,,',
  ].join('\n')

  it('detects the current and legacy headers', () => {
    expect(n26Adapter.detect(toDetectInput('x.csv', enc(csv)))).toBeGreaterThan(0.9)
    const legacy =
      '"Date","Payee","Account number","Transaction type","Payment reference","Amount (EUR)"'
    expect(n26Adapter.detect(toDetectInput('x.csv', enc(legacy)))).toBeGreaterThan(0.9)
    const legacyDe =
      '"Datum","Empfänger","Kontonummer","Transaktionstyp","Verwendungszweck","Betrag (EUR)"'
    expect(n26Adapter.detect(toDetectInput('x.csv', enc(legacyDe)))).toBeGreaterThan(0.9)
  })

  it('classifies signed EUR amounts and keeps the partner as counterparty', async () => {
    const parsed = await n26Adapter.parse(enc(csv), 'x.csv')
    const txns = n26Adapter.transform(parsed, baseCtx({ targetAccount: 'N26 Main' }))
    expect(txns).toHaveLength(3)
    expect(txns[0]).toMatchObject({
      date: '2025-03-03',
      type: 'Expense',
      meansOfPayment: 'N26 Main',
      amount: 4.85,
      currency: 'EUR',
      beneficiary: 'Backhaus Muster',
    })
    expect(txns[2]).toMatchObject({
      type: 'Income',
      amount: 2600,
      payor: 'Acme GmbH',
      description: 'Gehalt 03/2025',
    })
  })
})

// ---------------------------------------------------------------------------
// Wise (synthetic fixture per the current 23-column statement CSV)
// ---------------------------------------------------------------------------
describe('wise adapter', () => {
  const csv = [
    '"TransferWise ID",Date,"Date Time",Amount,Currency,Description,"Payment Reference","Running Balance","Exchange From","Exchange To","Exchange Rate","Payer Name","Payee Name","Payee Account Number",Merchant,"Card Last Four Digits","Card Holder Full Name",Attachment,Note,"Total fees","Exchange To Amount","Transaction Type","Transaction Details Type"',
    'CARD-345678901,15-02-2026,"15-02-2026 09:12:44.120",-23.40,EUR,"Card transaction of 23.40 EUR issued by Cafe Beispiel BERLIN",,976.60,,,,,,,"Cafe Beispiel BERLIN",4321,"Max Mustermann",,,0.00,,DEBIT,CARD',
    'TRANSFER-198765440,17-02-2026,"17-02-2026 08:30:00.000",500.00,EUR,"Topped up account",,1226.60,,,,"Max Mustermann",,,,,,,,2.10,,CREDIT,DEPOSIT',
  ].join('\n')

  it('detects by header and by statement filename', () => {
    expect(wiseAdapter.detect(toDetectInput('x.csv', enc(csv)))).toBeGreaterThan(0.9)
    expect(
      wiseAdapter.detect(toDetectInput('statement_23243482_EUR_2025-01-04_2025-06-02.csv', enc('')))
    ).toBeGreaterThan(0.6)
  })

  it('parses day-first hyphen dates, merchants, and flags top-ups as transfers', async () => {
    const parsed = await wiseAdapter.parse(enc(csv), 'x.csv')
    expect(parsed.meta.currency).toBe('EUR')
    const txns = wiseAdapter.transform(parsed, baseCtx({ targetAccount: 'Wise EUR' }))
    expect(txns).toHaveLength(2)
    expect(txns[0]).toMatchObject({
      date: '2026-02-15',
      type: 'Expense',
      amount: 23.4,
      currency: 'EUR',
      beneficiary: 'Cafe Beispiel BERLIN',
    })
    // Top-up: forced transfer, but no counterpart configured → signed income + note.
    expect(txns[1].type).toBe('Income')
    expect(txns[1].amount).toBe(500)
    expect(txns[1].notes).toContain('possible transfer')
  })
})

// ---------------------------------------------------------------------------
// ING NL (synthetic fixture per the current 11-column semicolon export)
// ---------------------------------------------------------------------------
describe('ing adapter', () => {
  const csv = [
    '"Datum";"Naam / Omschrijving";"Rekening";"Tegenrekening";"Code";"Af Bij";"Bedrag (EUR)";"Mutatiesoort";"Mededelingen";"Saldo na mutatie";"Tag"',
    '"20260113";"Albert Heijn 1522 AMSTERDAM NLD";"NL69INGB0123456789";"";"BA";"Af";"31,25";"Betaalautomaat";"Pasvolgnr: 008 13-01-2026 18:22";"1204,71";""',
    '"20260114";"J. Jansen";"NL69INGB0123456789";"NL44RABO0123456789";"GT";"Bij";"120,00";"Online bankieren";"Naam: J. Jansen Omschrijving: Terugbetaling etentje";"1324,71";""',
  ].join('\n')

  it('detects both delimiters and the IBAN filename', () => {
    expect(ingAdapter.detect(toDetectInput('x.csv', enc(csv)))).toBeGreaterThan(0.9)
    expect(
      ingAdapter.detect(toDetectInput('NL69INGB0123456789_22-12-2024_28-12-2024.csv', enc('')))
    ).toBeGreaterThan(0.6)
  })

  it('applies the Af/Bij direction to unsigned decimal-comma amounts', async () => {
    const parsed = await ingAdapter.parse(enc(csv), 'x.csv')
    expect(parsed.meta.iban).toBe('NL69INGB0123456789')
    const txns = ingAdapter.transform(parsed, baseCtx({ targetAccount: 'ING Betaal' }))
    expect(txns).toHaveLength(2)
    expect(txns[0]).toMatchObject({
      date: '2026-01-13',
      type: 'Expense',
      amount: 31.25,
      currency: 'EUR',
      beneficiary: 'Albert Heijn 1522 AMSTERDAM NLD',
    })
    expect(txns[1]).toMatchObject({ type: 'Income', amount: 120, payor: 'J. Jansen' })
  })
})

// ---------------------------------------------------------------------------
// Sparkasse (synthetic fixture per the CSV-CAMT V2 export)
// ---------------------------------------------------------------------------
describe('sparkasse adapter', () => {
  const csv = [
    '"Auftragskonto";"Buchungstag";"Valutadatum";"Buchungstext";"Verwendungszweck";"Glaeubiger ID";"Mandatsreferenz";"Kundenreferenz (End-to-End)";"Sammlerreferenz";"Lastschrift Ursprungsbetrag";"Auslagenersatz Ruecklastschrift";"Beguenstigter/Zahlungspflichtiger";"Kontonummer/IBAN";"BIC (SWIFT-Code)";"Betrag";"Waehrung";"Info"',
    '"DE21500500001234567897";"14.07.26";"14.07.26";"KARTENZAHLUNG";"2026-07-13T18:44 Debitk.1 2029-12";"";"";"687572811234";"";"";"";"EDEKA MUSTERMARKT//MUSTERSTADT/DE";"DE58100500000890123456";"BELADEBEXXX";"-27,43";"EUR";"Umsatz gebucht"',
    '"DE21500500001234567897";"15.07.26";"15.07.26";"LOHN GEHALT";"Gehalt 07/2026 Beispiel AG";"";"";"";"";"";"";"Beispiel AG";"DE02600501010002034304";"SOLADEST600";"3120,55";"EUR";"Umsatz gebucht"',
    '"DE21500500001234567897";"16.07.26";"16.07.26";"KARTENZAHLUNG";"Pending example";"";"";"";"";"";"";"Shop";"DE58100500000890123456";"BELADEBEXXX";"-9,99";"EUR";"Umsatz vorgemerkt"',
  ].join('\n')

  it('detects, reads meta, skips pending, parses signed comma amounts', async () => {
    const bytes = enc(csv)
    expect(
      sparkasseAdapter.detect(toDetectInput('20260716-1234567-umsatz.CSV', bytes))
    ).toBeGreaterThan(0.9)
    const parsed = await sparkasseAdapter.parse(bytes, 'x.csv')
    expect(parsed.meta.iban).toBe('DE21500500001234567897')
    expect(parsed.meta.currency).toBe('EUR')
    const txns = sparkasseAdapter.transform(parsed, baseCtx({ targetAccount: 'Sparkasse Giro' }))
    expect(txns).toHaveLength(2) // vorgemerkt dropped
    expect(txns[0]).toMatchObject({
      date: '2026-07-14',
      type: 'Expense',
      amount: 27.43,
      currency: 'EUR',
      beneficiary: 'EDEKA MUSTERMARKT//MUSTERSTADT/DE',
    })
    expect(txns[1]).toMatchObject({ type: 'Income', amount: 3120.55, payor: 'Beispiel AG' })
  })
})

// ---------------------------------------------------------------------------
// DKB (synthetic fixture per the current post-2023 Girokonto export)
// ---------------------------------------------------------------------------
describe('dkb adapter', () => {
  const csv = [
    '"Girokonto";"DE88120300001056358037"',
    '""',
    '"Kontostand vom 15.07.2026:";"1.234,56 EUR"',
    '""',
    '"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"',
    '"13.07.26";"13.07.26";"Gebucht";"Max Mustermann";"REWE Markt GmbH";"2026-07-12 Debitk.55 VISA Debit";"Ausgang";"DE88120300001056358037";"-42,17 €";"";"";"908070605040302"',
    '"14.07.26";"14.07.26";"Gebucht";"Beispiel AG";"Max Mustermann";"GEHALT 07/26";"Eingang";"DE88120300001056358037";"2.850,00 €";"";"";""',
    '"15.07.26";"15.07.26";"Vorgemerkt";"Max Mustermann";"Telekom Deutschland GmbH";"Rechnung 07/26";"Ausgang";"DE88120300001056358037";"-39,95 €";"";"";""',
  ].join('\n')

  it('detects despite the preamble and finds the account IBAN in it', async () => {
    const bytes = enc(csv)
    expect(
      dkbAdapter.detect(toDetectInput('05-05-2026_Umsatzliste_Girokonto_DE88.csv', bytes))
    ).toBeGreaterThan(0.9)
    const parsed = await dkbAdapter.parse(bytes, 'x.csv')
    expect(parsed.meta.iban).toBe('DE88120300001056358037')
    const txns = dkbAdapter.transform(parsed, baseCtx({ targetAccount: 'DKB Giro' }))
    expect(txns).toHaveLength(2) // Vorgemerkt dropped
    expect(txns[0]).toMatchObject({
      date: '2026-07-13',
      type: 'Expense',
      amount: 42.17,
      currency: 'EUR',
      beneficiary: 'REWE Markt GmbH',
    })
    // Thousands dot + trailing € stripped; income payee = the payer column.
    expect(txns[1]).toMatchObject({ type: 'Income', amount: 2850, payor: 'Beispiel AG' })
  })
})

// ---------------------------------------------------------------------------
// YNAB bridge format
// ---------------------------------------------------------------------------
describe('ynab adapter', () => {
  it('detects all documented header shapes', () => {
    for (const header of [
      'Date,Payee,Memo,Outflow,Inflow',
      'Date,Payee,Category,Memo,Outflow,Inflow',
      'Date,Payee,Memo,Amount',
    ]) {
      expect(ynabAdapter.detect(toDetectInput('x.csv', enc(header)))).toBeGreaterThan(0.8)
    }
  })

  it('handles Outflow/Inflow with US dates and a Category override', async () => {
    const csv = [
      'Date,Payee,Category,Memo,Outflow,Inflow',
      '06/22/2026,Coffee Corner,Everyday: Eating Out,Latte,4.50,',
      '06/23/2026,Acme Payroll,,July salary,,2500.00',
    ].join('\n')
    const parsed = await ynabAdapter.parse(enc(csv), 'x.csv')
    const txns = ynabAdapter.transform(parsed, baseCtx({ targetAccount: 'Checking' }))
    expect(txns).toHaveLength(2)
    expect(txns[0]).toMatchObject({
      date: '2026-06-22',
      type: 'Expense',
      amount: 4.5,
      category: 'Eating Out', // file category wins, group prefix stripped
    })
    expect(txns[1]).toMatchObject({ date: '2026-06-23', type: 'Income', amount: 2500 })
  })

  it('handles the signed single-Amount variant', async () => {
    const csv = ['Date,Payee,Memo,Amount', '2026-06-22,Coffee Corner,Latte,-4.50'].join('\n')
    const parsed = await ynabAdapter.parse(enc(csv), 'x.csv')
    const txns = ynabAdapter.transform(parsed, baseCtx())
    expect(txns[0]).toMatchObject({ type: 'Expense', amount: 4.5 })
  })
})

// ---------------------------------------------------------------------------
// Cross-adapter detection: every fixture must route to its own adapter
// (guards against one bank's signature shadowing another's).
// ---------------------------------------------------------------------------
describe('registry cross-detection', () => {
  const fixtures: [string, string, string][] = [
    [
      'revolut',
      'account-statement.csv',
      'Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance\nCard Payment,Current,2026-04-30 16:00:26,2026-05-01 12:58:02,X,-1.00,0.00,EUR,COMPLETED,1.00',
    ],
    [
      'n26',
      'n26-download.csv',
      '"Booking Date","Value Date","Partner Name","Partner Iban",Type,"Payment Reference","Account Name","Amount (EUR)","Original Amount","Original Currency","Exchange Rate"\n2025-03-03,2025-03-03,"X",,Presentment,,"Main Account",-1.00,,,',
    ],
    [
      'wise',
      'statement_1_EUR_2026-01-01_2026-02-01.csv',
      '"TransferWise ID",Date,"Date Time",Amount,Currency,Description,"Payment Reference","Running Balance"\nCARD-1,15-02-2026,"15-02-2026 09:00:00.000",-1.00,EUR,X,,1.00',
    ],
    [
      'ing',
      'NL69INGB0123456789_01-01-2026_31-01-2026.csv',
      '"Datum";"Naam / Omschrijving";"Rekening";"Tegenrekening";"Code";"Af Bij";"Bedrag (EUR)";"Mutatiesoort";"Mededelingen";"Saldo na mutatie";"Tag"\n"20260113";"X";"NL69INGB0123456789";"";"BA";"Af";"1,00";"Y";"Z";"1,00";""',
    ],
    [
      'sparkasse',
      '20260716-1234567-umsatz.CSV',
      '"Auftragskonto";"Buchungstag";"Valutadatum";"Buchungstext";"Verwendungszweck";"Glaeubiger ID";"Mandatsreferenz";"Kundenreferenz (End-to-End)";"Sammlerreferenz";"Lastschrift Ursprungsbetrag";"Auslagenersatz Ruecklastschrift";"Beguenstigter/Zahlungspflichtiger";"Kontonummer/IBAN";"BIC (SWIFT-Code)";"Betrag";"Waehrung";"Info"\n"DE21500500001234567897";"14.07.26";"14.07.26";"K";"V";"";"";"";"";"";"";"B";"DE58100500000890123456";"B";"-1,00";"EUR";"Umsatz gebucht"',
    ],
    [
      'dkb',
      '05-05-2026_Umsatzliste_Girokonto_DE88.csv',
      '"Girokonto";"DE88120300001056358037"\n""\n"Kontostand vom 15.07.2026:";"1,00 EUR"\n""\n"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n"13.07.26";"13.07.26";"Gebucht";"A";"B";"C";"Ausgang";"DE88120300001056358037";"-1,00 €";"";"";""',
    ],
    ['ynab', 'ynab-export.csv', 'Date,Payee,Memo,Outflow,Inflow\n06/22/2026,X,Y,1.00,'],
  ]

  it.each(fixtures)('routes the %s fixture to its adapter', (id, filename, content) => {
    const det = detectBank(toDetectInput(filename, enc(content)))
    expect(det?.adapter.id).toBe(id)
  })
})
