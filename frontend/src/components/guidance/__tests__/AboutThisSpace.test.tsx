/**
 * Settings, About this space, run against the real local-first router on fake-indexeddb: the
 * answers the profile gave, how its region was set, a change saved on the freshest record, and
 * "Remove answer".
 */
import { render } from 'solid-js/web'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../../core/api'
import { bumpProfileVersion, setPage } from '../../../core/appStore'
import { __resetDataVersionsForTest } from '../../../core/dataVersions'
import { getDB } from '../../../core/storage/idb'

let host: HTMLDivElement
let dispose: (() => void) | undefined

beforeAll(async () => {
  await Promise.all([import('../AboutThisSpace'), import('../../../core/storage/localApiRouter')])
}, 120_000)

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('finance_storage_mode', 'serverless')
  localStorage.setItem('currentProfileId', '1')
  localStorage.setItem('localCurrency', 'EUR')
  __resetDataVersionsForTest()
  const db = await getDB()
  for (const store of Array.from(db.objectStoreNames)) await db.clear(store)
  await db.add('profiles', { id: 1, name: 'Me', created_at: '2026-01-01T00:00:00.000Z' })
  await db.add('profiles', { id: 2, name: 'Partner', created_at: '2026-01-01T00:00:00.000Z' })
  await db.put('settings', { key: 'currency', value: 'EUR' })
  setPage('settings')
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  host.remove()
  vi.restoreAllMocks()
})

const byTestId = (id: string): HTMLElement | null =>
  host.querySelector<HTMLElement>(`[data-test-id="${id}"]`)
const chip = (id: string) => byTestId(`settings-space-${id}`) as HTMLLabelElement
const radio = (id: string) => chip(id).querySelector('input') as HTMLInputElement
const regionNote = () => byTestId('settings-space-region-note')?.textContent ?? ''
const householdNote = () => byTestId('settings-space-household-note')?.textContent ?? ''

async function seed(record: object | string, key = 'guidance:1'): Promise<void> {
  const value = typeof record === 'string' ? record : JSON.stringify(record)
  await (await getDB()).put('settings', { key, value })
}

async function stored(key = 'guidance:1'): Promise<unknown> {
  const row = (await (await getDB()).get('settings', key)) as { value?: string } | undefined
  return row?.value === undefined ? undefined : JSON.parse(row.value)
}

async function importLog(id: number, profileId: number, bankFormats: string): Promise<void> {
  await (
    await getDB()
  ).put('import_logs', {
    id,
    profile_id: profileId,
    source: 'statement.csv',
    imported: 3,
    bank_formats: bankFormats,
    created_at: `2026-03-0${id}T09:00:00.000Z`,
  })
}

async function open(): Promise<void> {
  const { AboutThisSpace } = await import('../AboutThisSpace')
  dispose = render(() => <AboutThisSpace />, host)
  // The first load: the settings and the import logs.
  await new Promise((resolve) => setTimeout(resolve, 50))
}

