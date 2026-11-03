/**
 * Every place the app lets a person choose an account type offers each type it has (`ACCOUNT_TYPES`
 * in shared/accountSchema.ts), in that order, and no other.
 *
 * WHY THIS GUARD EXISTS. A type is chosen in five places: the Accounts dialog, the transaction
 * form's new-account row, the import's mapping step, the setup wizard and setup's question about a
 * YNAB account that starts below zero. The last two of the five share one list
 * (features/import/accountTypeChoices.ts); the others have their own.
 * A list that misses a type leaves it to be made on the Accounts page alone (credit cards, when
 * they became a type); a list that offers one the writers refuse is a save that always fails.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ACCOUNT_TYPES } from '../../../shared/accountSchema'
import { IMPORT_ACCOUNT_TYPES } from '../features/import/accountTypeChoices'

const ACCOUNTS = join(import.meta.dirname, '..', 'features', 'Accounts.tsx')
const ACCOUNT_SELECT = join(import.meta.dirname, '..', 'components', 'AccountSelect.tsx')
const MAPPING = join(import.meta.dirname, '..', 'features', 'import', 'ImportMappingStep.tsx')
const WIZARD = join(import.meta.dirname, '..', 'components', 'onboarding', 'OnboardingWizard.tsx')
const FIRST_IMPORT = join(import.meta.dirname, '..', 'components', 'onboarding', 'FirstImport.tsx')

/** The option values of the first `<select>` after `marker` in `source`. */
function selectOptions(source: string, marker: string): string[] {
  const start = source.indexOf(marker)
  expect(start, marker).toBeGreaterThan(-1)
  const block = source.slice(start, source.indexOf('</select>', start))
  return [...block.matchAll(/<option value="([^"]+)"/g)].map((match) => match[1])
}

describe('an account type choice', () => {
  it.each([
    ['the Accounts dialog', () => readFileSync(ACCOUNTS, 'utf8'), 'name="type"'],
    [
      'the new-account row',
      () => readFileSync(ACCOUNT_SELECT, 'utf8'),
      'data-test-id="account-select-type"',
    ],
  ])('in %s offers every type the app has', (_, source, marker) => {
    expect(selectOptions(source(), marker)).toEqual([...ACCOUNT_TYPES])
  })

  it.each([
    ['the import mapping step', () => readFileSync(MAPPING, 'utf8'), 'accountTypeSelect'],
    [
      "setup's question about a YNAB account below zero",
      () => readFileSync(FIRST_IMPORT, 'utf8'),
      'onboarding-import-type',
    ],
  ])('in %s offers every type the app has, from the list the two share', (_, read, marker) => {
    expect(IMPORT_ACCOUNT_TYPES.map((choice) => choice.value)).toEqual([...ACCOUNT_TYPES])
    const source = read()
    const start = source.indexOf(marker)
    expect(start, marker).toBeGreaterThan(-1)
    expect(source.slice(start, source.indexOf('</select>', start))).toContain(
      '<For each={IMPORT_ACCOUNT_TYPES}>'
    )
  })

  it('in the setup wizard offers every type the app has', () => {
    const source = readFileSync(WIZARD, 'utf8')
    const start = source.indexOf('const ACCOUNT_TYPE_LABELS')
    expect(start).toBeGreaterThan(-1)
    const list = source.slice(start, source.indexOf(']\n', start))
    expect([...list.matchAll(/value: '([^']+)'/g)].map((match) => match[1])).toEqual([
      ...ACCOUNT_TYPES,
    ])
  })
})
