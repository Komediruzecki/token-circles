/**
 * @komediruzecki/pwa-kit — the parts of "make this a real installable app" that are the same in
 * every app, kept together so they can be reviewed once and reused.
 *
 * Lives in the monorepo for now; it has no imports from the app it is used by, so extracting it to
 * its own repository is a `git filter-repo` and a publish, not a rewrite.
 */
export {
  canInstall,
  installPwaInstallListeners,
  isStandalone,
  needsAndroidInstallHint,
  needsIosInstallHint,
  promptInstall,
} from './install';
export type { BeforeInstallPromptEvent, InstallOutcome } from './install';

export { registerServiceWorker, reloadToLatest, requestUpdateCheck } from './register';
export type { RegisterServiceWorkerOptions, ReloadToLatestOptions } from './register';

export {
  BUILD_ID_MESSAGE,
  SKIP_WAITING_MESSAGE,
  STALE_BUILD_MESSAGE,
  UNKNOWN_BUILD_ID,
  createServiceWorkerRuntime,
  extensionOf,
  firstPaintAssets,
  htmlBelongsToBuild,
  isCacheableAsset,
  isHtmlDocument,
  manifestRevision,
} from './sw-runtime';
export type {
  ServiceWorkerRuntime,
  SwMessageAction,
  SwPrecacheEntry,
  SwRuntimeConfig,
  SwRuntimeEnvironment,
  SwRuntimeOptions,
  SwStaleBuildNotice,
} from './sw-runtime';
