# The time machine: a first week in minutes

A new account's first week takes seven days: a confirm mail, a mail on day 2 if nothing was
imported, a mail on day 7 if something was. The time machine lives that week on your own machine in
a few minutes, against the real Worker, the real app and the real mails. The E2E spec
`frontend/tests/first-week-journey.spec.ts` runs it on every full suite; an agent or a person drives
the same harness by hand with `pnpm -C frontend run time-machine`.

It is local only. Nothing in it reaches dev or prod, and the mail sink it uses refuses to run
anywhere but a development Worker (see [The mail sink](#the-mail-sink)).

## The pieces

| Piece                    | File                                        | What it does                                                                                                                   |
| ------------------------ | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| The daily job's own time | `worker/src/index.ts` (scheduled)           | The week-one run counts its windows from `event.scheduledTime`, so a run fired for a chosen instant sees that instant.         |
| The mail sink            | `worker/src/email.ts` (`devMailSink`)       | A development Worker with no Resend key hands each mail to a mailbox on this machine instead of skipping it.                   |
| The mailbox              | `frontend/scripts/mailbox.mjs`              | Keeps every mail on 127.0.0.1, as JSON, HTML and text files and through a small API and an index page.                         |
| The moves                | `worker/scripts/time-machine.ts`            | The SQL and arithmetic that put an account on day N.                                                                           |
| The harness              | `frontend/tests/time-machine/harness.ts`    | Moves an account, fires the daily job, reads mails, says where the account is in its week. Shared by the spec and the command. |
| The command              | `frontend/tests/time-machine/cli.ts`        | `up`, `day`, `fire`, `state`, `mails`, `mail`.                                                                                 |
| The spec                 | `frontend/tests/first-week-journey.spec.ts` | Day 0 to day 7 in the cloud, a stop link, and local-first on the browser clock.                                                |

## Driving it by hand

Pick ports nobody else uses. These are examples; `up` refuses ports that are taken.

```bash
cd frontend
export E2E_PORT=3840 E2E_API_PORT=8827 E2E_MAIL_PORT=8837
# An agent keeps its mails in its own agent-out run:
export E2E_MAILBOX_DIR=<run>/scratch/mailbox   # <run>: the absolute path `agent-out begin` printed

# 1. The stack: the mailbox, the Worker (migrations applied first) and the app. In a terminal,
#    Ctrl+C stops all three, each by its own process group.
pnpm run time-machine up
#    An agent runs it in the background with a deadline, and stops it with a SIGTERM to the group:
#    setsid timeout 10800 pnpm run time-machine up > <run>/scratch/raw-logs/up.log 2>&1 &
#    kill -TERM -- -<the PID setsid started>

# 2. Sign up in the browser at http://127.0.0.1:3840/ and open the confirm link from the
#    mailbox. The link signs that browser in and starts day 0.

# 3. Live the week.
pnpm run time-machine state you@example.test       # where the account is, what the next run does
pnpm run time-machine day you@example.test 2       # move to day 2
pnpm run time-machine fire                         # run the daily job now; prints what it sent
pnpm run time-machine mails you@example.test       # the account's mails, oldest first
pnpm run time-machine mail <id>                    # one mail: its links and its text
pnpm run time-machine day you@example.test 7 --at 08:30
```

`state --json` prints the same as JSON. `mail <id> --html` prints the HTML. Reload the app after a
move: a page keeps what it read.

`--at HH:MM` (UTC) lands on that time of day N, which is where the 08:30 run finds the account. An
address confirmed at 09:00 UTC is on day 6.97 at 08:30 seven days later, so its day-7 mail goes the
morning after, as it would in production.

Moves go forward only. `day 1` after `day 2` is refused; sign up a new account to live the week
again. Asking for the same day twice moves nothing the second time.

### Reading the mails

Open the mailbox's own page, [the local mailbox](http://127.0.0.1:8837/) at the port you chose. It
lists every mail, newest first, with its HTML and text a click away; the To box filters by address.
The HTML opens with a strict, sandboxed Content-Security-Policy, so nothing in a mail runs or
moves the page elsewhere.

The mailbox takes a mail only as the Worker posts it: `Content-Type: application/json` exactly, and
neither an `Origin` nor a `Sec-Fetch-Site` header, one of which a browser adds whenever a page posts.
So a web page open in your browser cannot post one.

The same mails are files in `E2E_MAILBOX_DIR`: `<id>.json` (the Worker's fields, `from`, `to`,
`subject`, `html`, `text`, `reply_to` and `headers`, with the mailbox's `id` and `received_at`),
`<id>.html` (the HTML with the same policy as a meta tag at the top) and `<id>.txt`. A mail's id is
when it came, to the millisecond, plus 8 hex digits, random for a millisecond's first mail and
counting up after it, so ids sort in the order mails came. The mailbox makes it, and nothing in a
file name comes from the mail. The mailbox loads the folder again when it starts, so mails survive
a restart. It keeps the newest 1,000 mails and at most 64 MiB of them, and drops the oldest mail's
three files past that; nothing else in the folder is touched. `time-machine mails` and `mail` print
a mail's fields with control characters taken out.

Without `E2E_MAILBOX_DIR`, `up` keeps them in `frontend/test-results/time-machine-mailbox` and the
E2E suite in `frontend/test-results/mailbox`.

## The mail sink

`sendMail` hands a mail to `DEV_MAIL_SINK` only when all of these hold:

- `RESEND_API_KEY` is unset,
- `APP_ENV` is exactly `development` (dev and prod are `dev` and `production`),
- `DEV_MAIL_SINK` is a plain `http:` URL on `127.0.0.1`, `localhost` or `[::1]`, with no user or
  password in it.

Anything else is refused with a warning naming the reason, and the mail is skipped as before. The
sink gets the same request body Resend would. A mailbox that takes it answers `{ id }`, which reads
as Resend's acceptance, so every caller goes on as in production: a week-one claim stays, and a
second run does not send day 2 again. Without the sink, a skipped send gives the claim back, which
is why a run without a key sent day 2 on every run.

The Worker reads its mail-link origins from `CORS_ORIGIN` (links into the app) and
`API_PUBLIC_ORIGIN` (links to the Worker, such as the stop link). There is no `APP_URL` variable:
`up` and `playwright.config.ts` pass both origins to the run, so the confirm link sends the browser
to this run's app and not to `:3800`.

## Firing the daily job

`wrangler dev` serves `/cdn-cgi/handler/scheduled?cron=<cron>&time=<epoch ms>` on every local
Worker. It runs the scheduled handler as the event scheduled for `time` and answers once the run is
done, so the mails are in the mailbox when `fire` returns. `time` must be milliseconds; an ISO
string is read as garbage. `/__scheduled` (with `--test-scheduled`) runs the handler too but ignores
the time. `fire` always sends the real now: see the next section.

## The clock

Every clock read on the first-week path, cloud mode:

| Value                                                         | Written by                                                            | Read by                                                                                      |
| ------------------------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Day 0: `reminder_dedup (user, 'welcome')`                     | SQLite `datetime('now')` when the address is confirmed (`welcome.ts`) | the week-one windows, Settings' switch, the time machine                                     |
| The week-one windows                                          |                                                                       | `weekOne.ts` `candidates`: day 0 against the run's `now`, `event.scheduledTime`              |
| A mail's claim: `reminder_dedup (user, 'week-one:dayN')`      | SQLite `datetime('now')` at the claim                                 | the windows (a claimed mail never goes twice), Settings' switch                              |
| The day-7 counts' today                                       |                                                                       | `sendDue`: the run's `now`, against `transactions.date` (tracked months, year window)        |
| Settings' first-week switch                                   |                                                                       | `weekOneAhead` at request time (`new Date()`), against day 0 and the day-7 claim             |
| Import logs, budgets, goals, bills `created_at`               | SQLite `datetime('now')` or the Worker's `toISOString()`              | Progress badges' months (`achievements/evaluate.ts`), advice's months, the first-week counts |
| The app's today                                               | the browser                                                           | Progress' strip and year review, Getting started, the dashboard's month                      |
| Sessions, confirm and reset links, sign-in codes, rate limits | SQLite or the Worker, at request time                                 | auth at request time                                                                         |

Local-first writes every stamp with the browser's `new Date()` into IndexedDB
(`core/storage/handlers/*`) and reads today from the browser too. It has no server, no cron and no
mail.

### The frame: data back in the cloud, the browser clock in local-first

Two ways to live a week fast: move the clocks forward, or move the account's data back. Cloud mode
uses **data back**. Every clock above stays the real one: the browser's, the Worker's at request
time, SQLite's `datetime('now')`, and the daily job's, which `fire` runs at the real now. "Day N"
moves every instant the account's own use wrote back by one and the same number of seconds, so
that day 0 lies N days before now. Every reader then compares two values on the same clock.

Clocks forward would need a clock seam in production code (request-time reads in auth, Settings and
the windows), and the browser, the Worker and SQLite would each need moving together. Data back
needs none: the only production change is the daily job reading its own scheduled time.

Local-first uses **the browser clock**: Playwright's `page.clock.install` and `setSystemTime`. The
browser is its only clock, so moving it moves everything, and its week can cross a month end, which
data back cannot.

The two never meet on one value. `fire` takes no day: a job fired at a moved time on top of a moved
account would count the days twice. The cloud spec never installs page.clock.

### What moves and what stays

`worker/scripts/time-machine.ts` names every time column in three lists:

- **MOVED**, the instants of the account's own use: `users.created_at`, `profiles.created_at`,
  `user_state.updated_at`, `reminder_dedup.sent_at` (day 0 and every claim) and the `created_at`,
  `updated_at` and similar stamps of everything in its profiles. Each keeps its form: an ISO string
  stays ISO, SQLite's `YYYY-MM-DD HH:MM:SS` stays that, a bare date stays a date.
- **KEPT**, instants that are not the account's use: sessions, API tokens, passkeys, two-step
  codes, confirm and reset links, sign-in codes, rate limits, logs, Stripe's dates. A moved account
  stays signed in and its limits stay as they are.
- **CHOSEN**, dates a person or their bank chose: a transaction's date, a budget's month, a bill's
  due day, a goal's deadline. A date cannot be re-keyed, so these never move.

A move is worked out from day 0 as stored, never added up, and sent as one D1 batch. Every
statement in it checks that day 0 still holds the value the move was worked out from, and day 0
moves in the last one, so a batch sent twice, or one worked out from a stale read, changes nothing.

## What it cannot simulate

- **The calendar does not turn in the cloud.** On day 7 the app's today and the day-7 mail's today
  are the real today. A budget made "for this month" on day 0 is still on that month, and a week
  that crosses a month end is not lived: use local-first and page.clock for that.
- **Chosen dates stay.** Transaction dates, budget months, bill due days and goal deadlines are not
  moved, so "this month's spending" on day 7 is the real month's.
- **Back in time.** Moves only go forward. A new account lives the week again.
- **Stamps inside JSON.** A date written inside a `user_state` value or a settings JSON is not
  moved; only columns are.
- **The first-week counts.** `worker/scripts/first-week-counts.ts` counts its cohort by
  `users.created_at` and its confirm share only for accounts made after migration 0033 ran. A moved
  account counts on the day it was moved to, and one moved to before 0033's local `applied_at`
  leaves the confirm share.
- **Production links.** The wordmark at the top of every mail and a few reminder buttons link to
  `https://tokencircles.com`, a constant in `emailTemplates.ts`, not to this run's app.
- **Delivery.** The mailbox takes every mail. Resend's suppression list, bounces, spam folders and
  rate limits (a 429 stops a run) are not there.
- **Passkeys under `up`.** `up` serves the app on 127.0.0.1 so the confirm link's cookies land; a
  passkey needs a name such as localhost. The E2E suite's own origins are `localhost` for that
  reason, and its spec opens the confirm link's fragment on 127.0.0.1 itself.
- **Several runs a day.** Only the 08:30 week-one cron is fired. The 08:00 reminders and sheet syncs
  run on their own cron and are not part of `fire`.

## The tests that hold it

| Test                                                | Fails when                                                                                                                                                                  |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `worker/test/week-one-cron.test.ts`                 | the scheduled handler stops passing `event.scheduledTime` to the run                                                                                                        |
| `worker/test/dev-mail-sink.test.ts`                 | any of the sink's conditions is dropped, the body differs from Resend's, or a claim is not kept                                                                             |
| `worker/test/time-machine.test.ts`                  | a time column is in no list or two, a value moves by other seconds or changes form, a kept or chosen value or another account moves, a batch lands twice, day 0 is not last |
| `frontend/src/__tests__/mailbox.test.ts`            | the mailbox listens beyond 127.0.0.1, answers another host, names a file from a mail, prints a mail, or takes something that is not one                                     |
| `frontend/src/__tests__/timeMachineHarness.test.ts` | `fire` sends any time but the clock's own now                                                                                                                               |
| `frontend/src/__tests__/timeMachineCli.test.ts`     | `up` starts anything while one of its ports is taken                                                                                                                        |
| `frontend/src/__tests__/e2eMailboxConfig.test.ts`   | the E2E config stops starting the mailbox first or stops passing the Worker its sink and origins                                                                            |
| `frontend/tests/first-week-journey.spec.ts`         | the week itself breaks: a mail too early, twice, missing, with the wrong links, or after a stop                                                                             |
