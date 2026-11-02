/**
 * Getting started's facts (core/orientation.ts), worked out once per badge evaluation and shared by
 * everything that reads them for it.
 *
 * While less than a year is on file, Dashboard shows Getting started's card, and the circles' store
 * (core/guidance.ts) reads the same steps for Your next step. Both read the facts after the page
 * has painted, for the same evaluation, and the subscription scan inside them is most of what
 * either costs: about 96 ms at 3,000 entries. Working them out once halves that.
 *
 * Keyed by the snapshot object itself: every data change makes a new one, so facts are never kept
 * past the evaluation they came from, and go with it. The scan's window ends at the clock of the
 * first reader, as it would have for that reader alone.
 */
import { orientationFacts } from './orientation'
import type { OrientationFacts } from '../../../shared/orientation'
import type { AchievementsSnapshot } from './achievementsStore'

const worked = new WeakMap<AchievementsSnapshot, OrientationFacts>()

/** The facts for `snap`, worked out the first time anyone asks for them. */
export function orientationFactsOnce(snap: AchievementsSnapshot): OrientationFacts {
  const known = worked.get(snap)
  if (known !== undefined) return known
  const facts = orientationFacts(snap, Date.now())
  worked.set(snap, facts)
  return facts
}
