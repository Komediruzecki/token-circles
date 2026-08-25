/**
 * Can this browser install the app, and has it already?
 *
 * Chrome fires `beforeinstallprompt` once, early, and that event is the only handle on the native
 * install sheet — lose it and the app can never offer installation itself. So the listener goes in
 * before the app renders, and the event is stashed in a module-level signal rather than in a
 * component that may not be mounted yet.
 *
 * iOS never fires the event and has no programmatic install at all, so it gets a Share-menu hint
 * instead of a button that could not work.
 *
 * Ported from mercurypitch, where this has been in production long enough to be boring.
 */
import { createSignal } from 'solid-js';

/**
 * Not in lib.dom: `beforeinstallprompt` is Chromium-only and unspecified. Declared minimally, for
 * exactly the two members used here.
 */
export interface BeforeInstallPromptEvent extends Event {
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
  prompt: () => Promise<void>;
}

export type InstallOutcome = 'accepted' | 'dismissed' | 'unavailable';

const STANDALONE_QUERY = '(display-mode: standalone)';

const [pendingPrompt, setPendingPrompt] = createSignal<BeforeInstallPromptEvent | null>(null);
const [installed, setInstalled] = createSignal(false);
/**
 * True once `beforeinstallprompt` has fired at all this session, surviving the event's
 * consumption. `promptInstall` nulls `pendingPrompt` BEFORE the native sheet resolves, so
 * anything keyed on "no prompt available" alone would flip mid-sheet; this stays true.
 */
const [promptSeen, setPromptSeen] = createSignal(false);

function matchesStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  if (typeof window.matchMedia === 'function') {
    // `display-mode: standalone` is the reliable signal on Android and desktop;
    // `navigator.standalone` is the iOS-only equivalent.
    if (window.matchMedia(STANDALONE_QUERY).matches) return true;
  }
  return (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

const [standalone, setStandalone] = createSignal(matchesStandalone());

/**
 * True when the app is already running as an installed app, so every install affordance should be
 * hidden. Reactive: launching from the home screen and opening the same origin in a tab are the
 * same code with different answers.
 */
export const isStandalone: () => boolean = standalone;

/**
 * True when a native install sheet can actually be opened right now. False before
 * `beforeinstallprompt` arrives, false once the app is installed, and false forever on browsers
 * that never fire it.
 */
export function canInstall(): boolean {
  return pendingPrompt() !== null && !installed() && !standalone();
}

function iosUserAgent(userAgent: string, maxTouchPoints: number): boolean {
  if (/iPad|iPhone|iPod/.test(userAgent)) return true;
  // iPadOS 13+ reports itself as a Mac; the touch points give it away.
  return userAgent.includes('Macintosh') && maxTouchPoints > 1;
}

/**
 * True on iOS Safari, where installing means Share -> Add to Home Screen and no API exists to
 * offer it. Chrome/Firefox/Edge on iOS are excluded: they are WebKit underneath but cannot add to
 * the home screen at all, so a hint there would send the user somewhere that does not exist.
 */
export function needsIosInstallHint(): boolean {
  if (!hintEligible()) return false;
  const { userAgent } = navigator;
  if (!iosUserAgent(userAgent, navigator.maxTouchPoints)) return false;
  return !/CriOS|FxiOS|EdgiOS|OPiOS/.test(userAgent);
}

/** Shared gate for every install hint: a browser context, and not already installed. */
function hintEligible(): boolean {
  if (typeof navigator === 'undefined') return false;
  return !standalone() && !installed();
}

/**
 * True on an Android browser where the menu hint is the best offer available. Every major
 * Android browser can install from its own menu — "Add to Home screen" or "Install app" — so a
 * menu hint is honest there even when `beforeinstallprompt` never arrives: Firefox and Samsung
 * Internet do not fire it at all, and Chrome withholds it when the app is already installed or
 * the device fails its installability checks. Excluded on top of the shared eligibility rules:
 *
 * - A session where the event HAS arrived (`promptSeen`), even if already consumed — a real
 *   install button existed, and swapping it for a menu hint mid-session (the sheet nulls the
 *   pending event before the user answers it) would replace a working control with a lecture.
 * - Android WebViews (the `; wv)` UA marker — Gmail/Instagram in-app browsers), which have no
 *   browser menu to point at.
 * - Desktop, as with iOS: a desktop browser without the event cannot install PWAs at all.
 *
 * Known residual: an app installed in an EARLIER session, opened in a Chrome tab, still shows
 * the hint (`appinstalled` only marks the session it fired in, and Chrome's menu then reads
 * "Open app") — detecting that needs getInstalledRelatedApps + manifest wiring, out of scope.
 */
export function needsAndroidInstallHint(): boolean {
  if (!hintEligible()) return false;
  if (canInstall() || promptSeen()) return false;
  const { userAgent } = navigator;
  if (!/Android/i.test(userAgent)) return false;
  return !userAgent.includes('; wv)');
}

/**
 * Open the native install sheet and report what the user chose. The event is single-use, so it is
 * dropped either way: accepted means `appinstalled` follows, dismissed means Chrome will re-fire
 * `beforeinstallprompt` on a later visit if it still considers the app installable.
 */
export async function promptInstall(): Promise<InstallOutcome> {
  const event = pendingPrompt();
  if (event === null) return 'unavailable';
  setPendingPrompt(null);
  try {
    await event.prompt();
    const { outcome } = await event.userChoice;
    return outcome;
  } catch {
    return 'unavailable';
  }
}

/**
 * Start listening. Call once, as early as possible — `beforeinstallprompt` can fire before the app
 * has rendered, and it is not replayed.
 */
export function installPwaInstallListeners(
  target: Pick<EventTarget, 'addEventListener'> | undefined = typeof window === 'undefined'
    ? undefined
    : window
): void {
  if (target === undefined) return;

  target.addEventListener('beforeinstallprompt', (event) => {
    // Chrome shows its own mini-infobar unless the event is cancelled, and cancelling is also what
    // makes the event reusable later.
    event.preventDefault();
    setPendingPrompt(event as BeforeInstallPromptEvent);
    setPromptSeen(true);
  });

  target.addEventListener('appinstalled', () => {
    setInstalled(true);
    setPendingPrompt(null);
  });

  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    const mql = window.matchMedia(STANDALONE_QUERY);
    const sync = (): void => {
      setStandalone(matchesStandalone());
    };
    if (typeof mql.addEventListener === 'function') mql.addEventListener('change', sync);
  }
}
