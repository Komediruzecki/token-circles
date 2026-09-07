/**
 * Privacy and Terms, linked from inside the app.
 *
 * Both documents live on the marketing site and are real — operator, sub-processors, dates —
 * but until this nothing in the app pointed at them: not the sign-in screen, not Settings. For a
 * finance app that is the first thing a careful person looks for, and the first question a launch
 * post gets. Same origin as the landing, so the links are absolute on purpose.
 */
import styles from './LegalLinks.module.css'

export const MARKETING_SITE = 'https://about.tokencircles.com'
export const PRIVACY_URL = `${MARKETING_SITE}/privacy`
export const TERMS_URL = `${MARKETING_SITE}/terms`

export default function LegalLinks() {
  return (
    <nav class={styles.legal} aria-label="Legal">
      <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer">
        Privacy
      </a>
      <span aria-hidden="true">·</span>
      <a href={TERMS_URL} target="_blank" rel="noopener noreferrer">
        Terms
      </a>
    </nav>
  )
}
