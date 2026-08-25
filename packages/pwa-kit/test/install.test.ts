/**
 * The install state is a module-level singleton — it has to outlive any component, since
 * `beforeinstallprompt` fires before the app renders — so each case takes a fresh copy of the
 * module rather than trying to reset it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as PwaInstall from '../src/install';

async function freshModule(): Promise<typeof PwaInstall> {
  vi.resetModules();
  return import('../src/install');
}

function setUserAgent(userAgent: string, maxTouchPoints = 0): void {
  Object.defineProperty(navigator, 'userAgent', { value: userAgent, configurable: true });
  Object.defineProperty(navigator, 'maxTouchPoints', { value: maxTouchPoints, configurable: true });
}

/** The shape Chromium hands over, with just the members the module uses. */
function beforeInstallPrompt(outcome: 'accepted' | 'dismissed'): Event {
  const event = new Event('beforeinstallprompt', { cancelable: true });
  return Object.assign(event, {
    prompt: vi.fn(async () => undefined),
    userChoice: Promise.resolve({ outcome }),
  });
}

const CHROME_ANDROID =
  'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Mobile Safari/537.36';
const SAFARI_IOS =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const CHROME_IOS =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126 Mobile/15E148 Safari/604.1';
const IPADOS_SAFARI =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';

describe('pwa install state', () => {
  beforeEach(() => {
    setUserAgent(CHROME_ANDROID);
  });

  it('offers nothing until the browser says the app is installable', async () => {
    const pwa = await freshModule();
    const target = new EventTarget();
    pwa.installPwaInstallListeners(target);

    expect(pwa.canInstall()).toBe(false);
    expect(await pwa.promptInstall()).toBe('unavailable');
  });

  it('stashes beforeinstallprompt and cancels the browser mini-infobar', async () => {
    const pwa = await freshModule();
    const target = new EventTarget();
    pwa.installPwaInstallListeners(target);

    const event = beforeInstallPrompt('accepted');
    target.dispatchEvent(event);

    // Not cancelling it lets Chrome show its own bar and burns the event.
    expect(event.defaultPrevented).toBe(true);
    expect(pwa.canInstall()).toBe(true);
  });

  it('reports the choice and stops offering, because the event is single-use', async () => {
    const pwa = await freshModule();
    const target = new EventTarget();
    pwa.installPwaInstallListeners(target);
    target.dispatchEvent(beforeInstallPrompt('dismissed'));

    expect(await pwa.promptInstall()).toBe('dismissed');
    expect(pwa.canInstall()).toBe(false);
  });

  it('stops offering once the app reports itself installed', async () => {
    const pwa = await freshModule();
    const target = new EventTarget();
    pwa.installPwaInstallListeners(target);
    target.dispatchEvent(beforeInstallPrompt('accepted'));
    expect(pwa.canInstall()).toBe(true);

    target.dispatchEvent(new Event('appinstalled'));
    expect(pwa.canInstall()).toBe(false);
  });

  it('survives a prompt() that throws, rather than leaving the button stuck', async () => {
    const pwa = await freshModule();
    const target = new EventTarget();
    pwa.installPwaInstallListeners(target);
    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt: () => Promise.reject(new Error('gesture expired')),
      userChoice: Promise.resolve({ outcome: 'accepted' as const }),
    });
    target.dispatchEvent(event);

    expect(await pwa.promptInstall()).toBe('unavailable');
  });

  it('hints at the iOS Share menu, since iOS never fires the event', async () => {
    setUserAgent(SAFARI_IOS, 5);
    const pwa = await freshModule();
    expect(pwa.needsIosInstallHint()).toBe(true);
    expect(pwa.canInstall()).toBe(false);
  });

  it('recognises an iPad, which reports itself as a Mac', async () => {
    setUserAgent(IPADOS_SAFARI, 5);
    const pwa = await freshModule();
    expect(pwa.needsIosInstallHint()).toBe(true);
  });

  it('leaves a real Mac alone — same user agent, no touch', async () => {
    setUserAgent(IPADOS_SAFARI, 0);
    const pwa = await freshModule();
    expect(pwa.needsIosInstallHint()).toBe(false);
  });

  it('says nothing on iOS Chrome, which cannot add to the home screen at all', async () => {
    setUserAgent(CHROME_IOS, 5);
    const pwa = await freshModule();
    expect(pwa.needsIosInstallHint()).toBe(false);
  });

  it('says nothing about iOS on Android', async () => {
    const pwa = await freshModule();
    expect(pwa.needsIosInstallHint()).toBe(false);
  });

  it('hints at the browser menu on Android while no prompt has been captured', async () => {
    const pwa = await freshModule();
    expect(pwa.needsAndroidInstallHint()).toBe(true);
  });

  it('drops the Android hint the moment beforeinstallprompt arrives', async () => {
    const pwa = await freshModule();
    const target = new EventTarget();
    pwa.installPwaInstallListeners(target);
    target.dispatchEvent(beforeInstallPrompt('accepted'));

    expect(pwa.canInstall()).toBe(true);
    expect(pwa.needsAndroidInstallHint()).toBe(false);
  });

  it('never swaps the hint back in after the prompt is consumed mid-session', async () => {
    // promptInstall nulls the pending event BEFORE the native sheet resolves; a hint keyed on
    // "no prompt available" alone would appear behind the still-open sheet.
    const pwa = await freshModule();
    const target = new EventTarget();
    pwa.installPwaInstallListeners(target);
    target.dispatchEvent(beforeInstallPrompt('dismissed'));

    await pwa.promptInstall();

    expect(pwa.canInstall()).toBe(false);
    expect(pwa.needsAndroidInstallHint()).toBe(false);
  });

  it('stays silent in an Android WebView, which has no install menu at all', async () => {
    setUserAgent(
      'Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126 Mobile Safari/537.36'
    );
    const pwa = await freshModule();
    expect(pwa.needsAndroidInstallHint()).toBe(false);
  });

  it('never hints at the Android menu on iOS or desktop', async () => {
    setUserAgent(SAFARI_IOS, 5);
    let pwa = await freshModule();
    expect(pwa.needsAndroidInstallHint()).toBe(false);

    setUserAgent(IPADOS_SAFARI, 0);
    pwa = await freshModule();
    expect(pwa.needsAndroidInstallHint()).toBe(false);
  });

  it('hides every affordance when already running installed', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: q === '(display-mode: standalone)',
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    setUserAgent(SAFARI_IOS, 5);
    const pwa = await freshModule();
    const target = new EventTarget();
    pwa.installPwaInstallListeners(target);
    target.dispatchEvent(beforeInstallPrompt('accepted'));

    expect(pwa.isStandalone()).toBe(true);
    expect(pwa.canInstall()).toBe(false);
    expect(pwa.needsIosInstallHint()).toBe(false);
    vi.unstubAllGlobals();
  });
});
