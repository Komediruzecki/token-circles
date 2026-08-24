import type { ManifestOptions } from 'vite-plugin-pwa'

/**
 * The web app manifest, lifted out of vite.config.ts so it can be checked against the files it
 * names. Every `src` here is a real file in `public/`, and every `sizes` is a claim about that
 * file's pixel dimensions — a claim a browser silently ignores when it is wrong, which is how a
 * re-shot screenshot at a new size stops appearing in the install dialog with nothing to see in
 * any build log. `src/__tests__/pwaManifest.test.ts` reads the headers back and compares.
 *
 * Regenerate the assets with `npm run pwa:icons` and `npm run pwa:shots`.
 */
export const pwaManifest: Partial<ManifestOptions> = {
  // `id` is what the browser uses to decide whether an install already exists.
  // Without it the id is derived from start_url, so changing start_url later would
  // read as a different app and offer a second install alongside the first.
  id: '/',
  name: 'Token Circles',
  short_name: 'Token Circles',
  description: 'Your money, in clear orbit',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  // Opening a link while installed focuses the running window instead of spawning
  // another one — the behaviour people expect from an app rather than a tab.
  launch_handler: { client_mode: 'navigate-existing' },
  orientation: 'any',
  categories: ['finance', 'productivity'],
  background_color: '#0a0e1c',
  theme_color: '#0a0e1c',
  icons: [
    // `purpose` is explicit on every entry. An icon set with no maskable member
    // is not masked by Android — Chrome shrinks the whole square into a white
    // circle, so the installed app shows a small dark tile floating in white.
    // The maskable pair is drawn for it: background to the edges, artwork inside
    // the 80% safe circle (see public/icon-maskable-512.svg).
    {
      src: 'icon-192.png',
      sizes: '192x192',
      type: 'image/png',
      purpose: 'any',
    },
    {
      src: 'icon-512.png',
      sizes: '512x512',
      type: 'image/png',
      purpose: 'any',
    },
    {
      // One entry, `sizes: 'any'` — the value the spec defines for a scalable icon. There used
      // to be two, icon-192.svg and icon-512.svg, declared 192x192 and 512x512; the files are
      // byte-identical and both draw a 512 canvas, so the first was a claim that was simply not
      // true. A browser picking by declared size would have rasterized the same artwork twice.
      src: 'icon-512.svg',
      sizes: 'any',
      type: 'image/svg+xml',
      purpose: 'any',
    },
    {
      src: 'icon-maskable-192.png',
      sizes: '192x192',
      type: 'image/png',
      purpose: 'maskable',
    },
    {
      src: 'icon-maskable-512.png',
      sizes: '512x512',
      type: 'image/png',
      purpose: 'maskable',
    },
  ],
  // What Chrome shows in the rich install dialog on Android. Without at least one
  // of each form factor the dialog falls back to a name, an icon and a URL, and
  // Lighthouse's installability audit says so. Re-shoot with `npm run pwa:shots`;
  // the declared sizes are checked against the real files by
  // src/__tests__/manifestAssets.test.ts, because a stale size is silently ignored.
  screenshots: [
    {
      src: 'screenshots/wide-dashboard.png',
      sizes: '1280x720',
      type: 'image/png',
      form_factor: 'wide',
      label: 'Dashboard — net worth, income and spending at a glance',
    },
    {
      src: 'screenshots/wide-transactions.png',
      sizes: '1280x720',
      type: 'image/png',
      form_factor: 'wide',
      label: 'Transactions — filter, tag and bulk-edit',
    },
    {
      src: 'screenshots/wide-analytics.png',
      sizes: '1280x720',
      type: 'image/png',
      form_factor: 'wide',
      label: 'Analytics — where the money actually goes',
    },
    {
      src: 'screenshots/narrow-dashboard.png',
      sizes: '720x1280',
      type: 'image/png',
      form_factor: 'narrow',
      label: 'Dashboard — net worth, income and spending at a glance',
    },
    {
      src: 'screenshots/narrow-transactions.png',
      sizes: '720x1280',
      type: 'image/png',
      form_factor: 'narrow',
      label: 'Transactions — filter, tag and bulk-edit',
    },
    {
      src: 'screenshots/narrow-analytics.png',
      sizes: '720x1280',
      type: 'image/png',
      form_factor: 'narrow',
      label: 'Analytics — where the money actually goes',
    },
  ],
}
