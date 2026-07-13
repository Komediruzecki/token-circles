/**
 * Subscription Catalog — a curated seed of common subscriptions so a user can
 * add ten at once instead of filling ten forms. Names are chosen to match the
 * brand system in `subscriptionBrands` (so each arrives with its mark, colour
 * and a sensible category), grouped by kind and searchable.
 *
 * Prices are TYPICAL starting points (per month, in the user's currency) meant
 * to be adjusted — never claimed as live. Streaming prices in particular move
 * constantly, so the catalog seeds a number and lets the user correct it.
 */

export interface CatalogItem {
  name: string
  /** Typical monthly price — a starting point the user adjusts. */
  price: number
  /** Optional tier note shown under the name (e.g. "Standard"). */
  tier?: string
  /** Candidate category names, tried in order against the user's categories. */
  categoryHints: string[]
}

export interface CatalogGroup {
  label: string
  items: CatalogItem[]
}

const SUBS = ['Subscriptions', 'Subscription', 'Entertainment']
const ENT = ['Entertainment', 'Subscriptions']
const HEALTH = ['Health', 'Fitness', 'Subscriptions']
const UTIL = ['Utilities', 'Subscriptions']

export const SUBSCRIPTION_CATALOG: CatalogGroup[] = [
  {
    label: 'Streaming',
    items: [
      { name: 'Netflix', price: 13.99, tier: 'Standard', categoryHints: ENT },
      { name: 'Disney+', price: 9.99, categoryHints: ENT },
      { name: 'Amazon Prime', price: 8.99, categoryHints: ENT },
      { name: 'HBO Max', price: 9.99, categoryHints: ENT },
      { name: 'Hulu', price: 7.99, categoryHints: ENT },
      { name: 'YouTube Premium', price: 12.99, categoryHints: ENT },
      { name: 'Apple TV+', price: 9.99, categoryHints: ENT },
      { name: 'Paramount+', price: 8.99, categoryHints: ENT },
      { name: 'Twitch', price: 8.99, categoryHints: ENT },
    ],
  },
  {
    label: 'Music',
    items: [
      { name: 'Spotify', price: 11.99, tier: 'Premium', categoryHints: ENT },
      { name: 'Apple Music', price: 10.99, categoryHints: ENT },
      { name: 'YouTube Music', price: 10.99, categoryHints: ENT },
      { name: 'Tidal', price: 10.99, categoryHints: ENT },
    ],
  },
  {
    label: 'Cloud & Storage',
    items: [
      { name: 'iCloud+', price: 2.99, categoryHints: SUBS },
      { name: 'Google One', price: 1.99, categoryHints: SUBS },
      { name: 'Dropbox', price: 11.99, categoryHints: SUBS },
      { name: 'OneDrive', price: 2.0, categoryHints: SUBS },
    ],
  },
  {
    label: 'Software & Productivity',
    items: [
      { name: 'Notion', price: 9.5, categoryHints: SUBS },
      { name: 'Adobe Creative Cloud', price: 59.99, categoryHints: SUBS },
      { name: 'Microsoft 365', price: 6.99, categoryHints: SUBS },
      { name: 'Google Workspace', price: 6.0, categoryHints: SUBS },
      { name: '1Password', price: 2.99, categoryHints: SUBS },
      { name: 'Grammarly', price: 12.0, categoryHints: SUBS },
    ],
  },
  {
    label: 'AI',
    items: [
      { name: 'ChatGPT Plus', price: 22.0, categoryHints: SUBS },
      { name: 'Claude Pro', price: 18.0, categoryHints: SUBS },
      { name: 'GitHub Copilot', price: 10.0, categoryHints: SUBS },
      { name: 'Midjourney', price: 10.0, categoryHints: SUBS },
    ],
  },
  {
    label: 'Gaming',
    items: [
      { name: 'Xbox Game Pass', price: 12.99, categoryHints: ENT },
      { name: 'PlayStation Plus', price: 8.99, categoryHints: ENT },
      { name: 'Nintendo Online', price: 3.99, categoryHints: ENT },
      { name: 'Discord Nitro', price: 9.99, categoryHints: ENT },
    ],
  },
  {
    label: 'News & Reading',
    items: [
      { name: 'NYTimes', price: 4.25, categoryHints: SUBS },
      { name: 'Audible', price: 9.95, categoryHints: ENT },
      { name: 'Kindle Unlimited', price: 9.99, categoryHints: ENT },
      { name: 'Medium', price: 5.0, categoryHints: SUBS },
    ],
  },
  {
    label: 'Health & Fitness',
    items: [
      { name: 'Gym membership', price: 29.99, categoryHints: HEALTH },
      { name: 'Peloton', price: 12.99, categoryHints: HEALTH },
      { name: 'Strava', price: 11.99, categoryHints: HEALTH },
      { name: 'Headspace', price: 12.99, categoryHints: HEALTH },
      { name: 'Calm', price: 14.99, categoryHints: HEALTH },
    ],
  },
  {
    label: 'Utilities',
    items: [
      { name: 'Internet', price: 45.0, categoryHints: UTIL },
      { name: 'Mobile plan', price: 25.0, categoryHints: UTIL },
    ],
  },
]

/** Flat list of every catalog item (handy for search + counts). */
export const CATALOG_ITEMS: CatalogItem[] = SUBSCRIPTION_CATALOG.flatMap((g) => g.items)
