export type ApiProfileScope = 'none' | 'active' | 'household'

const CURRENT_PROFILE_ID_KEY = 'currentProfileId'
const SELECTED_PROFILE_IDS_KEY = 'selectedProfileIds'

function positiveInteger(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

export function activeProfileId(storage: Pick<Storage, 'getItem'> = localStorage): number {
  return positiveInteger(storage.getItem(CURRENT_PROFILE_ID_KEY)) ?? 1
}

export function householdProfileIds(storage: Pick<Storage, 'getItem'> = localStorage): number[] {
  const active = activeProfileId(storage)
  const raw = storage.getItem(SELECTED_PROFILE_IDS_KEY)
  if (!raw) return [active]

  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return [active]
    const ids = [...new Set(parsed.map(positiveInteger).filter((id): id is number => id !== null))]
    return ids.length > 0 ? ids : [active]
  } catch {
    return [active]
  }
}

export function profileRequestHeaders(
  scope: ApiProfileScope,
  storage: Pick<Storage, 'getItem'> = localStorage
): Record<string, string> {
  if (scope === 'none') return {}

  const headers: Record<string, string> = {
    'X-Profile-Id': String(activeProfileId(storage)),
  }
  if (scope === 'household') {
    headers['X-Profile-Ids'] = JSON.stringify(householdProfileIds(storage))
  }
  return headers
}
