import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, describe, expect, it, vi } from 'vitest'
import BulkActionBar from '../BulkActionBar'

let host: HTMLDivElement
let dispose: () => void

afterEach(() => {
  dispose?.()
  host?.remove()
})

const TAGS = [
  { id: 1, name: 'Company', color: '#6e9bff' },
  { id: 2, name: 'Travel', color: '#f0a860' },
]

function mount(overrides: Partial<Parameters<typeof BulkActionBar>[0]> = {}) {
  host = document.createElement('div')
  document.body.appendChild(host)
  const [count, setCount] = createSignal(0)
  const [tagList, setTagList] = createSignal(TAGS)
  const onApplyTags = vi.fn()
  const onCreateTag = vi.fn(async (name: string) => ({ id: 99, name, color: '#123456' }))
  dispose = render(
    () => (
      <BulkActionBar
        selectedCount={count()}
        categories={[]}
        tags={tagList()}
        onClearSelection={() => {}}
        onDeleteSelected={() => {}}
        onReconcileSelected={() => {}}
        onChangeCategory={() => {}}
        onChangeType={() => {}}
        onApplyTags={onApplyTags}
        onCreateTag={onCreateTag}
        {...overrides}
      />
    ),
    host
  )
  return { setCount, setTagList, onApplyTags, onCreateTag }
}

describe('BulkActionBar — bulk tagging', () => {
  it('appears once a selection exists, having started empty', () => {
    // The bar mounts while nothing is selected (that is how Transactions renders it) and must
    // still show up when the user selects rows — otherwise every bulk action, Tag included, is
    // unreachable in the real app no matter how well the handler works.
    const { setCount } = mount()
    expect(host.querySelector('[data-test-id="bulk-action-bar"]')).toBeNull()

    setCount(3)
    expect(host.querySelector('[data-test-id="bulk-action-bar"]')).not.toBeNull()
    expect(host.querySelector('[data-test-id="bulk-tag-btn"]')).not.toBeNull()
  })

  it('adds the picked tags across the selection', () => {
    const { setCount, onApplyTags } = mount()
    setCount(2)
    host.querySelector<HTMLButtonElement>('[data-test-id="bulk-tag-btn"]')!.click()

    const chips = host.querySelectorAll<HTMLButtonElement>('[data-test-id="bulk-tag-chips"] button')
    expect(chips).toHaveLength(2)
    chips[0].click()

    const apply = host.querySelector<HTMLButtonElement>('[data-test-id="bulk-tag-apply"]')!
    expect(apply.textContent?.trim()).toBe('Add tags')
    apply.click()
    expect(onApplyTags).toHaveBeenCalledWith([1], 'add')
  })

  it('switches to remove mode', () => {
    const { setCount, onApplyTags } = mount()
    setCount(2)
    host.querySelector<HTMLButtonElement>('[data-test-id="bulk-tag-btn"]')!.click()
    ;[...host.querySelectorAll<HTMLButtonElement>('button')]
      .find((b) => b.textContent?.trim() === 'Remove')!
      .click()
    host.querySelectorAll<HTMLButtonElement>('[data-test-id="bulk-tag-chips"] button')[1].click()
    const apply = host.querySelector<HTMLButtonElement>('[data-test-id="bulk-tag-apply"]')!
    expect(apply.textContent?.trim()).toBe('Remove tags')
    apply.click()
    expect(onApplyTags).toHaveBeenCalledWith([2], 'remove')
  })

  it('does not apply when no tag is picked', () => {
    const { setCount, onApplyTags } = mount()
    setCount(2)
    host.querySelector<HTMLButtonElement>('[data-test-id="bulk-tag-btn"]')!.click()
    const apply = host.querySelector<HTMLButtonElement>('[data-test-id="bulk-tag-apply"]')!
    expect(apply.disabled).toBe(true)
    apply.click()
    expect(onApplyTags).not.toHaveBeenCalled()
  })

  it('does not reopen a modal that was open when the selection emptied', () => {
    const { setCount } = mount()
    setCount(2)
    host.querySelector<HTMLButtonElement>('[data-test-id="bulk-tag-btn"]')!.click()
    expect(host.querySelector('[data-test-id="bulk-tag-modal"]')).not.toBeNull()

    // Clearing the selection hides the bar and its modal...
    setCount(0)
    expect(host.querySelector('[data-test-id="bulk-tag-modal"]')).toBeNull()

    // ...and selecting again must show the bar WITHOUT springing the modal back open.
    setCount(3)
    expect(host.querySelector('[data-test-id="bulk-action-bar"]')).not.toBeNull()
    expect(host.querySelector('[data-test-id="bulk-tag-modal"]')).toBeNull()
  })

  it('picks up a tag created elsewhere without remounting', () => {
    // The reported bug: a tag created on the Tags page did not reach this modal, which kept
    // saying "No tags yet". The page-level cause was a mount-only fetch (now keyed on
    // tagsVersion); this pins the component half — the chip list must track the prop, not latch
    // whatever it was handed first.
    const { setCount, setTagList } = mount()
    setTagList([])
    setCount(1)
    host.querySelector<HTMLButtonElement>('[data-test-id="bulk-tag-btn"]')!.click()
    expect(host.querySelector('[data-test-id="bulk-tag-chips"]')).toBeNull()
    expect(host.textContent).toContain('No tags yet')

    setTagList([{ id: 5, name: 'Company', color: '#6e9bff' }])
    const chips = host.querySelectorAll<HTMLButtonElement>('[data-test-id="bulk-tag-chips"] button')
    expect(chips).toHaveLength(1)
    expect(chips[0].textContent).toContain('Company')
  })

  it('creates a tag inline and pre-selects it', async () => {
    const { setCount, onCreateTag, onApplyTags } = mount()
    setCount(1)
    host.querySelector<HTMLButtonElement>('[data-test-id="bulk-tag-btn"]')!.click()
    const input = host.querySelector<HTMLInputElement>('[data-test-id="bulk-tag-new-input"]')!
    input.value = 'Freelance'
    // Solid delegates input/click at the document root, so the event has to bubble to be seen.
    input.dispatchEvent(new Event('input', { bubbles: true }))
    const create = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent?.trim() === 'Create'
    )!
    create.click()
    await Promise.resolve()
    expect(onCreateTag).toHaveBeenCalledWith('Freelance')
    // The new tag is selected straight away, so Add tags applies it without a second click.
    host.querySelector<HTMLButtonElement>('[data-test-id="bulk-tag-apply"]')!.click()
    expect(onApplyTags).toHaveBeenCalledWith([99], 'add')
  })
})
