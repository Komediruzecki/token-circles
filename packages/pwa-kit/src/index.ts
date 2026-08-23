/**
 * @komediruzecki/pwa-kit — the parts of "make this a real installable app" that are the same in
 * every app, kept together so they can be reviewed once and reused.
 *
 * Lives in the monorepo for now; it has no imports from the app it is used by, so extracting it
 * to its own repository is a `git filter-repo` and a publish, not a rewrite.
 */
export {
  canInstall,
  installPwaInstallListeners,
  isStandalone,
  needsIosInstallHint,
  promptInstall,
} from './install';
export type { BeforeInstallPromptEvent, InstallOutcome } from './install';
