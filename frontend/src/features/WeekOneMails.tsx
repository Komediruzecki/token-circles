/**
 * Settings > Email reminders: the switch for the week-one mails (worker/src/weekOne.ts), the two
 * mails a new account gets in its first week. Cloud only, like the rest of the card: local-first
 * has no account and gets no mail.
 *
 * No plan gates it, since Free gets these mails, so it saves on its own when flipped instead of
 * waiting for the card's Save, which a plan without reminders cannot press. It shows only while a
 * mail can still come (`weekOneAhead`). After an unsubscribe from a mail's footer it shows off and
 * cannot be turned on here: that unsubscribe stops every mail, these two included.
 */
import { createSignal, Show } from 'solid-js'
import ToggleField from '../components/ToggleField'
import { toast } from '../core/api.js'
import { apiErrorFrom, plainMessage } from '../core/apiError'
import { apiFetch } from '../core/apiFetch'

export interface WeekOneSettings {
  weekOneMails?: boolean
  weekOneAhead?: boolean
  unsubscribed?: boolean
}

export const WEEK_ONE_TITLE = 'First-week mails'
export const WEEK_ONE_DESCRIPTION =
  'Up to two in your first week: how to export statements from your bank, and what your first import found.'
export const WEEK_ONE_UNSUBSCRIBED =
  'You unsubscribed from Token Circles mails with a link in one of them, so these stay off.'

export default function WeekOneMails(props: {
  loaded: WeekOneSettings
  onSaved: (on: boolean) => void
}) {
  const [busy, setBusy] = createSignal(false)
  const unsubscribed = () => props.loaded.unsubscribed === true

  const save = async (on: boolean) => {
    setBusy(true)
    try {
      const res = await apiFetch('/api/notifications/settings', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weekOneMails: on }),
      })
      if (!res.ok) throw await apiErrorFrom(res)
      props.onSaved(on)
      toast(on ? 'First-week mails are on.' : 'First-week mails are off.', 'success')
    } catch (e) {
      toast(plainMessage(e, "Couldn't save that. Try again."), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Show when={props.loaded.weekOneAhead === true}>
      <div data-test-id="settings-week-one">
        <ToggleField
          title={WEEK_ONE_TITLE}
          description={unsubscribed() ? WEEK_ONE_UNSUBSCRIBED : WEEK_ONE_DESCRIPTION}
          checked={() => props.loaded.weekOneMails !== false && !unsubscribed()}
          disabled={busy() || unsubscribed()}
          onChange={(on) => void save(on)}
          data-test-id="settings-week-one-toggle"
        />
      </div>
    </Show>
  )
}
