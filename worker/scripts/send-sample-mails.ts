/**
 * Mails a sample of every mail Token Circles sends to one inbox, through Resend's REST API, for
 * looking at them in real mail clients. The samples are mail-samples.ts: plainly fake data, and
 * links that open nothing.
 *
 *   node worker/scripts/send-sample-mails.ts --to you@example.com
 *   node worker/scripts/send-sample-mails.ts --to you@example.com --dry-run ./samples
 *
 * Options:
 *   --to <address>         Required, always. Every sample goes to this one address.
 *   --dry-run <folder>     Write each mail to <folder> (name.html, and name.txt with the subject on
 *                          top) instead of sending anything. Needs no key.
 *   --only <a,b>           Only these samples, by name (the names the output prints).
 *   --app-url <url>        The app the mails link into. Default https://tokencircles.com.
 *   --asset-origin <url>   Where the mails load the wordmark and the art from. Default: the app.
 *                          An origin serves the engraved art only once a deploy has carried it.
 *
 * It reads the API key and the From address from the environment, under the names the Worker
 * uses: RESEND_API_KEY and EMAIL_FROM (default "Token Circles <hello@tokencircles.com>", as in
 * worker/src/email.ts). Keep the key out of files and shells' history: run it under a secret
 * manager that sets the variable for this one command.
 *
 * It prints one line per sample: the sample's name, then Resend's message id or the error. It
 * never prints the key, the From address or a mail's content. The exit code is 1 when a send
 * failed and 2 when the command line was wrong.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mailSamples, type MailSample } from './mail-samples.ts';

const RESEND_URL = 'https://api.resend.com/emails';
const DEFAULT_FROM = 'Token Circles <hello@tokencircles.com>';
/** Resend accepts two requests a second on a default account; one each 600 ms stays under it. */
const PAUSE_MS = 600;
const SEND_TIMEOUT_MS = 10_000;

interface Options {
  to: string;
  dryRun: string | null;
  only: string[] | null;
  appUrl: string;
  assetOrigin: string | undefined;
}

const USAGE =
  'Usage: node worker/scripts/send-sample-mails.ts --to <address> [--dry-run <folder>] ' +
  '[--only <name,name>] [--app-url <url>] [--asset-origin <url>]';

/** The command line, or the reason it was refused. */
export function parseArgs(argv: string[]): Options | { error: string } {
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]!;
    if (!['--to', '--dry-run', '--only', '--app-url', '--asset-origin'].includes(flag)) {
      return { error: `Unknown option ${flag}` };
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) return { error: `${flag} needs a value` };
    values.set(flag, value);
    i += 1;
  }
  const to = values.get('--to');
  if (!to) return { error: '--to is required: the one address every sample goes to' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return { error: `--to ${to} is not an address` };
  for (const flag of ['--app-url', '--asset-origin']) {
    const url = values.get(flag);
    if (url !== undefined && !/^https?:\/\/[^\s/]+$/.test(url)) {
      return { error: `${flag} takes an origin, like https://dev.tokencircles.com` };
    }
  }
  return {
    to,
    dryRun: values.get('--dry-run') ?? null,
    only: values.get('--only')?.split(',').filter(Boolean) ?? null,
    appUrl: values.get('--app-url') ?? 'https://tokencircles.com',
    assetOrigin: values.get('--asset-origin'),
  };
}

/** Send one sample: Resend's message id, or what went wrong. */
async function send(
  sample: MailSample,
  to: string,
  key: string,
  from: string
): Promise<{ id: string } | { error: string }> {
  const { subject, html, text } = sample.render();
  try {
    const res = await fetch(RESEND_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject, html, text }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok) return { error: `Resend ${res.status}${body.message ? `: ${body.message}` : ''}` };
    return body.id ? { id: body.id } : { error: 'Resend answered without a message id' };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/** Write one sample to `folder`, as the mail it would be. */
async function write(sample: MailSample, to: string, folder: string): Promise<string> {
  const { subject, html, text } = sample.render();
  const base = join(folder, sample.name);
  await writeFile(`${base}.html`, html);
  await writeFile(`${base}.txt`, `To: ${to}\nSubject: ${subject}\n\n${text}\n`);
  return `${base}.html`;
}

async function main(): Promise<number> {
  const options = parseArgs(process.argv.slice(2));
  if ('error' in options) {
    process.stderr.write(`${options.error}\n${USAGE}\n`);
    return 2;
  }
  let samples = mailSamples({ appUrl: options.appUrl, assetOrigin: options.assetOrigin });
  if (options.only) {
    const unknown = options.only.filter((name) => !samples.some((s) => s.name === name));
    if (unknown.length > 0) {
      process.stderr.write(
        `No sample named ${unknown.join(', ')}. The names: ${samples.map((s) => s.name).join(', ')}\n`
      );
      return 2;
    }
    samples = samples.filter((sample) => options.only!.includes(sample.name));
  }

  if (options.dryRun !== null) {
    await mkdir(options.dryRun, { recursive: true });
    for (const sample of samples) {
      process.stdout.write(`${sample.name} ${await write(sample, options.to, options.dryRun)}\n`);
    }
    return 0;
  }

  const key: string | undefined = process.env.RESEND_API_KEY;
  if (!key) {
    process.stderr.write('RESEND_API_KEY is not set, so nothing was sent.\n');
    return 2;
  }
  const from: string = process.env.EMAIL_FROM || DEFAULT_FROM;
  let failed = 0;
  for (const [i, sample] of samples.entries()) {
    if (i > 0) await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));
    const result = await send(sample, options.to, key, from);
    if ('id' in result) {
      process.stdout.write(`${sample.name} ${result.id}\n`);
    } else {
      failed += 1;
      process.stdout.write(`${sample.name} error: ${result.error}\n`);
    }
  }
  return failed > 0 ? 1 : 0;
}

// Run only as a command: a test that imports parseArgs sends nothing.
const script = process.argv?.[1] as string | undefined;
if (script && import.meta.url === pathToFileURL(script).href) {
  process.exitCode = await main();
}
