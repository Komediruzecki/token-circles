/**
 * In local-first mode the recurring list is the active profile's, as the Worker's is.
 *
 * WHY THIS TEST EXISTS. The local router listed the recurring rules of every ticked profile
 * (Settings > Household), while the Worker lists the active profile's alone. Every other recurring
 * route is the active profile's in both runtimes, so with two profiles ticked the Recurring section
 * offered Edit, Delete and "Add to transactions" on the other profile's rules, and each answered
 * 404. The Dashboard's recurring card summed rules the cloud never shows it.
 *
 * Everything here goes through the real `apiFetch`, local router and handler.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { api, apiPut } from '../../api'
import { getDB } from '../idb'

const CREATED_AT = '2026-01-01T00:00:00.000Z'

/** A monthly rule, the way recurringCreate stores one. */
const rule = (description: string, profileId: number) => ({
  profile_id: profileId,
  description,
  amount: 50,
  type: 'expense',
  frequency: 'monthly',
  day_of_month: 1,
  next_date: '2026-11-01',
  category_id: null,
  account_id: null,
  transfer_account_id: null,
  notes: '',
  is_active: 1,
  created_at: CREATED_AT,
})

let familyRuleId: number

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('finance_storage_mode', 'serverless')
  localStorage.setItem('finance_had_profiles', '1')
  // Personal is active, with Family ticked as well.
  localStorage.setItem('currentProfileId', '1')
  localStorage.setItem('selectedProfileIds', JSON.stringify([1, 2]))
  const db = await getDB()
  await db.clear('profiles')
  await db.clear('recurring')
  await db.put('profiles', { id: 1, name: 'Personal', created_at: CREATED_AT })
  await db.put('profiles', { id: 2, name: 'Family', created_at: CREATED_AT })
  await db.add('recurring', rule('Rent', 1) as never)
  familyRuleId = (await db.add('recurring', rule('Daycare', 2) as never)) as number
})

describe('the recurring list in local-first mode, with two profiles ticked', () => {
  it('is the active profile’s rules alone', async () => {
    const list = (await api.getRecurring()) as Array<{ description: string; profile_id: number }>

    expect(list.map((r) => [r.description, r.profile_id])).toEqual([['Rent', 1]])
  })

  it('leaves out the rules this profile cannot edit', async () => {
    // Why another profile's rule has no place in the list: each route behind its buttons
    // answers for the active profile only.
    await expect(apiPut(`/api/recurring/${familyRuleId}`, { amount: 60 })).rejects.toMatchObject({
      status: 404,
    })
  })
})
