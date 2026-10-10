/**
 * The app's categorical palette, the "constellation": azure-anchored, with warm dawn and mint
 * counterpoints, tuned to read on both the Orbit (dark) and Dawn (light) grounds.
 *
 * It lives here because both runtimes need it: the page draws swatches and charts from it
 * (frontend/src/core/brandPalette.ts, as CATEGORY_PALETTE), and a tag created without a colour
 * takes the next of these, on the Worker and in local-first alike (shared/tagSchema.ts).
 */
export const CONSTELLATION: readonly string[] = [
  '#6e9bff', // azure
  '#f0a860', // dawn
  '#59d2a2', // mint
  '#e0708a', // rose
  '#93b4ff', // azure bright
  '#e8c268', // amber
  '#4fb3d9', // cyan
  '#c9a0ff', // violet
  '#7182a8', // mist (also the "Other" bucket)
  '#3b6fe0', // azure deep
];
