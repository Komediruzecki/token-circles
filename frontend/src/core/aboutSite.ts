/**
 * The about site the app links to: Privacy, Terms and the articles (shared/articles.ts). A build
 * names its own in VITE_ABOUT_ORIGIN, so the dev build (frontend/.env.dev) links to dev's about
 * site and a self-hosted build to its own; production's when the build names none. The Worker's
 * mails read theirs from ABOUT_ORIGIN (worker/src/reminders.ts `aboutOrigin`).
 */
import { DEFAULT_ABOUT_ORIGIN } from '../../../shared/articles'

export const aboutOrigin = (): string => import.meta.env.VITE_ABOUT_ORIGIN || DEFAULT_ABOUT_ORIGIN
