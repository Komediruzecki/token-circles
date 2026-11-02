/**
 * What the Categories dialog's form sends (categoryForm.ts, `kinds: true`): an edit sends a kind
 * or "Needed every month" only when the person changed it, so whatever it leaves out the server
 * keeps (both runtimes patch only the fields sent). A kind only a later build knows, which this
 * build cannot show, survives a change of colour. Invented values.
 */
import { createRoot } from 'solid-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const sent: Record<string, unknown>[] = []
vi.mock('../../core/api', () => ({
  apiPost: vi.fn(async (_url: string, body: Record<string, unknown>) => {
    sent.push(body)
    return { id: 9 }
  }),
  apiPut: vi.fn(async (_url: string, body: Record<string, unknown>) => {
    sent.push(body)
    return {}
  }),
  showToast: vi.fn(),
}))

import { createCategoryForm } from '../categoryForm'
import type { EditableCategory } from '../categoryForm'

const DOG: EditableCategory = {
  id: 5,
  name: 'Dog',
  type: 'expense',
  color: '#aabbcc',
  icon: 'paw',
  kind: 'pets',
  essential: 1,
}

beforeEach(() => {
  sent.length = 0
})

async function edit(
  category: EditableCategory,
  change: (form: ReturnType<typeof createCategoryForm>) => void
) {
  await createRoot(async (dispose) => {
    const form = createCategoryForm({
      color: '#123456',
      onSaved: () => {},
      kinds: true,
      editing: () => category,
    })
    form.open(category)
    change(form)
    await form.submit()
    dispose()
  })
  return sent[0]
}

describe('an edit', () => {
  it('of the colour sends neither the kind nor the box', async () => {
    const body = await edit(DOG, (form) => form.set('color', '#ddeeff'))
    expect(body).toMatchObject({ color: '#ddeeff' })
    expect(body).not.toHaveProperty('kind')
    expect(body).not.toHaveProperty('essential')
  })

  it('sends the kind picked, and the box changed', async () => {
    const body = await edit(DOG, (form) => {
      form.chooseKind('leisure')
      form.chooseEssential(false)
    })
    expect(body).toMatchObject({ kind: 'leisure', essential: 0 })
  })

  it('that ticks and unticks the box, ending as it opened, sends neither', async () => {
    const body = await edit(DOG, (form) => {
      form.chooseEssential(false)
      form.chooseEssential(true)
    })
    expect(body).not.toHaveProperty('kind')
    expect(body).not.toHaveProperty('essential')
  })
})
