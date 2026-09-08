/**
 * Category and tag colours are stored WITH their `#`, and four places added a second one.
 *
 * Every write path keeps the hash: the column defaults are `'#6b7280'`
 * (`worker/migrations/0001_init.sql`), the seeded categories are `'#22C55E'`, `'#F97316'` and so
 * on (`worker/src/profileData.ts`), the local handler writes `'#6e9bff'`, and the pickers are
 * `<input type="color">`, which can only produce `#rrggbb`. Nothing anywhere strips it — and the
 * places that render these colours correctly, `Tags.tsx` and `BulkActionBar.tsx`, pass the stored
 * value straight through.
 *
 * So `` `#${tag.color}` `` built `##6e9bff`. The CSS parser rejects it and the assignment is
 * dropped silently, leaving the element with no background at all. That is invisible in a diff and
 * nearly invisible on screen too — until you notice what it does to `.tag`, which sets
 * `color: #fff` and nothing else: a tag chip on a transaction row was white text on the table's
 * own background.
 *
 * This assertion reads the colour back off the DOM, because that is the layer the bug lives in:
 * the markup is right, the value is right, and only the browser's rejection of `##` shows it. The
 * other three sites are 10x10 dots with no colour of their own, so they simply stopped being
 * there; they are covered by the source scan in src/__tests__/storedColourHash.test.ts.
 */
import { render } from 'solid-js/web'
import { afterEach, describe, expect, it } from 'vitest'
import TransactionTable from '../TransactionTable'
import type { Transaction } from '../../types/models'

let host: HTMLDivElement
let dispose: () => void

afterEach(() => {
  dispose?.()
  host?.remove()
})

function taggedRow(color: string): Transaction {
  return {
    id: 1,
    profile_id: 1,
    description: 'Row 1',
    type: 'expense',
    amount: 10,
    amount_local: 10,
    currency: 'EUR',
    exchange_rate: 1,
    date: '2026-01-01',
    account_id: null,
    transfer_account_id: null,
    category_name: null,
    category_color: null,
    reconciled: false,
    tags: [{ id: 7, name: 'Company', color }],
  } as unknown as Transaction
}

function mountTable(color: string): void {
  host = document.createElement('div')
  document.body.appendChild(host)
  dispose = render(
    () => (
      <TransactionTable
        transactions={[taggedRow(color)]}
        selectedTransactions={[]}
        onSelectionChange={() => {}}
        activeProfileId={1}
      />
    ),
    host
  )
}

/** The chip itself, not the `.tags` wrapper around it. */
function chip(): HTMLElement {
  const found = Array.from(host.querySelectorAll<HTMLElement>('span[class]')).find((el) =>
    /(^|\s|_)tag_/.test(el.className)
  )
  expect(found, 'the tag chip should render').toBeTruthy()
  return found!
}

describe('a stored colour reaches the DOM as it was stored', () => {
  it('paints the tag chip on a transaction row', () => {
    mountTable('#6e9bff')
    // Not "some colour": the one the tag was given. `##6e9bff` leaves the background unset, and
    // the chip's own `color: #fff` then renders white on the table background.
    //
    // Asserting the attribute does not contain `##` would be worthless here — an invalid
    // declaration is dropped outright, so the attribute is empty either way and the check passes
    // with the bug present. The colour has to be read back.
    const painted = chip().style.background || chip().style.backgroundColor
    expect(painted).not.toBe('')
    expect(painted.replace(/\s/g, '').toLowerCase()).toContain('rgb(110,155,255)')
  })

  it('keeps working for a colour written in upper case', () => {
    // The seeded categories are upper case (`#F97316`), so the parser has to accept those too.
    mountTable('#F97316')
    expect(chip().style.background || chip().style.backgroundColor).not.toBe('')
  })

  it('still paints a chip whose tag has no colour at all', () => {
    // The column is nullable, and an unpainted chip is the same invisible white-on-white the
    // double hash produced. The fallback is the column's own default rather than var(--primary),
    // which the chip's white label only reaches 2.7:1 against in the dark theme.
    mountTable(null as unknown as string)
    expect(chip().style.background || chip().style.backgroundColor).not.toBe('')
  })
})
