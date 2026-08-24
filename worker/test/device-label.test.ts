/**
 * Turning a user agent into something a person recognises.
 *
 * The question the session list answers is "is this the laptop in front of me, or the tablet I
 * lent to someone" — so the label only has to be right enough to tell two or three devices apart.
 * It is derived at render time rather than stored, so this can be improved without a backfill.
 */
import { describe, expect, it } from 'vitest';
import { deviceLabel } from '../src/deviceLabel';

describe('deviceLabel', () => {
  it('names the common desktop browsers', () => {
    expect(
      deviceLabel(
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36'
      )
    ).toBe('Chrome on Linux');
    expect(
      deviceLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Gecko/20100101 Firefox/130.0')
    ).toBe('Firefox on Mac');
  });

  it('names the phones and tablets', () => {
    expect(
      deviceLabel(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
      )
    ).toBe('Safari on iPhone');
    expect(
      deviceLabel(
        'Mozilla/5.0 (Linux; Android 14; SM-X200) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36'
      )
    ).toBe('Chrome on Android');
  });

  it('does not let Chrome claim every browser that mentions it', () => {
    // Order matters: Edge, Opera and Samsung Internet all carry "Chrome/" in their UA, and every
    // iOS browser carries "Safari/". A confident wrong label is worse than none when the question
    // is "should I sign that one out".
    expect(
      deviceLabel(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36 Edg/151.0.0.0'
      )
    ).toBe('Edge on Windows');
    expect(
      deviceLabel(
        'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36'
      )
    ).toBe('Samsung Internet on Android');
    expect(
      deviceLabel(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/151.0 Mobile/15E148 Safari/604.1'
      )
    ).toBe('Chrome on iPhone');
  });

  it('says so rather than guessing', () => {
    expect(deviceLabel(null)).toBe('Unknown device');
    expect(deviceLabel('')).toBe('Unknown device');
    expect(deviceLabel('   ')).toBe('Unknown device');
    expect(deviceLabel('curl/8.4.0')).toBe('Unknown device');
  });

  it('gives half an answer when that is all there is', () => {
    expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('Windows');
  });
});
