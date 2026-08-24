/**
 * A user agent, as something a person recognises.
 *
 * Derived at render time rather than stored, so the parser can be improved without a backfill —
 * `sessions.user_agent` keeps the original string either way.
 *
 * Deliberately coarse. The job is "is this the laptop or the phone I am holding", answered from a
 * list of two or three, not device fingerprinting. Anything unrecognised says so plainly instead
 * of guessing, because a confident wrong label is worse than none when the question being asked
 * is "should I sign that one out".
 */

/** Order matters: Edge and Chrome both claim Chrome, and every iOS browser claims Safari. */
const BROWSERS: [RegExp, string][] = [
  [/\bEdgA?\/|\bEdgiOS\//, 'Edge'],
  [/\bOPR\/|\bOPiOS\//, 'Opera'],
  [/\bSamsungBrowser\//, 'Samsung Internet'],
  [/\bCriOS\//, 'Chrome'],
  [/\bFxiOS\//, 'Firefox'],
  [/\bFirefox\//, 'Firefox'],
  [/\bChrome\//, 'Chrome'],
  [/\bSafari\//, 'Safari'],
];

const PLATFORMS: [RegExp, string][] = [
  [/\biPhone\b/, 'iPhone'],
  [/\biPad\b/, 'iPad'],
  [/\bAndroid\b/, 'Android'],
  [/\bWindows NT\b/, 'Windows'],
  [/\bMac OS X\b|\bMacintosh\b/, 'Mac'],
  [/\bCrOS\b/, 'ChromeOS'],
  [/\bLinux\b/, 'Linux'],
];

const match = (ua: string, table: [RegExp, string][]): string | null => {
  for (const [pattern, label] of table) if (pattern.test(ua)) return label;
  return null;
};

/** "Chrome on Linux", "Safari on iPhone", "Firefox", "Unknown device". */
export function deviceLabel(userAgent: string | null | undefined): string {
  const ua = (userAgent ?? '').trim();
  if (!ua) return 'Unknown device';
  const browser = match(ua, BROWSERS);
  const platform = match(ua, PLATFORMS);
  if (browser && platform) return `${browser} on ${platform}`;
  if (browser) return browser;
  if (platform) return platform;
  return 'Unknown device';
}
