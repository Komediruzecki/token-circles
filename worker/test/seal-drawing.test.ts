/**
 * The seal is drawn the same in the Worker as in the browser (shared/prints/seal.ts): phase 5
 * mails the print, drawn on the server, and it must be the picture the app shows. Both suites hash
 * the same sample seal and compare it with shared/fixtures/sealSample.ts.
 */
import { describe, expect, it } from 'vitest';
import { SAMPLE_SHA256, SAMPLE_SLOTS } from '../../shared/fixtures/sealSample';
import { drawSeal, PAPER } from '../../shared/prints/seal';

const sha256 = async (text: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
};

describe('drawSeal in the Worker', () => {
  it('draws the sample seal to the same text as the browser, in each detail', async () => {
    for (const detail of ['print', 'screen', 'thumb'] as const) {
      expect(await sha256(drawSeal(SAMPLE_SLOTS, { palette: PAPER, detail }))).toBe(
        SAMPLE_SHA256[detail]
      );
    }
  });
});
