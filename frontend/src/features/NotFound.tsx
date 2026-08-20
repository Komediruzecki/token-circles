/**
 * NotFound — 404 catch-all for unknown hash routes.
 *
 * GIVEN a user navigates to an unknown route
 * WHEN the page renders
 * THEN a 404 message is shown with navigation back to the dashboard
 */
import { setPage } from '../core/appStore'
import styles from './NotFound.module.css'

export default function NotFound() {
  const goHome = () => {
    setPage('dashboard')
    window.location.hash = 'dashboard'
  }

  const goBack = () => {
    window.history.back()
  }

  return (
    <div class={styles.page}>
      <div class={styles.orbit} aria-hidden="true">
        <div class={styles.ring} />
        <div class={styles.dot} />
      </div>
      <h1 class={styles.code}>404</h1>
      <h2 class={styles.title}>Page not found</h2>
      <p class={styles.desc}>The page you're looking for has drifted out of orbit.</p>
      <div class={styles.actions}>
        <button class={styles.primaryBtn} onClick={goHome}>
          Back to Dashboard
        </button>
        <button class={styles.ghostBtn} onClick={goBack}>
          Go Back
        </button>
      </div>
    </div>
  )
}
