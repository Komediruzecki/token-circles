/**
 * Prints the first-week counts: of the accounts that signed up in a window, how many confirmed
 * their address within a day, imported within a day and within a week, and took each next step
 * within a week. Counts and shares only, never an address, a name or an id. What each count reads,
 * and what "within a day" and "within a week" mean, is in first-week.ts.
 *
 *   pnpm -C worker run first-week-counts -- --env dev
 *   pnpm -C worker run first-week-counts -- --env prod --from 2026-10-01 --to 2026-10-28
 *   node worker/scripts/first-week-counts.ts --env local --persist-to <folder>
 *
 * Options:
 *   --env <dev|prod|local>  Required. dev and prod read the remote D1 of that environment,
 *                           through `wrangler d1 execute <db> --remote --env <env>`: the --env is
 *                           what picks the real database, since the top-level binding in
 *                           wrangler.jsonc is a local one. local reads the local D1 that
 *                           `pnpm dev:worker` uses, or the one under --persist-to.
 *   --from <YYYY-MM-DD>     The first sign-up day, UTC. Default: 27 days before --to.
 *   --to <YYYY-MM-DD>       The last sign-up day, UTC, included. Default: today.
 *   --persist-to <folder>   With --env local only: wrangler's --persist-to, for a D1 kept apart
 *                           from the one `pnpm dev:worker` uses.
 *
 * It runs one SELECT, through wrangler as whoever is logged in to it, and refuses before calling
 * wrangler anything that is not a single SELECT or WITH statement (first-week.ts,
 * readOnlyRefusal). The exit code is 1 when wrangler failed or answered something unreadable, and
 * 2 when the command line was wrong or the query was refused.
 */
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  countsFromRow,
  DEFAULT_WINDOW_DAYS,
  firstWeekSql,
  formatCounts,
  isDate,
  readOnlyRefusal,
} from './first-week.ts';

export type Target = 'dev' | 'prod' | 'local';

export interface Options {
  env: Target;
  from: string;
  to: string;
  persistTo: string | null;
}

const USAGE =
  'Usage: pnpm -C worker run first-week-counts -- --env <dev|prod|local> ' +
  '[--from YYYY-MM-DD] [--to YYYY-MM-DD] [--persist-to <folder>]';

/** The D1 database each environment names in wrangler.jsonc. */
const DATABASES: Record<Target, string> = {
  dev: 'finance-manager-dev',
  prod: 'finance-manager',
  local: 'finance-manager',
};

