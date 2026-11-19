/**
 * The way back to setup, on the Import page (maff, 19 Nov). Setup hands a statement it cannot read
 * by itself to this page and waits here (onboardingStore.ts, pauseOnboarding). This strip says so,
 * and Back to setup opens it again: at the subscriptions in what was imported on the way, or at the
 * statement when nothing was. Nothing else opens setup over the page while it waits, so the
 * columns can be matched without it in the way.
 */
import { createSignal, Show } from 'solid-js'
import { importedWhileSetupWaits, resumeOnboarding, setupWaiting } from '../../core/onboardingStore'
import { addToast } from '../../core/toastStore'
import pageStyles from '../Import.module.css'
import styles from './ImportNotices.module.css'

export function SetupStrip() {
  const [going, setGoing] = createSignal(false)
  const imported = importedWhileSetupWaits

  const back = async () => {
    if (going()) return
    setGoing(true)
    try {
      const outcome = await resumeOnboarding()
      if (outcome === 'finished') {
        addToast('Setup is already finished, here or on another device.', 'info')
      } else if (outcome === 'unknown') {
        addToast("Couldn't reach your account to reopen setup. Try again in a moment.", 'warning')
      }
    } finally {
      setGoing(false)
    }
  }

  return (
    <Show when={setupWaiting()}>
      <section
        class={`${styles.notice} ${styles.setup}`}
        aria-labelledby="import-setup-title"
        data-test-id="import-setup"
      >
        <div class={styles.text}>
          <h2 id="import-setup-title" class={styles.title}>
            <Show when={imported() > 0} fallback="Setup is waiting for this statement">
              {imported() === 1 ? '1 transaction is in' : `${imported()} transactions are in`}
            </Show>
          </h2>
          <p class={styles.sub}>
            <Show
              when={imported() > 0}
              fallback="Import it here, then go back and finish setting up."
            >
              Setup looks through them for subscriptions next.
            </Show>
          </p>
        </div>
        <button
          type="button"
          class={`${pageStyles.btn} ${imported() > 0 ? pageStyles.btnPrimary : pageStyles.btnSecondary} ${styles.action}`}
          data-test-id="import-setup-back"
          disabled={going()}
          onClick={() => void back()}
        >
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
            <path d="M19 12H5M11 18l-6-6 6-6" />
          </svg>
          Back to setup
        </button>
      </section>
    </Show>
  )
}
