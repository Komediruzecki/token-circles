/**
 * Settings > Email reminders, on the form kit: the account's address and the four switches, saved
 * together. Cloud only: local-first has no account address, and its Settings shows none of this.
 *
 * A refused save was a toast in the corner, with the address still in the field and nothing marked
 * ("That email is already in use"). Now the Worker's refusal of an address is marked under the
 * address, in its words: one it cannot use (400) and one another account has (409) name no field,
 * and both are about the address. A limit on how often a link can be sent (429), and anything
 * else, goes in the form's notice. Saving a different address starts the change PR #608 added: the
 * account keeps its address until the new one opens the link, and the answer names the address
 * that is waiting.
 */
import { createForm } from '../components/form'
import { toast } from '../core/api'
import { ApiError, apiErrorFrom } from '../core/apiError'
import { apiFetch } from '../core/apiFetch'
import type { Form } from '../components/form'

export interface NotificationValues {
  email: string
  emailNotifications: boolean
  budgetAlerts: boolean
  spendingReport: boolean
  billsReminders: boolean
}

/** What a save answers: the address now waiting for its link, when the save asked for one. */
export interface NotificationAnswer {
  pendingEmail?: string | null
}

export const NOTIFICATIONS_SAVED = 'Notification settings saved.'

/** The values a loaded answer holds, for the form to start from. */
export function notificationValues(loaded: Partial<NotificationValues> | null): NotificationValues {
  return {
    email: loaded?.email ?? '',
    emailNotifications: loaded?.emailNotifications === true,
    budgetAlerts: loaded?.budgetAlerts === true,
    spendingReport: loaded?.spendingReport === true,
    billsReminders: loaded?.billsReminders === true,
  }
}

/** The Worker's refusal of an address names no field: it is about the address. */
function atTheAddress(error: ApiError): ApiError {
  const aboutTheAddress =
    Object.keys(error.fields).length === 0 && (error.status === 400 || error.status === 409)
  return aboutTheAddress
    ? new ApiError(error.status, error.message, { email: error.message })
    : error
}

/** `onSaved` gets the answer once the save is in: Settings reloads to show a change that waits. */
export function createNotificationsForm(options: {
  onSaved: (answer: NotificationAnswer) => void
}): Form<NotificationValues> {
  return createForm<NotificationValues, NotificationAnswer>({
    initial: notificationValues(null),
    send: async (values) => {
      const res = await apiFetch('/api/notifications/settings', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      })
      if (!res.ok) throw atTheAddress(await apiErrorFrom(res))
      const answer = (await res.json().catch(() => ({}))) as NotificationAnswer
      toast(
        answer.pendingEmail
          ? `Saved. Open the link we sent to ${answer.pendingEmail} to finish the change.`
          : NOTIFICATIONS_SAVED,
        'success'
      )
      return answer
    },
    saved: (answer) => {
      options.onSaved(answer)
    },
    failure: "Couldn't save your settings. Try again.",
  })
}
