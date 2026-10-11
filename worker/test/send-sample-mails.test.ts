/**
 * worker/scripts/send-sample-mails.ts, the command that mails a sample of every mail to one inbox:
 * what it accepts. Only its argument parsing is imported here. The command itself never runs in a
 * test, so nothing here can send a mail.
 */
import { describe, expect, it } from 'vitest';
import { parseArgs } from '../scripts/send-sample-mails';

const refused = (reason: string) => ({ error: expect.stringContaining(reason) });

describe('send-sample-mails', () => {
  it('refuses to run without --to, a dry run too', () => {
    expect(parseArgs([])).toEqual(refused('--to is required'));
    expect(parseArgs(['--dry-run', 'samples'])).toEqual(refused('--to is required'));
  });

  it('refuses a --to that is not an address, an option it does not know, and a flag without its value', () => {
    expect(parseArgs(['--to', 'nobody'])).toEqual(refused('is not an address'));
    expect(parseArgs(['--to', 'a@example.com', '--send-all'])).toEqual(
      refused('Unknown option --send-all')
    );
    expect(parseArgs(['--to'])).toEqual(refused('--to needs a value'));
    expect(parseArgs(['--to', 'a@example.com', '--dry-run', '--only', 'welcome'])).toEqual(
      refused('--dry-run needs a value')
    );
  });

  it('takes an origin, not a page, for the app and the assets', () => {
    expect(
      parseArgs(['--to', 'a@example.com', '--asset-origin', 'https://x.example/email'])
    ).toEqual(refused('--asset-origin takes an origin'));
  });

  it('reads the address, the dry-run folder, the samples to send and the origins', () => {
    expect(
      parseArgs([
        '--to',
        'a@example.com',
        '--dry-run',
        'samples',
        '--only',
        'welcome,login-code',
        '--app-url',
        'https://dev.tokencircles.com',
        '--asset-origin',
        'https://dev.tokencircles.com',
      ])
    ).toEqual({
      to: 'a@example.com',
      dryRun: 'samples',
      only: ['welcome', 'login-code'],
      appUrl: 'https://dev.tokencircles.com',
      assetOrigin: 'https://dev.tokencircles.com',
    });
    expect(parseArgs(['--to', 'a@example.com'])).toEqual({
      to: 'a@example.com',
      dryRun: null,
      only: null,
      appUrl: 'https://tokencircles.com',
      assetOrigin: undefined,
    });
  });
});
