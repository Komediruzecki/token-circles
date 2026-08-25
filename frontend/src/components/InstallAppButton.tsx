/**
 * InstallAppButton — offers the native install sheet, or tells the platform how.
 *
 * Renders nothing at all unless installing is genuinely possible: no button when the app is
 * already running standalone, none on a desktop browser that never fires `beforeinstallprompt`,
 * and where no install API exists but the browser menu can do it — iOS Safari's Share menu,
 * any Android browser's own menu — a hint instead of a button that could not work. A dead
 * "Install" button is worse than no button: it teaches the user the feature is broken rather
 * than unavailable.
 *
 * `canOfferInstall()` is exported so a container can decide whether its whole section is worth
 * drawing.
 */
import { canInstall, needsAndroidInstallHint, needsIosInstallHint, promptInstall } from '@pwa-kit'
import { createSignal, Match, Show, Switch } from 'solid-js'
import { toast } from '../core/api'
import styles from './InstallAppButton.module.css'
import type { Component } from 'solid-js'

/** True when this browser has something to offer — a prompt, or a platform hint. */
export function canOfferInstall(): boolean {
  return canInstall() || needsIosInstallHint() || needsAndroidInstallHint()
}

function InstallIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3v12" />
      <path d="M7 10l5 5 5-5" />
      <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </svg>
  )
}

function BrowserMenuIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="5" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="12" cy="19" r="1.8" />
    </svg>
  )
}

function ShareIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3v13" />
      <path d="M8 7l4-4 4 4" />
      <path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
    </svg>
  )
}

export const InstallAppButton: Component = () => {
  const [busy, setBusy] = createSignal(false)

  const install = (): void => {
    if (busy()) return
    setBusy(true)
    void promptInstall()
      .then((outcome) => {
        // 'dismissed' needs no message — the user just closed a sheet they opened.
        if (outcome === 'unavailable') {
          toast('Your browser did not offer the install sheet', 'error')
        }
      })
      .finally(() => {
        setBusy(false)
      })
  }

  // One flat priority list, best offer first — the native prompt beats any hint, and each hint
  // names its own platform explicitly rather than being whatever is left over.
  return (
    <Show when={canOfferInstall()}>
      <div class={styles.row} data-testid="install-app">
        <Switch>
          <Match when={canInstall()}>
            <div class={styles.copy}>
              <div class={styles.title}>Install Token Circles</div>
              <div class={styles.desc}>
                Adds it to your home screen and opens it in its own window, without the browser
                around it.
              </div>
            </div>
            <button
              type="button"
              class={styles.button}
              onClick={install}
              disabled={busy()}
              data-testid="install-app-button"
            >
              <InstallIcon />
              {busy() ? 'Opening...' : 'Install'}
            </button>
          </Match>
          <Match when={needsIosInstallHint()}>
            <p class={styles.hint} data-testid="install-app-ios-hint">
              <span class={styles.icon}>
                <ShareIcon />
              </span>
              To install on iPhone or iPad, open the Share menu and choose{' '}
              <strong>Add to Home Screen</strong>.
            </p>
          </Match>
          <Match when={needsAndroidInstallHint()}>
            <p class={styles.hint} data-testid="install-app-android-hint">
              <span class={styles.icon}>
                <BrowserMenuIcon />
              </span>
              To install on this device, open your browser&apos;s menu and choose{' '}
              <strong>Add to Home screen</strong> or <strong>Install app</strong>.
            </p>
          </Match>
        </Switch>
      </div>
    </Show>
  )
}
