/**
 * SignedInDevices — where this account is signed in, and how to end any one of them.
 *
 * The account had exactly one session control: a "Logout" button that bumped `token_version` and
 * therefore signed you out of every device you owned. Leaving on a laptop ejected you from your
 * phone mid-use, and there was no way to see where you were signed in, or to end a session on a
 * device you no longer have without ending the one in your hand.
 *
 * So: the list is the whole truth (the device you are reading this on is in it, flagged, not
 * hidden), each row ends exactly that one session, and "sign out everywhere" survives as the
 * deliberate, separate choice it always should have been.
 */
import { createSignal, For, onMount, Show } from 'solid-js'
import { toast } from '../core/api'
import { apiFetch } from '../core/apiFetch'
import { showConfirm } from '../core/confirmStore'
import styles from './SignedInDevices.module.css'
import type { Component, JSX } from 'solid-js'

export interface SignedInDevice {
  id: string
  /** Readable label derived server-side from the user agent, e.g. "Chrome on Linux". */
  device: string
  provider: string | null
  ip: string | null
  created_at: string
  last_seen_at: string
  /** True for the session making the request. */
  current: boolean
}

/**
 * D1 stamps `datetime('now')`, which is UTC written as `YYYY-MM-DD HH:MM:SS` with no zone marker.
 * `new Date()` on that string reads it as LOCAL time, so "just now" renders as hours ago (or in
 * the future) for anyone not on UTC. Normalise to a real ISO instant before parsing.
 */
export function parseServerTime(value: string): Date {
  if (/([zZ]|[+-]\d{2}:?\d{2})$/.test(value)) return new Date(value)
  return new Date(`${value.replace(' ', 'T')}Z`)
}

/** Coarse on purpose: "when was I last here" is the question, not the second it happened. */
export function timeAgo(value: string, now: Date = new Date()): string {
  const then = parseServerTime(value)
  if (Number.isNaN(then.getTime())) return 'unknown'
  const seconds = Math.round((now.getTime() - then.getTime()) / 1000)
  // Clock skew between the server and this browser can put a fresh stamp slightly in the future.
  // "in 3 seconds" would be alarming for something that just happened; clamp it to "just now".
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`
  return then.toLocaleDateString()
}

const IconDevice = (): JSX.Element => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <rect x="2" y="4" width="20" height="12" rx="2" />
    <path d="M6 20h12" />
    <path d="M12 16v4" />
  </svg>
)

export const SignedInDevices: Component = () => {
  const [devices, setDevices] = createSignal<SignedInDevice[]>([])
  const [loading, setLoading] = createSignal(true)
  const [failed, setFailed] = createSignal(false)
  const [busy, setBusy] = createSignal<string | null>(null)
  const [signingOutAll, setSigningOutAll] = createSignal(false)

  const load = async (): Promise<void> => {
    setLoading(true)
    try {
      const res = await apiFetch('/api/auth/sessions', { credentials: 'include' })
      if (!res.ok) throw new Error(String(res.status))
      const body = (await res.json()) as { sessions?: SignedInDevice[] }
      setDevices(body.sessions ?? [])
      setFailed(false)
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }

  onMount(() => void load())

  const endOne = async (device: SignedInDevice): Promise<void> => {
    const confirmed = await showConfirm(
      device.current
        ? 'Sign out of this device? You will need to sign in again here. Your other devices stay signed in.'
        : `Sign out of ${device.device}? That device will need to sign in again. Nothing else changes.`,
      { confirmText: 'Sign out', danger: true }
    )
    if (!confirmed) return
    setBusy(device.id)
    try {
      const res = await apiFetch(`/api/auth/sessions/${encodeURIComponent(device.id)}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (!res.ok) throw new Error(String(res.status))
      // Ending your own session took your cookie with it, so there is nothing left to show:
      // reload and land on the login screen rather than render a list you can no longer fetch.
      if (device.current) {
        window.location.reload()
        return
      }
      setDevices((list) => list.filter((d) => d.id !== device.id))
      toast(`Signed out of ${device.device}`, 'success')
    } catch {
      toast('Could not sign out that device', 'error')
    } finally {
      setBusy(null)
    }
  }

  const endAll = async (): Promise<void> => {
    const confirmed = await showConfirm(
      'Sign out on all devices? Every phone, tablet and computer signed into this account will need to sign in again, including this one.',
      { confirmText: 'Sign out everywhere', danger: true }
    )
    if (!confirmed) return
    setSigningOutAll(true)
    try {
      const res = await apiFetch('/api/auth/logout-all', {
        method: 'POST',
        credentials: 'include',
      })
      if (!res.ok) throw new Error(String(res.status))
      window.location.reload()
    } catch {
      toast('Could not sign out everywhere', 'error')
      setSigningOutAll(false)
    }
  }

  return (
    <div class={styles.wrap} data-test-id="signed-in-devices">
      <h4 class={styles.heading}>Signed in on</h4>

      <Show when={!loading()} fallback={<p class={styles.muted}>Loading devices...</p>}>
        <Show
          when={!failed()}
          fallback={
            <p class={styles.muted} data-test-id="devices-error">
              Could not load your devices.{' '}
              <button type="button" class={styles.linkButton} onClick={() => void load()}>
                Try again
              </button>
            </p>
          }
        >
          <Show
            when={devices().length > 0}
            fallback={
              // A token issued before this list existed has no row to show. Saying so beats an
              // empty list that reads as "you are signed in nowhere" on the device you are using.
              <p class={styles.muted} data-test-id="devices-empty">
                No devices to show yet. This list fills in as you sign in.
              </p>
            }
          >
            <ul class={styles.list}>
              <For each={devices()}>
                {(device) => (
                  <li class={styles.row} data-test-id="device-row">
                    <span class={styles.icon} aria-hidden="true">
                      <IconDevice />
                    </span>
                    <span class={styles.detail}>
                      <span class={styles.name}>
                        {device.device}
                        <Show when={device.current}>
                          <span class={styles.badge} data-test-id="device-current">
                            This device
                          </span>
                        </Show>
                      </span>
                      <span class={styles.meta}>
                        {[
                          device.provider === 'google'
                            ? 'Google account'
                            : device.provider === 'email'
                              ? 'Email code'
                              : device.provider === 'passkey'
                                ? 'Passkey'
                                : null,
                          device.ip,
                          `last active ${timeAgo(device.last_seen_at)}`,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </span>
                    <button
                      type="button"
                      class={styles.endButton}
                      data-test-id="device-signout"
                      disabled={busy() === device.id}
                      onClick={() => void endOne(device)}
                    >
                      {busy() === device.id ? 'Signing out...' : 'Sign out'}
                    </button>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </Show>
      </Show>

      {/* Signing out used to do this to everyone whether they asked or not. Now it is the
          deliberate choice it should always have been, for the case it is actually for: a device
          you no longer have, or a session you think someone else has. */}
      <button
        type="button"
        class={styles.allButton}
        data-test-id="settings-logout-all"
        disabled={signingOutAll()}
        onClick={() => void endAll()}
      >
        {signingOutAll() ? 'Signing out...' : 'Sign out on all devices'}
      </button>
      <p class={styles.muted}>
        Ends every signed-in session, including this one. Use it if you have lost a device or think
        someone else has your password.
      </p>
    </div>
  )
}

export default SignedInDevices
