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
