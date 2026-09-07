/**
 * The fifteen badges, three bands. Data only: rules live in evaluate.ts, art in
 * components/badgeGlyphs.ts. `share` is the one line on the share card.
 */
export type Band = 'beginnings' | 'building' | 'mastery'

export type AchievementId =
  | 'first-entry'
  | 'first-import'
  | 'first-budget'
  | 'named-everything'
  | 'goal-in-sight'
  | 'one-month'
  | 'a-quarter'
  | 'saver-x3'
  | 'held-the-line'
  | 'goal-reached'
  | 'half-a-year'
  | 'a-year'
  | 'saver-x6'
  | 'two-years'
  | 'own-the-stack'

export interface AchievementDef {
  id: AchievementId
  band: Band
  name: string
  /** How it is earned, as shown in the panel. */
  rule: string
  /** First-person line for the share card. */
  share: string
}

/** A month is tracked when it holds at least this many transactions dated inside it. */
export const TRACKED_MONTH_MIN_TRANSACTIONS = 3

export const BANDS: Record<Band, { label: string; rings: number }> = {
  beginnings: { label: 'Beginnings', rings: 1 },
  building: { label: 'Building', rings: 2 },
  mastery: { label: 'Mastery', rings: 3 },
}

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  {
    id: 'first-entry',
    band: 'beginnings',
    name: 'First entry',
    rule: 'One transaction.',
    share: 'Started tracking my money with Token Circles.',
  },
  {
    id: 'first-import',
    band: 'beginnings',
    name: 'First import',
    rule: 'One completed import.',
    share: 'Imported my first statement into Token Circles.',
  },
  {
    id: 'first-budget',
    band: 'beginnings',
    name: 'First budget',
    rule: 'One budget created.',
    share: 'Set my first budget in Token Circles.',
  },
  {
    id: 'named-everything',
    band: 'beginnings',
    name: 'Named everything',
    rule: 'A tracked month with nothing left uncategorised.',
    share: 'A whole month, every transaction categorised.',
  },
  {
    id: 'goal-in-sight',
    band: 'beginnings',
    name: 'A goal in sight',
    rule: 'One savings goal created.',
    share: 'Set a savings goal in Token Circles.',
  },
  {
    id: 'one-month',
    band: 'building',
    name: 'One month',
    rule: 'A tracked month: three or more transactions dated inside it.',
    share: 'Tracked my money for a month.',
  },
  {
    id: 'a-quarter',
    band: 'building',
    name: 'A quarter',
    rule: 'Three tracked months in a row.',
    share: 'Tracked my money for three months straight.',
  },
  {
    id: 'saver-x3',
    band: 'building',
    name: 'Saver x3',
    rule: 'Three consecutive months with income above spending.',
    share: 'Three months in a row in the black.',
  },
  {
    id: 'held-the-line',
    band: 'building',
    name: 'Held the line',
    rule: 'A full month with every budgeted category at or under budget.',
    share: 'A whole month with every budget held.',
  },
  {
    id: 'goal-reached',
    band: 'building',
    name: 'Goal reached',
    rule: 'One savings goal at 100%.',
    share: 'Reached a savings goal.',
  },
  {
    id: 'half-a-year',
    band: 'mastery',
    name: 'Half a year',
    rule: 'Six tracked months in a row.',
    share: 'Tracked my money for six months straight.',
  },
  {
    id: 'a-year',
    band: 'mastery',
    name: 'A year',
    rule: 'Twelve tracked months in a row.',
    share: 'Tracked my money for a year.',
  },
  {
    id: 'saver-x6',
    band: 'mastery',
    name: 'Saver x6',
    rule: 'Six consecutive months with income above spending.',
    share: 'Six months in a row in the black.',
  },
  {
    id: 'two-years',
    band: 'mastery',
    name: 'Two years',
    rule: 'Twenty-four tracked months in a row.',
    share: 'Tracked my money for two years.',
  },
  {
    id: 'own-the-stack',
    band: 'mastery',
    name: 'Own the stack',
    rule: 'Running against your own server, not ours.',
    share: 'Running Token Circles on my own stack.',
  },
]

export const achievementById = (id: AchievementId): AchievementDef =>
  ACHIEVEMENTS.find((a) => a.id === id) as AchievementDef
