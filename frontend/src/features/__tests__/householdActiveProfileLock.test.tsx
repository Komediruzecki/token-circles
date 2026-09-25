/**
 * Settings > Household view: the active profile's box is locked, and says why.
 *
 * The active profile is where new transactions, categories and accounts are saved, so it is always
 * part of the household (#575 made that an invariant at read time and in the toggle). The box
 * still looked clickable, though: a click was silently undone, which read as a bug. It is now
 * disabled, with the reason on hover and for screen readers, and an "Active" badge marks the row.
 *
 * The badge replaces one that said "Current" on every row whenever exactly one profile was ticked
 * — it never checked which profile it was on.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bumpProfileVersion } from '../../core/appStore'
import { setSettingsTab } from '../../core/settingsStore'

const PROFILES = [
  { id: 1, name: 'Personal' },
  { id: 2, name: 'Family' },
  { id: 3, name: 'Business' },
]

vi.mock('../../core/apiFetch', () => ({
  apiFetch: vi.fn(
    async (url: string) =>
      new Response(JSON.stringify(url.startsWith('/api/profiles') ? PROFILES : {}), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
  ),
}))

const flush = () => new Promise((r) => setTimeout(r, 0))
const settle = async () => {
  for (let i = 0; i < 4; i++) await flush()
}

let host: HTMLDivElement
let dispose: (() => void) | undefined

beforeEach(() => {
  localStorage.clear()
  Element.prototype.scrollIntoView = () => {}
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  }))
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(() => {
  dispose?.()
  host.remove()
  vi.unstubAllGlobals()
  localStorage.clear()
})

/** Mount Settings on the tab that holds the household list, as the given active profile. */
async function openHousehold(active: number, selected: number[]) {
  localStorage.setItem('currentProfileId', String(active))
  localStorage.setItem('selectedProfileIds', JSON.stringify(selected))
  setSettingsTab('exports')
  const { default: Settings } = await import('../Settings')
  dispose = render(() => <Settings />, host)
  await settle()
}

const row = (id: number) =>
  host.querySelector<HTMLLabelElement>(`[data-test-id="household-profile-${id}"]`)!
const box = (id: number) => row(id).querySelector<HTMLInputElement>('input[type="checkbox"]')!
const badge = (id: number) => row(id).querySelector('[data-test-id="household-active-badge"]')

describe('the household list locks the active profile', () => {
  it('disables the active profile, keeps it ticked, and explains why', async () => {
    await openHousehold(2, [2, 3])

    expect(box(2).disabled).toBe(true)
    expect(box(2).checked).toBe(true)

    // The reason is on the row, because a disabled input receives no mouse events of its own, and
    // it is wired to the box for screen readers.
    const hintId = box(2).getAttribute('aria-describedby')
    expect(hintId).toBe('household-locked-hint')
    const hint = host.querySelector(`#${hintId}`)!.textContent!
    expect(hint).toContain('active profile')
    expect(hint).toContain('switch profiles in the sidebar')
    expect(row(2).title).toBe(hint)

    // Every other profile stays a normal checkbox.
    expect(box(3).disabled).toBe(false)
    expect(box(3).checked).toBe(true)
    expect(box(1).disabled).toBe(false)
    expect(box(1).checked).toBe(false)
    expect(box(1).hasAttribute('aria-describedby')).toBe(false)
    expect(row(1).title).toBe('')
  })

  it('shows the Active badge on the active profile only', async () => {
    // One profile ticked: the old badge appeared on every row in exactly this state.
    await openHousehold(2, [2])

    expect(badge(2)?.textContent).toContain('Active')
    expect(badge(1)).toBeNull()
    expect(badge(3)).toBeNull()
  })

  it('shows the active profile ticked even when an old stored selection left it out', async () => {
    // Selections saved before #575 can exclude the active profile. Reads include it regardless,
    // so the list must not show it as excluded.
    await openHousehold(2, [3])

    expect(box(2).checked).toBe(true)
    expect(box(2).disabled).toBe(true)
  })

  it('moves the lock when the profile is switched in the sidebar', async () => {
    await openHousehold(2, [2, 3])

    // What the sidebar's selectProfile() does: switch, select only that profile, bump.
    localStorage.setItem('currentProfileId', '3')
    localStorage.setItem('selectedProfileIds', JSON.stringify([3]))
    bumpProfileVersion()
    await settle()

    expect(box(3).disabled).toBe(true)
    expect(box(3).checked).toBe(true)
    expect(badge(3)).not.toBeNull()
    // Re-read from storage, so the page agrees with what the sidebar just set.
    expect(box(2).disabled).toBe(false)
    expect(box(2).checked).toBe(false)
    expect(badge(2)).toBeNull()
  })

  it('still lets the other profiles be toggled', async () => {
    await openHousehold(2, [2, 3])

    box(3).click()
    await settle()

    expect(box(3).checked).toBe(false)
    expect(JSON.parse(localStorage.getItem('selectedProfileIds')!)).toEqual([2])
  })
})
