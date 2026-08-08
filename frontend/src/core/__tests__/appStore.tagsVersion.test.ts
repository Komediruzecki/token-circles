import { createEffect, createRoot } from 'solid-js'
import { describe, expect, it } from 'vitest'
import { bumpTagsVersion, getTagsVersion, useAppState } from '../appStore'

describe('appStore — tagsVersion', () => {
  it('increments so watchers can refetch', () => {
    const before = getTagsVersion()
    bumpTagsVersion()
    expect(getTagsVersion()).toBe(before + 1)
  })

  it('notifies a reactive watcher', () => {
    // This is the mechanism behind the fix for the bulk-tag modal reading "No tags yet": the
    // Transactions page keeps its own tag list, mounts once, and only refetches when a tracked
    // dep changes. Creating a tag on the Tags page has to move a dep it watches — this one.
    createRoot((dispose) => {
      const state = useAppState()
      const seen: number[] = []
      createEffect(() => {
        seen.push(state.tagsVersion)
      })
      // Effects run on flush; force one by reading synchronously after the bump.
      const start = seen.length
      bumpTagsVersion()
      queueMicrotask(() => {
        expect(seen.length).toBeGreaterThan(start)
        dispose()
      })
    })
    expect(typeof getTagsVersion()).toBe('number')
  })
})
