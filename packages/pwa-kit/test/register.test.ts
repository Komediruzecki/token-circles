/**
 * The question this module answers is "does the user see a reload prompt", and the naive version
 * answers it wrong: it prompts whenever a worker is waiting, even when the page is already running
 * that worker's build, so accepting reloads to an identical app. The build-id handshake is what
 * most of these cases are about.
 *
 * The rest are about the reload itself. With a precached shell, `location.reload()` is answered by
 * the controlling worker out of its own cache — so when the running build's chunks are gone from
 * the origin, a plain reload re-serves the same dead shell and the app breaks identically, forever.
 * `reloadToLatest` is the ladder out of that, and every rung of it is tested here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Register from '../src/register';
import { BUILD_ID_MESSAGE, SKIP_WAITING_MESSAGE, STALE_BUILD_MESSAGE } from '../src/sw-runtime';

const PAGE_BUILD = 'abc1234';

/** Registration state is module-level; each case gets its own module. */
async function freshModule(): Promise<typeof Register> {
  vi.resetModules();
  return import('../src/register');
}

class FakeWorker extends EventTarget {
  state: ServiceWorkerState = 'installing';
  readonly received: unknown[] = [];

  constructor(private readonly buildId: string | null = null) {
    super();
  }

  postMessage(data: unknown, transfer?: Transferable[]): void {
    this.received.push(data);
    const type =
      typeof data === 'object' && data !== null ? (data as { type?: unknown }).type : undefined;
    if (type !== BUILD_ID_MESSAGE || this.buildId === null) return;
    const port = transfer?.[0] as MessagePort | undefined;
    port?.postMessage({ type: BUILD_ID_MESSAGE, buildId: this.buildId });
  }

  install(): void {
    this.state = 'installed';
    this.dispatchEvent(new Event('statechange'));
  }
}

class FakeRegistration extends EventTarget {
  installing: FakeWorker | null = null;
  waiting: FakeWorker | null = null;
  readonly update = vi.fn(async () => Promise.resolve(undefined));
  readonly unregister = vi.fn(async () => Promise.resolve(true));

  /** What the browser does when a new worker finishes installing. */
  announceInstalled(worker: FakeWorker): void {
    this.installing = worker;
    this.dispatchEvent(new Event('updatefound'));
    this.waiting = worker;
    worker.install();
  }
}

class FakeContainer extends EventTarget {
  controller: FakeWorker | null = null;
  readonly registration = new FakeRegistration();
  readonly register = vi.fn(async () => Promise.resolve(this.registration));
  readonly getRegistration = vi.fn(
    async (): Promise<FakeRegistration | undefined> => Promise.resolve(this.registration)
  );
}

const asContainer = (container: FakeContainer): ServiceWorkerContainer =>
  container as unknown as ServiceWorkerContainer;

