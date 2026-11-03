/**
 * Every link in every mail goes to the sending environment's origins: the app it serves, the
 * about site it links to (ABOUT_ORIGIN) and the API its links run through (A20). On dev and on a
 * self-hosted Worker the wordmark, "Open the app", the reminders' buttons, the footer and the
 * articles pointed at production while the import link beside them did not. Named no origins, a
 * mail keeps production's, as before.
 */
import { describe, expect, it } from 'vitest';
import { mailSamples } from '../scripts/mail-samples';
import type { Env } from '../src/index';
import { aboutOrigin, mailOriginsOf } from '../src/reminders';
import { mailAddresses, offOrigins } from './helpers/mail-links';
import { wrangler } from './helpers/wrangler-config';

const RUN = {
  appUrl: 'https://app.example.test',
  aboutUrl: 'https://about.example.test',
  apiUrl: 'https://api.example.test',
};

describe('the links in every mail', () => {
  const samples = mailSamples({ ...RUN, assetOrigin: RUN.appUrl });

  it.each(samples.map((sample) => [sample.name, sample] as const))(
    "%s goes only to the run's origins",
    (_, sample) => {
      const mail = sample.render();
      expect(mailAddresses(mail).length).toBeGreaterThan(0);
      expect(offOrigins(mail, [RUN.appUrl, RUN.aboutUrl, RUN.apiUrl])).toEqual([]);
    }
  );

  it('links the footer to the about site the run names', () => {
    const welcome = samples.find((sample) => sample.name === 'welcome')!.render();
    for (const page of ['', '/terms', '/privacy']) {
      expect(welcome.html).toContain(`href="${RUN.aboutUrl}${page}"`);
    }
    expect(welcome.text).toContain(`Open the app: ${RUN.appUrl}`);
  });

  it.each(mailSamples().map((sample) => [sample.name, sample] as const))(
    "%s keeps production's origins when the caller names none",
    (_, sample) => {
      expect(
        offOrigins(sample.render(), [
          'https://tokencircles.com',
          'https://about.tokencircles.com',
          'https://api.tokencircles.com',
        ])
      ).toEqual([]);
    }
  );
});

describe("a deployment's about site", () => {
  const configured = wrangler();

  it('is the one dev names, and production keeps the default', () => {
    expect(configured.env.dev!.vars!.ABOUT_ORIGIN).toBe('https://dev.about.tokencircles.com');
    // Production's value is the default in code, so nothing in its block changes it.
    expect(configured.env.prod!.vars!.ABOUT_ORIGIN).toBeUndefined();
    expect(aboutOrigin({} as Env)).toBe('https://about.tokencircles.com');
  });

  it("is read from ABOUT_ORIGIN, beside the app the mails' links open", () => {
    const run = {
      ABOUT_ORIGIN: RUN.aboutUrl,
      CORS_ORIGIN: RUN.appUrl,
    } as Env;
    expect(aboutOrigin(run)).toBe(RUN.aboutUrl);
    expect(mailOriginsOf(run)).toEqual({
      appUrl: RUN.appUrl,
      aboutUrl: RUN.aboutUrl,
      assetOrigin: RUN.appUrl,
    });
  });
});
