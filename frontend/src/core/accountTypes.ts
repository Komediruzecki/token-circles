/**
 * How the pages show an account's type.
 *
 * The reader keeps a type this build does not have as it is (`storedAccountType` in
 * shared/accountSchema.ts): one a later build adds, or one an API client stored before the writers
 * checked. The pages show such an account as a plain one: the word "account", with no type's icon
 * or colour. An edit sends the stored type back unchanged, so opening one here changes nothing.
 */
import { isAccountType, storedAccountType } from '../../../shared/accountSchema'
import type { AccountType } from '../../../shared/accountSchema'

/** What the type badge says for an account of a type this build does not have. */
export const PLAIN_ACCOUNT = 'account'

/**
 * The type, when it is one this build has, a type v4 renamed read as the one that replaced it (a
 * page that reads accounts without the checked reader gets the stored value); null for a plain
 * account.
 */
export function knownAccountType(type: unknown): AccountType | null {
  const read = storedAccountType(type)
  return isAccountType(read) ? read : null
}

/** The word a type badge shows: the type as the pages have always shown it, or "account". */
export function accountTypeBadge(type: unknown): string {
  return knownAccountType(type) ?? PLAIN_ACCOUNT
}

/** The badge colour each type has on the Accounts page; a plain account has the plain one. */
export type AccountTypeTone = 'primary' | 'success' | 'info' | 'warning' | 'default'

const TONES: Readonly<Record<AccountType, AccountTypeTone>> = {
  giro: 'primary',
  savings: 'success',
  ib: 'info',
  cash: 'warning',
}

export function accountTypeTone(type: unknown): AccountTypeTone {
  const known = knownAccountType(type)
  return known ? TONES[known] : 'default'
}

/** The SVG path of each type's icon on an Accounts card (24 x 24, stroked). */
const ICONS: Readonly<Record<AccountType, string>> = {
  giro: 'M3 21h18M3 10h18M5 6l7-3 7 3M4 10v11m16-11v11M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01',
  savings:
    'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  ib: 'M13 17V9m-4 8v-4m8 4v-2M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  cash: 'M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z',
}

/** A plain account's icon: a briefcase. */
const PLAIN_ACCOUNT_ICON =
  'M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z'

export function accountTypeIcon(type: unknown): string {
  const known = knownAccountType(type)
  return known ? ICONS[known] : PLAIN_ACCOUNT_ICON
}
