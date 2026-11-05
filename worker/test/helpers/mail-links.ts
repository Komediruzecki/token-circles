/**
 * Every address a mail links to or loads, for the checks that each goes to the sending
 * environment's origins (worker/test/mail-origins.test.ts and the senders' own tests).
 */

/** Links that are the same from every environment: the contact address and the source code. */
export const FIXED_LINKS = [
  'mailto:hello@tokencircles.com',
  'https://github.com/Komediruzecki/token-circles',
];

/** Every href and src in the HTML, and every address in the text twin. */
export function mailAddresses(mail: { html: string; text: string }): string[] {
  const html = [...mail.html.matchAll(/\s(?:href|src)="([^"]*)"/g)].map((m) =>
    m[1]!.replaceAll('&amp;', '&')
  );
  const text = [...mail.text.matchAll(/(?:https?:\/\/|mailto:)[^\s)]+/g)].map((m) => m[0]);
  return [...html, ...text];
}

/** The addresses in `mail` that are on none of `origins`, and are not one of the fixed links. */
export function offOrigins(mail: { html: string; text: string }, origins: string[]): string[] {
  const on = (url: string) =>
    FIXED_LINKS.includes(url) ||
    origins.some(
      (origin) => url === origin || ['/', '?', '#'].some((next) => url.startsWith(origin + next))
    );
  return mailAddresses(mail).filter((url) => !on(url));
}
