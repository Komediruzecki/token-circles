/**
 * One address for each kind of character an address that is stored may not hold
 * (shared/signInSchema.ts, STORED_EMAIL_PATTERN), already lowercased as the routes lowercase it.
 * The first two are the ones that showed the lookup pattern lets them through.
 */
export const REFUSED_WHEN_STORED: [kind: string, address: string][] = [
  ['C0 controls (a terminal title sequence)', 'a\x1b]0;t\x07@example.test'],
  ['angle brackets', '<b>x</b>@example.test'],
  ['a DEL', 'name\x7f@example.test'],
  ['a C1 control', 'name@example.te\u009bst'],
  ['a bidi override', 'name\u202e@example.test'],
  ['a zero-width space', 'na\u200bme@example.test'],
  ['whitespace', 'na me@example.test'],
];

/** The ones the lookup pattern takes: an account created with one before still signs in. */
export const TAKEN_BY_LOOKUPS = REFUSED_WHEN_STORED.filter(([, address]) => !/\s/.test(address));
