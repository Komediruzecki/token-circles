/**
 * The circles are worked out for the active profile (core/guidance.ts), while the Dashboard around
 * the savings gauge and Your next step adds up every profile selected (`householdProfileIds`). With
 * more than one selected, the two cards name the profile they are about, so a household's totals
 * beside one profile's rate never read as the same numbers. With one, the whole page is that
 * profile, and neither names it.
 *
 * Profiles are often places or purposes ("Holiday house", "Side business"), so the cards say
 * "For Holiday house only" rather than putting the name in a possessive.
 */
export function circlesProfileName(
  profileId: number,
  selected: readonly number[],
  profiles: readonly { id: number; name: string }[]
): string | null {
  if (new Set(selected).size < 2) return null
  const name = profiles.find((profile) => profile.id === profileId)?.name.trim()
  return name ? name : null
}

/** What the two cards say under their heading. */
export const circlesProfileLine = (name: string): string => `For ${name} only`
