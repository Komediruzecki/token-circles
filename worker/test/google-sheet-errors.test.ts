/**
 * When a Google Sheet cannot be read as CSV, POST /api/import/googlesheet answers 501 with a
 * sentence the import page shows as is. That sentence used to splice in the caught error's
 * message whatever it was, so a network failure's internal text reached the page. Its own reasons
 * (not shared publicly, no rows, Google's HTTP status) still do; anything else is logged and
 * replaced with a plain reason.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchGoogleSheetRows } from '../src/routes/imports';

const SHEET = 'https://docs.google.com/spreadsheets/d/SHEET123/edit#gid=0';
let consoleError: ReturnType<typeof vi.spyOn>;

function serve(respond: () => Response | Promise<Response>): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => respond())
  );
}

beforeEach(() => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  consoleError.mockRestore();
});

describe('fetchGoogleSheetRows failures', () => {
  it("does not put an unexpected error's text in the 501, and logs it instead", async () => {
    serve(() => {
      throw new Error('connect ECONNREFUSED 10.20.30.40:443 via egress-proxy-7');
    });
    const { status, body } = await fetchGoogleSheetRows(SHEET);
    expect(status).toBe(501);
    const error = String(body.error);
    expect(error).not.toContain('ECONNREFUSED');
    expect(error).not.toContain('egress-proxy');
    expect(error).toMatch(/^Could not import this Google Sheet via CSV export: /);
    expect(error).toContain('Anyone with link can view');

    const line = consoleError.mock.calls
      .map((args) => String(args[0]))
      .find((l) => l.includes('ECONNREFUSED'));
    expect(line).toBeDefined();
    const logged = JSON.parse(line!);
    expect(logged).toMatchObject({ level: 'error', source: 'google-sheet' });
    expect(typeof logged.stack).toBe('string');
    // The sheet URL is a share link: whoever holds it can read the sheet. It stays out of logs.
    expect(line).not.toContain('SHEET123');
  });

  it('keeps its own reason for a sheet that is not shared publicly', async () => {
    serve(() => new Response('<!DOCTYPE html><html></html>', { status: 200 }));
    const { status, body } = await fetchGoogleSheetRows(SHEET);
    expect(status).toBe(501);
    expect(body.error).toContain('Sheet is not publicly accessible (got HTML instead of CSV)');
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('keeps its own reason for an empty sheet', async () => {
    serve(() => new Response('', { status: 200 }));
    const { status, body } = await fetchGoogleSheetRows(SHEET);
    expect(status).toBe(501);
    expect(body.error).toContain('No rows found');
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("keeps Google's HTTP status as the reason", async () => {
    serve(() => new Response('not found', { status: 404 }));
    const { status, body } = await fetchGoogleSheetRows(SHEET);
    expect(status).toBe(501);
    expect(body.error).toContain('HTTP 404');
    expect(consoleError).not.toHaveBeenCalled();
  });
});
