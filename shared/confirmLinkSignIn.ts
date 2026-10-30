/**
 * How the emailed confirm link signs in, in one place.
 *
 * A password sign-up leaves its browser a marker (worker/src/signup-marker.ts). Opened in that
 * browser within the marker's life, the confirm link confirms the address and signs in, with no
 * password asked. Anywhere else, or later, it asks for the password first.
 *
 * The Worker's marker, the two confirm mails, Check your inbox and the refused sign-in all read
 * the rule from here, so turning the same-browser sign-in off, or changing how long it lasts, is
 * one edit below, and what every one of them says follows.
 */

/** When the confirm link signs in without asking for the password. */
export interface ConfirmLinkSignIn {
  /** The link signs in the browser that signed up. False: it asks for the password everywhere. */
  sameBrowser: boolean;
  /** For how long after signing up, in seconds. At most the link's own 24 hours. */
  seconds: number;
}

export const CONFIRM_LINK_SIGN_IN: ConfirmLinkSignIn = { sameBrowser: true, seconds: 60 * 60 };

/** `seconds` in words: "an hour", "2 hours", "30 minutes", "a minute". */
export function inWords(seconds: number): string {
  if (seconds % 3600 === 0) {
    const hours = seconds / 3600;
    return hours === 1 ? 'an hour' : `${hours} hours`;
  }
  const minutes = Math.max(1, Math.round(seconds / 60));
  return minutes === 1 ? 'a minute' : `${minutes} minutes`;
}

/**
 * Where and when the link signs in, as the mails, Check your inbox and the refused sign-in say it.
 * `link` names the link the sentence opens with: "it" in a mail, "the link we emailed you" on a
 * screen that has not mentioned it yet.
 */
export function whereTheLinkSignsIn(link = 'it', rule = CONFIRM_LINK_SIGN_IN): string {
  return rule.sameBrowser
    ? `Open ${link} within ${inWords(rule.seconds)} in the browser you signed up in and you're signed in. Later, or anywhere else, it asks for your password first.`
    : `Open ${link}, then enter your password where it opens.`;
}

/** What the confirm mails say first to someone who never signed up. */
export function notYourSignUp(brand: string, rule = CONFIRM_LINK_SIGN_IN): string {
  return rule.sameBrowser
    ? `Didn't sign up for ${brand}? Don't open the link.`
    : `Didn't sign up for ${brand}? Ignore this mail.`;
}