/** Let a MessageChannel round-trip and the promise chain behind it settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0));
}

interface Setup {
  module: typeof Register;
  container: FakeContainer;
  registration: FakeRegistration;
  onUpdateReady: ReturnType<typeof vi.fn>;
  reload: ReturnType<typeof vi.fn>;
  applyUpdate: () => void;
}

async function register(
  options: { waiting?: FakeWorker | null; controlled?: boolean; buildId?: string } = {}
): Promise<Setup> {
  const module = await freshModule();
  const container = new FakeContainer();
  if (options.controlled !== false) container.controller = new FakeWorker();
  if (options.waiting !== undefined) container.registration.waiting = options.waiting;

  const onUpdateReady = vi.fn();
  const reload = vi.fn();
  module.registerServiceWorker({
    buildId: options.buildId ?? PAGE_BUILD,
    container: asContainer(container),
    reload,
    onUpdateReady,
  });
  await settle();

  return {
    module,
    container,
    registration: container.registration,
    onUpdateReady,
    reload,
    applyUpdate: () => {
      (onUpdateReady.mock.calls[0]?.[0] as () => void)();
    },
  };
}

// ── registration ───────────────────────────────────────────────────────────────────────────────

describe('registration', () => {
  it('does nothing when the build says there is no worker to register', async () => {
    // A dev server: `vite dev` emits no worker, and registering /sw.js would 404.
    const module = await freshModule();
    const container = new FakeContainer();
    module.registerServiceWorker({
      buildId: PAGE_BUILD,
      enabled: false,
      container: asContainer(container),
    });
    await settle();

    expect(container.register).not.toHaveBeenCalled();
  });

  it('does nothing in a browser with no service worker support', async () => {
    const module = await freshModule();
    // No container passed and none on `navigator` — must not throw.
    expect(() => {
      module.registerServiceWorker({ buildId: PAGE_BUILD, container: undefined });
    }).not.toThrow();
  });

  it('registers at the origin root and never from the HTTP cache', async () => {
    const { container } = await register();

    // Without `updateViaCache: 'none'` a cached sw.js can keep a client on an old worker for its
    // whole max-age.
    expect(container.register).toHaveBeenCalledWith('/sw.js', {
      scope: '/',
      updateViaCache: 'none',
    });
  });

  it('takes a different script URL and scope when an app needs one', async () => {
    const module = await freshModule();
    const container = new FakeContainer();
    module.registerServiceWorker({
      buildId: PAGE_BUILD,
      container: asContainer(container),
      scriptUrl: '/app/sw.js',
      scope: '/app/',
    });
    await settle();

    expect(container.register).toHaveBeenCalledWith('/app/sw.js', {
      scope: '/app/',
      updateViaCache: 'none',
    });
  });

  it('waits for load when the document is still parsing', async () => {
    const original = Object.getOwnPropertyDescriptor(Document.prototype, 'readyState');
    Object.defineProperty(document, 'readyState', { value: 'loading', configurable: true });
    try {
      const module = await freshModule();
      const container = new FakeContainer();
      module.registerServiceWorker({ buildId: PAGE_BUILD, container: asContainer(container) });
      await settle();
      // Registering before `load` would put the worker's install fetches on the critical path of
      // the first paint it exists to make faster.
      expect(container.register).not.toHaveBeenCalled();

      window.dispatchEvent(new Event('load'));
      await settle();
      expect(container.register).toHaveBeenCalled();
    } finally {
      if (original !== undefined) Object.defineProperty(document, 'readyState', original);
    }
  });

  it('keeps the app alive when registration fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const module = await freshModule();
    const container = new FakeContainer();
    container.register.mockRejectedValueOnce(new Error('SecurityError'));

    module.registerServiceWorker({ buildId: PAGE_BUILD, container: asContainer(container) });
    await settle();

    // The site works fine uninstalled; a failed registration must never take it down.
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

// ── the update prompt ──────────────────────────────────────────────────────────────────────────

describe('the update prompt', () => {
  it('says nothing on a first-ever install', async () => {
    const { onUpdateReady } = await register({
      waiting: new FakeWorker('99f00d1'),
      controlled: false,
    });

    // With no controller the page is already running the only version there is.
    expect(onUpdateReady).not.toHaveBeenCalled();
  });

  it('prompts when the waiting worker carries a different build', async () => {
    const { onUpdateReady } = await register({ waiting: new FakeWorker('99f00d1') });

    expect(onUpdateReady).toHaveBeenCalledTimes(1);
  });

  it('adopts a worker built from the commit the page is running, silently', async () => {
    const waiting = new FakeWorker(PAGE_BUILD);
    const { onUpdateReady, reload } = await register({ waiting });

    // Reloading to an identical app is the complaint the handshake exists for.
    expect(onUpdateReady).not.toHaveBeenCalled();
    expect(waiting.received).toContainEqual({ type: SKIP_WAITING_MESSAGE });
    expect(reload).not.toHaveBeenCalled();
  });

  it('prompts when the waiting worker is too old to answer', async () => {
    // No build id: a worker from before the handshake existed, or one busy enough to miss the
    // window. Treating silence as an update is the safe direction to be wrong in — but only after
    // the timeout, so a slow answer is still preferred to a guess.
    vi.useFakeTimers();
    try {
      const module = await freshModule();
      const container = new FakeContainer();
      container.controller = new FakeWorker();
      container.registration.waiting = new FakeWorker(null);
      const onUpdateReady = vi.fn();

      module.registerServiceWorker({
        buildId: PAGE_BUILD,
        container: asContainer(container),
        onUpdateReady,
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(onUpdateReady).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(2_500);
      expect(onUpdateReady).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('prompts when a worker installs while the page is open', async () => {
    const { registration, onUpdateReady } = await register();
    expect(onUpdateReady).not.toHaveBeenCalled();

    registration.announceInstalled(new FakeWorker('99f00d1'));
    await settle();

    expect(onUpdateReady).toHaveBeenCalledTimes(1);
  });

  it('asks once per waiting worker, however often the browser fires', async () => {
    const { registration, onUpdateReady } = await register();
    const waiting = new FakeWorker('99f00d1');

    registration.announceInstalled(waiting);
    await settle();
    registration.dispatchEvent(new Event('updatefound'));
    waiting.install();
    await settle();

    expect(onUpdateReady).toHaveBeenCalledTimes(1);
  });

  it('ignores an updatefound with nothing installing behind it', async () => {
    const { registration, onUpdateReady } = await register();

    registration.installing = null;
    registration.dispatchEvent(new Event('updatefound'));
    await settle();

    expect(onUpdateReady).not.toHaveBeenCalled();
  });

  it('is never raised when no handler was passed', async () => {
    const module = await freshModule();
    const container = new FakeContainer();
    container.controller = new FakeWorker();
    container.registration.waiting = new FakeWorker('99f00d1');

    module.registerServiceWorker({ buildId: PAGE_BUILD, container: asContainer(container) });
    await settle();

    // No handler, no handshake — and no crash.
    expect(container.registration.waiting.received).toEqual([]);
  });
});

// ── accepting ──────────────────────────────────────────────────────────────────────────────────

describe('accepting the update', () => {
  it('adopts the waiting worker and reloads once it has taken over', async () => {
    const waiting = new FakeWorker('99f00d1');
    const { container, applyUpdate, reload } = await register({ waiting });

    applyUpdate();
    expect(waiting.received).toContainEqual({ type: SKIP_WAITING_MESSAGE });
    // Not before: `controllerchange` is the earliest moment a reload is guaranteed to get the
    // matching HTML and chunk map together.
    expect(reload).not.toHaveBeenCalled();

    container.dispatchEvent(new Event('controllerchange'));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reloads anyway when another tab took the update first', async () => {
    const { registration, applyUpdate, reload } = await register({
      waiting: new FakeWorker('99f00d1'),
    });

    registration.waiting = null;
    applyUpdate();

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload a tab whose user never accepted', async () => {
    const { container, reload } = await register({ waiting: new FakeWorker('99f00d1') });

    container.dispatchEvent(new Event('controllerchange'));

    // Another tab's decision must not throw away what is happening in this one.
    expect(reload).not.toHaveBeenCalled();
  });

  it('does not raise a second prompt while the swap is in flight', async () => {
    const { registration, onUpdateReady, applyUpdate } = await register({
      waiting: new FakeWorker('99f00d1'),
    });

    applyUpdate();
    registration.announceInstalled(new FakeWorker('deadbee'));
    await settle();

    expect(onUpdateReady).toHaveBeenCalledTimes(1);
  });
});

// ── stale-build evidence ───────────────────────────────────────────────────────────────────────

describe('finding out the build is gone', () => {
  it('checks for an update as soon as the worker reports a stale request', async () => {
    const { container, registration } = await register();

    container.dispatchEvent(
      Object.assign(new Event('message'), { data: { type: STALE_BUILD_MESSAGE, path: '/a.js' } })
    );

    // Evidence, not a guess: the page has just asked for something the origin no longer has.
    expect(registration.update).toHaveBeenCalledTimes(1);
  });

  it('does not hammer the origin when a broken deploy reports a burst', async () => {
    const { container, registration } = await register();
    const notice = () =>
      Object.assign(new Event('message'), { data: { type: STALE_BUILD_MESSAGE, path: '/a.js' } });

    container.dispatchEvent(notice());
    container.dispatchEvent(notice());
    container.dispatchEvent(notice());

    expect(registration.update).toHaveBeenCalledTimes(1);
  });

  it('ignores any other message the worker sends', async () => {
    const { container, registration } = await register();

    container.dispatchEvent(Object.assign(new Event('message'), { data: { type: 'something' } }));
    container.dispatchEvent(Object.assign(new Event('message'), { data: null }));

    expect(registration.update).not.toHaveBeenCalled();
  });

  it('lets a failure inside the page ask for the same check', async () => {
    const { module, registration } = await register();

    module.requestUpdateCheck();

    expect(registration.update).toHaveBeenCalledTimes(1);
  });

  it('is a no-op before anything is registered', async () => {
    const module = await freshModule();
    expect(() => {
      module.requestUpdateCheck();
    }).not.toThrow();
  });

  it('survives an update check the browser refuses', async () => {
    const { module, registration } = await register();
    registration.update.mockRejectedValueOnce(new Error('InvalidStateError'));

    expect(() => {
      module.requestUpdateCheck();
    }).not.toThrow();
    await settle();
  });
});

// ── the foreground re-check ────────────────────────────────────────────────────────────────────

describe('the foreground re-check', () => {
  const originalVisibility = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState');

  const setVisibility = (state: DocumentVisibilityState): void => {
    Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  };

  beforeEach(() => {
    setVisibility('visible');
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalVisibility !== undefined) {
      Object.defineProperty(document, 'visibilityState', originalVisibility);
    }
  });

  it('ignores a tab going away', async () => {
    const { registration } = await register();

    setVisibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));

    expect(registration.update).not.toHaveBeenCalled();
  });

  it('does not re-check a tab that was only away for a moment', async () => {
    const { registration } = await register();

    document.dispatchEvent(new Event('visibilitychange'));

    // Registration itself seeds the clock, so flicking between tabs cannot hammer the origin.
    expect(registration.update).not.toHaveBeenCalled();
  });

  it('re-checks a tab left open across the interval', async () => {
    const { registration } = await register();
    const realNow = Date.now;
    Date.now = () => realNow() + 16 * 60_000;
    try {
      document.dispatchEvent(new Event('visibilitychange'));
      expect(registration.update).toHaveBeenCalledTimes(1);
    } finally {
      Date.now = realNow;
    }
  });
});

// ── reloadToLatest ─────────────────────────────────────────────────────────────────────────────

describe('reloadToLatest — the reload that escapes the worker cache', () => {
  it('adopts a waiting worker and reloads once it takes control', async () => {
    const module = await freshModule();
    const container = new FakeContainer();
    const waiting = new FakeWorker('99f00d1');
    container.registration.waiting = waiting;
    const reload = vi.fn();

    const pending = module.reloadToLatest({ container: asContainer(container), reload });
    await settle();
    expect(waiting.received).toContainEqual({ type: SKIP_WAITING_MESSAGE });

    container.dispatchEvent(new Event('controllerchange'));
    await pending;

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('unregisters before reloading when there is nothing newer to adopt', async () => {
    const module = await freshModule();
    const container = new FakeContainer();
    container.registration.waiting = null;
    const reload = vi.fn();

    await module.reloadToLatest({ container: asContainer(container), reload });

    // An unregistered worker does not claim the next navigation, so the shell comes from the
    // origin and the current build reinstalls clean.
    expect(container.registration.unregister).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('keeps the registration when offline — the cache is all there is', async () => {
    const original = Object.getOwnPropertyDescriptor(Navigator.prototype, 'onLine');
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    try {
      const module = await freshModule();
      const container = new FakeContainer();
      container.registration.waiting = null;
      const reload = vi.fn();

      await module.reloadToLatest({ container: asContainer(container), reload });

      // Deleting the registration would trade a broken build for no build at all.
      expect(container.registration.unregister).not.toHaveBeenCalled();
      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      if (original !== undefined) Object.defineProperty(navigator, 'onLine', original);
    }
  });

  it('falls back to unregistering when the adopted worker never takes over', async () => {
    vi.useFakeTimers();
    try {
      const module = await freshModule();
      const container = new FakeContainer();
      container.registration.waiting = new FakeWorker('99f00d1');
      const reload = vi.fn();

      const pending = module.reloadToLatest({ container: asContainer(container), reload });
      await vi.advanceTimersByTimeAsync(5_000);
      await pending;

      expect(container.registration.unregister).toHaveBeenCalledTimes(1);
      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reloads plainly when nothing is registered', async () => {
    const module = await freshModule();
    const container = new FakeContainer();
    container.getRegistration.mockResolvedValueOnce(undefined);
    const reload = vi.fn();

    await module.reloadToLatest({ container: asContainer(container), reload });

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reloads plainly when the container cannot be asked', async () => {
    const module = await freshModule();
    const container = new FakeContainer();
    container.getRegistration.mockRejectedValueOnce(new Error('InvalidStateError'));
    const reload = vi.fn();

    await module.reloadToLatest({ container: asContainer(container), reload });

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('still reloads when unregistering itself fails', async () => {
    const module = await freshModule();
    const container = new FakeContainer();
    container.registration.waiting = null;
    container.registration.unregister.mockRejectedValueOnce(new Error('nope'));
    const reload = vi.fn();

    await module.reloadToLatest({ container: asContainer(container), reload });

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('never reloads twice, however often it is asked', async () => {
    const module = await freshModule();
    const container = new FakeContainer();
    container.registration.waiting = null;
    const reload = vi.fn();

    await module.reloadToLatest({ container: asContainer(container), reload });
    await module.reloadToLatest({ container: asContainer(container), reload });

    expect(reload).toHaveBeenCalledTimes(1);
  });
});
