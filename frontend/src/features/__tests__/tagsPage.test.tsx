/**
 * Tags page interaction, driven through the real component.
 *
 * Every bug pinned here was a wiring mistake — a call site forgetting a setter, an effect firing
 * on the wrong dependency, a button that only did half its job. None of them would survive
 * contact with a test that re-implements the logic instead of running it, which is why this file
 * mounts the page and clicks the buttons.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { showConfirm as ShowConfirm } from '../../core/confirmStore'

const tag = (id: number, name: string, rule_count = 0) => ({
  id,
  name,
  color: '#6e9bff',
  income: 0,
  expense: 0,
  net: 0,
  count: 0,
  rule_count,
})

/** The server's tag list. Mutable, so a delete can actually remove one. */
let serverTags = [tag(1, 'Company'), tag(2, 'Travel')]

const updateTag = vi.fn(async () => ({ ok: true }))
const getTagSummary = vi.fn(async () => ({ monthly: [], categories: [], totals: null }))
const deleteTag = vi.fn(async (id: number) => {
  serverTags = serverTags.filter((t) => t.id !== id)
  return { ok: true }
})

vi.mock('../../core/api', () => ({
  api: {
    getTagsSummary: vi.fn(async () => serverTags),
    getTagRules: vi.fn(async () => []),
    getCategories: vi.fn(async () => []),
    getAccounts: vi.fn(async () => []),
    getTagSummary,
    updateTag,
    createTag: vi.fn(async () => ({ id: 3, name: 'New', color: '#fff' })),
    deleteTag,
  },
  formatCurrency: (n: number) => String(n),
  showToast: vi.fn(),
}))

// ConfirmButton asks the shared modal; auto-confirm so a delete goes straight through.
vi.mock('../../core/confirmStore', async (importOriginal) => ({
  ...(await importOriginal<{ showConfirm: typeof ShowConfirm }>()),
  showConfirm: vi.fn(async () => true),
}))

// The chart needs a canvas; the page under test only cares that it mounts.
vi.mock('../../components/Chart', () => ({ default: () => null }))

let host: HTMLDivElement
let dispose: (() => void) | undefined

const flush = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  serverTags = [tag(1, 'Company'), tag(2, 'Travel')]
  for (const spy of [updateTag, deleteTag, getTagSummary]) spy.mockClear()
  // jsdom implements neither of these. The page scrolls the rules section into view after
  // opening it, and OrbitalDivider asks about prefers-reduced-motion on mount.
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
  host?.remove()
  vi.unstubAllGlobals()
})

async function mountTags() {
  const { default: Tags } = await import('../Tags')
  dispose = render(() => <Tags />, host)
  await flush()
  await flush()
  return host
}

const byText = (root: HTMLElement, text: string) =>
  [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)

const nameInput = (root: HTMLElement) =>
  root.querySelector<HTMLInputElement>('[data-test-id="tag-name-input"]')

describe('the tag edit form', () => {
  it('closes after a successful save, revealing the renamed card', async () => {
    const root = await mountTags()

    byText(root, 'Edit')!.click()
    await flush()
    const input = nameInput(root)
    expect(input, 'edit form should be open').not.toBeNull()

    input!.value = 'Renamed'
    input!.dispatchEvent(new Event('input', { bubbles: true }))
    byText(root, 'Save')!.click()
    await flush()
    await flush()

    expect(updateTag).toHaveBeenCalledWith(1, 'Renamed', expect.any(String))
    expect(nameInput(root), 'form should be gone after saving').toBeNull()
  })

  it('closes on cancel too', async () => {
    const root = await mountTags()

    byText(root, 'Edit')!.click()
    await flush()
    expect(nameInput(root)).not.toBeNull()

    byText(root, 'Cancel')!.click()
    await flush()

    expect(nameInput(root)).toBeNull()
    expect(updateTag).not.toHaveBeenCalled()
  })
})

describe('selecting a tag', () => {
  it('selects a lone tag on arrival, so its rules are not hidden behind a click', async () => {
    serverTags = [tag(1, 'Company')]
    const root = await mountTags()
    expect(root.textContent).toContain('Rules for Company')
  })

  it('leaves a lone tag deselected once the user deselects it', async () => {
    serverTags = [tag(1, 'Company')]
    const root = await mountTags()
    expect(root.textContent).toContain('Rules for Company')

    // Clicking the selected card again deselects. As a standing "nothing selected → select the
    // lone tag" invariant, the auto-select re-ran on that very change and put it straight back.
    root.querySelector<HTMLButtonElement>('[data-test-id="tag-card-1"] button')!.click()
    await flush()
    await flush()

    expect(root.textContent).not.toContain('Rules for Company')
  })

  it('does not ask for the summary of a tag it has just deleted', async () => {
    // Deleting your only tag clears the selection while the tag list is still stale (its refetch
    // is in flight). The auto-select saw one tag and nothing selected, re-selected the tag that
    // had just been deleted, and the detail resource fetched a summary for it — surfacing as
    // "Tag not found" right after a successful delete.
    serverTags = [tag(1, 'Company')]
    const root = await mountTags()
    getTagSummary.mockClear()

    byText(root, 'Delete')!.click()
    await flush()
    await flush()
    await flush()

    expect(deleteTag).toHaveBeenCalledWith(1)
    expect(getTagSummary).not.toHaveBeenCalled()
    expect(root.textContent).toContain('No tags yet')
  })
})

describe('the rules button on a tag card', () => {
  const editor = (root: HTMLElement) => root.querySelector('[data-test-id="tag-rule-editor"]')

  it('opens the rule editor when the tag has no rules yet', async () => {
    serverTags = [tag(1, 'Company')]
    const root = await mountTags()
    expect(editor(root)).toBeNull()

    root.querySelector<HTMLButtonElement>('[data-test-id="tag-rules-1"]')!.click()
    await flush()

    // It used to only select and scroll, landing on "No rules yet" and a second Add rule button —
    // on a tag you were already looking at, that was indistinguishable from nothing happening.
    expect(editor(root)).not.toBeNull()
  })

  it('opens the editor for the card clicked, not whichever tag was selected', async () => {
    const root = await mountTags()
    // Company (id 1) is not auto-selected — there are two tags. Ask Travel (id 2) for a rule.
    root.querySelector<HTMLButtonElement>('[data-test-id="tag-rules-2"]')!.click()
    await flush()
    await flush()

    expect(editor(root)).not.toBeNull()
    expect(root.textContent).toContain('Rules for Travel')
  })

  it('closes an open draft when you switch to a different tag', async () => {
    // A draft left open across a switch sits under the new tag's heading and reads as belonging
    // to it. Save/preview/apply act on the draft's own tagId, so the data was never at risk —
    // this is about not showing one tag's half-written rule under another tag's name.
    const root = await mountTags()
    root.querySelector<HTMLButtonElement>('[data-test-id="tag-rules-1"]')!.click()
    await flush()
    expect(editor(root)).not.toBeNull()

    root.querySelector<HTMLButtonElement>('[data-test-id="tag-card-2"] button')!.click()
    await flush()
    await flush()

    expect(editor(root)).toBeNull()
    expect(root.textContent).toContain('Rules for Travel')
  })

  it('shows the existing rules rather than a blank editor when the tag has some', async () => {
    serverTags = [tag(1, 'Company', 2)]
    const root = await mountTags()

    root.querySelector<HTMLButtonElement>('[data-test-id="tag-rules-1"]')!.click()
    await flush()

    expect(editor(root)).toBeNull()
    expect(root.textContent).toContain('Rules for Company')
  })
})
