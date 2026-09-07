/**
 * Mounted once in App: refreshes the badges on profile change and, debounced, after any data
 * change the api client reports; renders the badges panel.
 */
import { createEffect, on, onCleanup, onMount } from 'solid-js'
import { DATA_CHANGED_EVENT, refreshAchievements } from '../core/achievementsStore'
import { useAppState } from '../core/appStore'
import BadgesPanel from './BadgesPanel'
import type { JSX } from 'solid-js'

const DEBOUNCE_MS = 1200

export default function AchievementsHost(): JSX.Element {
  const state = useAppState()
  let timer: ReturnType<typeof setTimeout> | undefined
  const schedule = (): void => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      refreshAchievements().catch(() => undefined)
    }, DEBOUNCE_MS)
  }
  createEffect(
    on([() => state.profileVersion, () => state.currentProfile?.id], ([, id]) => {
      if (id !== undefined && id !== null) schedule()
    })
  )
  onMount(() => {
    window.addEventListener(DATA_CHANGED_EVENT, schedule)
  })
  onCleanup(() => {
    window.removeEventListener(DATA_CHANGED_EVENT, schedule)
    clearTimeout(timer)
  })
  return <BadgesPanel />
}