/** `date` (YYYY-MM-DD) moved by `days`. */
function addDays(date: string, days: number): string {
  const ms = Date.parse(`${date}T00:00:00Z`) + days * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

/** The command line, or the reason it was refused. `today` is YYYY-MM-DD, UTC. */
export function parseArgs(argv: string[], today: string): Options | { error: string } {
  const values = new Map<string, string>();
  // pnpm passes the `--` that separates its own options from the script's.
  const args = argv[0] === '--' ? argv.slice(1) : argv;
  for (let i = 0; i < args.length; i += 1) {
    const flag = args[i]!;
    if (!['--env', '--from', '--to', '--persist-to'].includes(flag)) {
      return { error: `Unknown option ${flag}` };
    }
    const value = args[i + 1];
    if (value === undefined || value.startsWith('--')) return { error: `${flag} needs a value` };
    values.set(flag, value);
    i += 1;
  }
  const env = values.get('--env');
  if (env === undefined) return { error: '--env is required: dev, prod or local' };
  if (env !== 'dev' && env !== 'prod' && env !== 'local') {
    return { error: `--env takes dev, prod or local, not ${env}` };
  }
  const to = values.get('--to') ?? today;
  const from = values.get('--from') ?? addDays(to, -(DEFAULT_WINDOW_DAYS - 1));
  for (const [flag, date] of [
    ['--from', from],
    ['--to', to],
  ] as const) {
    if (!isDate(date)) return { error: `${flag} ${date} is not a date written YYYY-MM-DD` };
  }
  if (from > to) return { error: `--from ${from} is after --to ${to}` };
  const persistTo = values.get('--persist-to') ?? null;
  if (persistTo !== null && env !== 'local') {
    return { error: '--persist-to is for --env local: dev and prod are remote' };
  }
  return { env, from, to, persistTo };
}

/** wrangler's arguments, up to the --command and its SQL. */
export function wranglerArgs(env: Target, persistTo: string | null): string[] {
  const where =
    env === 'local'
      ? ['--local', ...(persistTo === null ? [] : ['--persist-to', persistTo])]
      : ['--remote', '--env', env];
  return ['d1', 'execute', DATABASES[env], ...where, '--json'];
}

/** Runs wrangler with `args` and answers what it printed, or throws what went wrong. */
export type Runner = (args: string[]) => Promise<string>;

/** The first row of what `wrangler d1 execute --json` printed. */
function firstRow(stdout: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    // Anything wrangler printed before its JSON, such as a notice of a newer version.
    const start = stdout.search(/^\[/m);
    if (start < 0) throw new Error('wrangler answered no JSON');
    parsed = JSON.parse(stdout.slice(start));
  }
  const row = Array.isArray(parsed) ? parsed[0]?.results?.[0] : undefined;
  if (row === undefined || row === null || typeof row !== 'object') {
    throw new Error('wrangler answered no row');
  }
  return row as Record<string, unknown>;
}

/** Thrown for a query that is not a plain read, before wrangler is called. */
export class NotReadOnlyError extends Error {}

/**
 * Runs `sql` against `env`'s D1 through `run`, and answers its first row. Refuses, without calling
 * `run`, anything but one SELECT or WITH statement.
 */
export async function runReadOnly(
  sql: string,
  env: Target,
  run: Runner,
  persistTo: string | null = null
): Promise<Record<string, unknown>> {
  const refusal = readOnlyRefusal(sql);
  if (refusal !== null)
    throw new NotReadOnlyError(`Refused: the query is not read-only, ${refusal}`);
  return firstRow(await run([...wranglerArgs(env, persistTo), '--command', sql]));
}

/** Where the command reads and writes: the process, unless a test hands in its own. */
export interface Io {
  argv: string[];
  /** YYYY-MM-DD, UTC. */
  today: string;
  /** 'YYYY-MM-DD HH:MM:SS', UTC. */
  now: string;
  out: (line: string) => void;
  err: (line: string) => void;
  run: Runner;
}

/** The worker folder, where wrangler.jsonc is. */
const WORKER_DIR = fileURLToPath(new URL('..', import.meta.url));

function processIo(): Io {
  const instant = new Date().toISOString();
  return {
    argv: process.argv.slice(2),
    today: instant.slice(0, 10),
    now: instant.slice(0, 19).replace('T', ' '),
    out: (line) => process.stdout.write(line),
    err: (line) => process.stderr.write(line),
    run: async (args) => {
      // Loaded here, so a test that imports this file never loads it.
      const { execFile } = await import('node:child_process');
      const wrangler = join(WORKER_DIR, 'node_modules', '.bin', 'wrangler');
      return new Promise((resolve, reject) => {
        execFile(
          wrangler,
          args,
          { cwd: WORKER_DIR, maxBuffer: 16 * 1024 * 1024 },
          (error, stdout, stderr) => {
            if (error) {
              const said = `${stderr}\n${stdout}`.trim();
              reject(new Error(said === '' ? error.message : said));
            } else {
              resolve(stdout);
            }
          }
        );
      });
    },
  };
}

export async function main(io: Io = processIo()): Promise<number> {
  const options = parseArgs(io.argv, io.today);
  if ('error' in options) {
    io.err(`${options.error}\n${USAGE}\n`);
    return 2;
  }
  const window = { from: options.from, to: options.to, now: io.now };
  try {
    const row = await runReadOnly(firstWeekSql(window), options.env, io.run, options.persistTo);
    const source = options.env === 'local' ? 'the local D1' : `the ${options.env} D1`;
    io.out(`${formatCounts(countsFromRow(row), { ...window, source })}\n`);
    return 0;
  } catch (e) {
    io.err(`${e instanceof Error ? e.message : String(e)}\n`);
    return e instanceof NotReadOnlyError ? 2 : 1;
  }
}

// Run only as a command: a test that imports parseArgs runs nothing.
const script = process.argv?.[1] as string | undefined;
if (script && import.meta.url === pathToFileURL(script).href) {
  process.exitCode = await main();
}