describe('About this space', () => {
  it('shows the answers, and that the region is the answer', async () => {
    await seed({ region: 'HR', adults: 2, children: 1 })
    await open()
    await vi.waitFor(() => {
      expect(radio('region-HR').checked).toBe(true)
    })
    expect(radio('adults-2').checked).toBe(true)
    expect(radio('children-1').checked).toBe(true)
    expect(regionNote()).toBe('Compared with Croatia, from your answer.')
    expect(householdNote()).toBe('2 adults, 1 child.')
    expect(byTestId('settings-space-region-ask-again')).not.toBeNull()
    expect(byTestId('settings-space-household-ask-again')).not.toBeNull()
  })

  it("goes by this profile's bank statements when the question was skipped", async () => {
    await seed({ region: 'skipped' })
    await importLog(1, 1, 'dkb')
    await importLog(2, 1, 'erste')
    await importLog(3, 1, 'sparkasse')
    // The partner's Croatian statements are the partner's.
    await importLog(4, 2, 'pbz')
    await importLog(5, 2, 'erste')
    localStorage.setItem('selectedProfileIds', '[1,2]')
    await open()
    await vi.waitFor(() => {
      expect(regionNote()).toBe(
        'You skipped this in setup. Compared with Germany, going by your Sparkasse statements.'
      )
    })
    expect(host.querySelectorAll('input:checked')).toHaveLength(0)
  })

  it('goes by the base currency, and says when nothing says where', async () => {
    localStorage.setItem('localCurrency', 'GBP')
    await open()
    await vi.waitFor(() => {
      expect(regionNote()).toBe(
        'Not answered yet. Compared with the United Kingdom, going by your base currency, GBP.'
      )
    })
    expect(householdNote()).toBe('Not answered yet.')
    expect(byTestId('settings-space-region-ask-again')).toBeNull()
    dispose?.()

    localStorage.setItem('localCurrency', 'JPY')
    await open()
    await vi.waitFor(() => {
      expect(regionNote()).toBe(
        'Not answered yet. Compared with the EU average, as nothing yet says where you live.'
      )
    })
  })

  it('saves a choice on the record as it is now, keeping an answer given meanwhile', async () => {
    await seed({ tenure: 'rent_private' })
    await open()
    // Another tab answers the household question after this one loaded.
    await seed({ tenure: 'rent_private', adults: 1 })

    chip('region-DE').click()

    await vi.waitFor(async () => {
      expect(await stored()).toEqual({ tenure: 'rent_private', adults: 1, region: 'DE' })
    })
    await vi.waitFor(() => {
      expect(regionNote()).toBe('Compared with Germany, from your answer.')
    })
    expect(radio('adults-1').checked).toBe(true)
  })

  it('clears an answer with Remove answer', async () => {
    await seed({ region: 'US', adults: 2, children: 0 })
    await open()
    await vi.waitFor(() => {
      expect(byTestId('settings-space-region-ask-again')).not.toBeNull()
    })
    expect(householdNote()).toBe('2 adults, no children.')
    // It says what it does: the answer goes, and nothing asks again then.
    for (const question of ['region', 'household'])
      expect(byTestId(`settings-space-${question}-ask-again`)!.textContent?.trim()).toBe(
        'Remove answer'
      )
    // Each is described by its question, so the two read apart: what aria-describedby points at.
    const description = (button: HTMLElement) =>
      (button.getAttribute('aria-describedby') ?? '')
        .split(/\s+/)
        .filter(Boolean)
        .map((ref) => document.getElementById(ref)?.textContent?.trim() ?? '')
        .join(' ')
    expect(description(byTestId('settings-space-region-ask-again')!)).toBe('Where do you live?')
    expect(description(byTestId('settings-space-household-ask-again')!)).toBe(
      'Who does this space cover?'
    )

    byTestId('settings-space-region-ask-again')!.click()
    await vi.waitFor(async () => {
      expect(await stored()).toEqual({ adults: 2, children: 0 })
    })
    // The region's line then says what the numbers are compared with now.
    await vi.waitFor(() => {
      expect(regionNote()).toBe(
        'Not answered yet. Compared with the EU average, going by your base currency, EUR.'
      )
    })
    byTestId('settings-space-household-ask-again')!.click()
    await vi.waitFor(async () => {
      expect(await stored()).toEqual({})
    })
    await vi.waitFor(() => {
      expect(householdNote()).toBe('Not answered yet.')
    })
    expect(regionNote()).toBe(
      'Not answered yet. Compared with the EU average, going by your base currency, EUR.'
    )
  })

  it('says what a half-answered household holds, and Remove answer clears it', async () => {
    await seed({ adults: 3 })
    await open()
    await vi.waitFor(() => {
      expect(householdNote()).toBe('3 or more adults. Children not answered yet.')
    })

    chip('children-1').click()
    await vi.waitFor(() => {
      expect(householdNote()).toBe('3 or more adults, 1 child.')
    })
    await vi.waitFor(async () => {
      expect(await stored()).toEqual({ adults: 3, children: 1 })
      expect((byTestId('settings-space-household-ask-again') as HTMLButtonElement).disabled).toBe(
        false
      )
    })
    byTestId('settings-space-household-ask-again')!.click()
    await vi.waitFor(() => {
      expect(householdNote()).toBe('Not answered yet.')
    })
    await vi.waitFor(async () => {
      expect(await stored()).toEqual({})
    })
    expect(byTestId('settings-space-household-ask-again')).toBeNull()

    await seed({ children: 0 })
    dispose?.()
    await open()
    await vi.waitFor(() => {
      expect(householdNote()).toBe('Adults not answered yet. No children.')
    })
  })

  it('says a save failed, and shows the answer from before', async () => {
    await seed({ region: 'UK' })
    await open()
    vi.spyOn(api, 'updateSettings').mockRejectedValueOnce(new Error('offline'))

    chip('region-HR').click()

    await vi.waitFor(() => {
      expect(byTestId('about-this-space-problem')?.textContent).toBe(
        "Couldn't save your answer. Try again."
      )
    })
    expect(radio('region-UK').checked).toBe(true)
    expect(await stored()).toEqual({ region: 'UK' })
  })

  it('shows the answers of the profile opened next', async () => {
    await seed({ region: 'HR' })
    await seed({ region: 'elsewhere', children: 2 }, 'guidance:2')
    await open()
    await vi.waitFor(() => {
      expect(radio('region-HR').checked).toBe(true)
    })

    localStorage.setItem('currentProfileId', '2')
    bumpProfileVersion()

    await vi.waitFor(() => {
      expect(radio('region-elsewhere').checked).toBe(true)
    })
    expect(radio('children-2').checked).toBe(true)
    expect(regionNote()).toBe(
      'Compared with the EU average. Token Circles has figures for Germany, Croatia, the EU, the United Kingdom and the United States.'
    )
  })
})
