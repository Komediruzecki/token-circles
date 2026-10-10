/**
 * The kinds of access that confirming an address can remove and the person would notice, under the
 * names the Worker reports them by and the app reads them back with.
 *
 * The Worker names them on three answers (worker: clearedWorthSaying): the Google sign-in redirect,
 * as `?cleared=password,passkeys`, and the emailed-code sign-in and the password reset, as
 * `cleared: ['password', 'passkeys']`. The app turns them into its notice
 * (frontend: core/accessCleared.ts). Both runtimes import this file, so the names stay one list.
 */

/** In the order a notice names them. */
export const CLEARED_KINDS = ['password', 'passkeys', 'two-factor', 'api-tokens'] as const;

export type ClearedKind = (typeof CLEARED_KINDS)[number];

/**
 * The kinds `raw` names, in CLEARED_KINDS order and each once: a list, or a comma-separated query
 * value, with any space around a name ignored. Anything that is not one of the names is left out,
 * so a notice never names what nothing reported.
 */
export function readClearedKinds(raw: unknown): ClearedKind[] {
  const listed =
    typeof raw === 'string' ? raw.split(',') : Array.isArray(raw) ? (raw as unknown[]) : [];
  const named = listed.map((name) => (typeof name === 'string' ? name.trim() : name));
  return CLEARED_KINDS.filter((kind) => named.includes(kind));
}
