# Changelog

New features and notable fixes in Token Circles, in plain language. The full
technical detail lives in [dev-changelog.md](dev-changelog.md).

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this
project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **The Subscriptions view has been redesigned.** Category pills above the list filter it in one tap ("All" by default, Paused behind its own pill), and each subscription is a compact card: brand icon, price, next due date, a mark-paid button and a "…" menu holding Pause, Edit and Delete.

### Fixed

- **The app no longer shows "App Crashed" when it cannot reach the server.** Opening the sign-in screen while offline — or anywhere the API is unreachable — crashed the whole app instead of showing the login form you could still use.
- **A failed Auto sync now says so.** When a saved Google Sheet import was rejected by the server, the button just stopped spinning with no message — it now shows the error.
- **"Sign in with a passkey" now tells you when no passkey could be used.** Pressing it with only another site's passkey saved did nothing at all, with no explanation.
- **Marking a subscription paid records the payment in your own currency.** The transaction was stamped as US dollars regardless of your settings, so it showed up with a "converted from USD" estimate on it.
- **A subscription you have paid this period no longer offers "Mark Paid" again** — pressing it a second time could only ever fail.
- **Marking a bill paid now sticks, wherever you are.** In local-only mode the bill could pop straight back to unpaid — reliably on the first of the month in the Americas, and just after midnight in Europe. Bills also land on the right day of the month calendar now.

## [5.13.0] — 2026-08-31

### Added

- **Sign in with your device instead of a password.** Add a passkey under Settings → About and your fingerprint, face or screen lock signs you in — nothing to type, nothing to phish, and it counts as two-factor on its own, so there is no code to enter afterwards. Your browser can also offer it straight from the email field.
- **Two-factor authentication with an authenticator app.** Turn it on under Settings → About: scan the QR code with Google Authenticator, Aegis or any other app, and sign-in asks for a six-digit code from then on. You get ten recovery codes to download and keep somewhere safe, for the day the phone is not to hand.
- **Sign in with a code sent to your email**, if you would rather not type a password. Enter the address, we mail a six-digit code, and it signs you in — on the same browser that asked for it, and still behind your second factor if you have one.
- **You can now connect Claude, or any other MCP client, to your account.** Create a personal access token under Settings → API access, choose what it is allowed to do, and revoke it whenever you like.
- **Bank statements can be imported over the API**, in the same formats the Bank Imports tab already understands. Re-importing a statement you have already imported adds nothing.

## [5.12.2] — 2026-08-29

### Fixed

- **The top of the screen is usable again in the iPhone home-screen app.** The status bar sat on top of the page rather than above it, so the clock and battery washed out over the app — worst on the light theme — and the controls beneath them were hard to reach.

## [5.12.1] — 2026-08-27

### Changed

- **A maintenance release: nothing in the app behaves differently.** The work went into the automated checks that run before each release.

## [5.12.0] — 2026-08-26

### Added

- **You can now switch from monthly to annual billing without cancelling first.** Pick Annual on your current plan and the change is applied to the subscription you already have, with the difference added to your next invoice. To move from annual back to monthly, get in touch.
- **Your plan now says whether you are billed monthly or annually.**

### Fixed

- **A new subscription now shows its renewal date straight away.** A first-time subscriber's plan could sit without one for a month.
- **Granted plans no longer show a "Manage or cancel your subscription" link.** There is no subscription behind a granted plan, so the link could only fail.
- **Switching between monthly and annual billing now confirms when it has actually gone through**, instead of saying so straight away.

## [5.11.0] — 2026-08-25

### Added

- **A new version now announces itself with a Reload button.** Update notices appear in the top right and stay long enough to act on, instead of a four-second message at the bottom with nothing to press.
- **Android shows how to install the app** on browsers that never offer an install prompt of their own.

### Fixed

- **Changing your plan no longer leaves you paying for the old one too.** Every tier switch started a _new_ subscription instead of moving the one you already had, so switching a couple of times could leave three running at once, all charging your card — and cancelling any one of them dropped your account to Free while the others kept billing. A switch now changes the subscription you have, and does it without leaving the page.
- **Cancelling and then choosing another plan keeps you subscribed.** The cancellation used to survive the change, so you were billed for one more period on the plan you had just picked and then dropped to Free anyway.
- **Your plan shows up as soon as it changes.** The billing card sat on Free until you reloaded the page, and the plan grid could go on offering to sell you the tier you were already paying for.
- **Checkout works again for returning subscribers.** Anyone who had subscribed before — cancelled and come back, or changed tier — got an error instead of a payment page. A plan that was granted to you now says so, rather than offering billing controls that could not work.
- **Deleting transactions holds the dialog until the rows are actually gone**, shows progress while it works, and says so if it fails instead of closing on an unchanged list. Deletes are faster as well.
- **A row you delete no longer stays in your selection.** The bulk bar kept counting a row that was already gone, and the next bulk action — delete, categorize, tag, reconcile — quietly skipped it. Switching profile with rows selected left the same stale count behind. Rows hidden by a filter are still selected, as before.
- **A first import no longer warns about accounts it is about to create.** The preview judged every transfer against accounts that did not exist yet, flagging hundreds of rows that would have imported fine.
- **"App Crashed" now reloads into the new version** instead of back into the build that crashed.
- **A guided tour no longer takes keys the page is using.** Pressing Enter on the tour's own Next button skipped two steps, an arrow key typed into a field moved the tour instead of the caret, and walking a tour quietly shifted the period you were looking at. Escape still leaves a tour from anywhere.

## [5.10.1] — 2026-08-25

### Fixed

- **A first import no longer rejects every transfer.** Accounts named in the Means of Payment column are now offered for creation like any other, and a transfer that still cannot resolve says which side failed and quotes the name that did not match.

## [5.10.0] — 2026-08-24

### Added

- **Install Token Circles as an app.** It gets its own window and a home-screen icon, with an icon drawn to fill the shape your phone uses. On iPhone and iPad, where no browser offers this, the app explains the Share menu instead.
- **Updates arrive in one clean step, and the installed app opens offline.** The old service worker took over an open page the moment a deploy landed, which is what caused the multi-reload transitions and the occasional blank screen.
- **See where you are signed in, and sign out of one device.** Settings lists every signed-in device — what it is, roughly where from, when it was last active — with the one you are reading on marked. "Sign out on all devices" remains as the separate, deliberate thing it is for.
- **Signing up with a password now confirms your email**, and starting a subscription needs a confirmed address, since receipts, renewal notices and password resets all go there. Nothing is blocked in the meantime, and accounts created with Google are already confirmed.
- **We tell you when a payment fails.** A declined card used to be silent until the plan quietly dropped to Free. The first failed renewal now mails you while the plan is still active, says when the next attempt is, and links to where the card can be replaced.
- **Pick a category icon from a gallery** instead of having to guess what to type.
- **The month control can follow you as you scroll.** Turn on Settings → Appearance → "Keep the period bar in view" and it stays put on Budgets, the Dashboard and Transactions. Off unless you ask for it.
- **The old self-hosted Express server has been removed.** Self-hosting means running your own copy of the Worker on Cloudflare's free tier, and the repository now says so. Nothing changes for anyone using the app. An old Docker image keeps working, but will not get fixes.

### Fixed

- **A backup now always covers the whole account.** Restoring one replaces every profile, so a backup taken while viewing two of your three profiles quietly deleted the third. You can also always restore your own backup, even when it holds more profiles than your current plan allows.
- **One unreadable receipt image no longer costs you the entire backup.** The export saves everything else and tells you how many were skipped.
- **Using the app on two devices at once no longer double-counts.** Paying a bill, populating a recurring transaction, or editing a transaction from both could each apply twice — the last of those leaving an account balance permanently wrong. Saving something another device already changed now says so instead of appearing to do nothing.
- **A blocked captcha no longer looks like a broken sign-in page.** When the verification step cannot load — an ad blocker, a filtered network — the page now says so, names the domain to allow, and offers a Retry that genuinely tries again.
- **Sign-in no longer fails on a stale cookie** left over from using both the live and the preview site in one browser, where clearing site data used to be the only way out.
- **"Too many attempts" no longer counts your successful sign-ins.** Only failures count, a success clears the tally, and the message says how long the wait actually is.
- **A password reset link works exactly once**, and spending it retires any other pending links for the account.
- **Picking a colour no longer closes the category form** before you have finished with the name or the icon.
- **The Allocate Budget form is readable in dark mode.**
- **The plan cards say which way they go.** Every paid plan's button used to say "Upgrade" whatever plan you were on. Cards below yours now say "Downgrade", the plan you are on is marked as yours, and cancelling sits under the line naming your plan rather than only on a card.

## [5.9.3] — 2026-08-23

### Fixed

- **The self-hosted demo reset now actually resets.** "Reseed demo data" stacked a fresh copy of the example holdings and recurring transactions on top of the last run's, and only cleared the profile you happened to be looking at; "Delete all my data" left holdings, recurring transactions, tags, receipts, housing details and import rules behind. Browser-only and cloud storage were already correct.

## [5.9.2] — 2026-08-23

### Added

- **The retirement planner is editable.** It never was: the projection came from server defaults — age 30, retire at 65, 500 a month, 7% — and no control on the page could reach any of it. Every assumption is now a field, and the chart redraws as you type.
- **Simple and Advanced.** Simple asks for a contribution, a return, and what you want to retire on. Advanced projects your income and spending separately, so you can plan a pay rise, a career break or a few years of higher spending, and work the return out from how your money is actually allocated.
- **More than one retirement.** Add a lifestyle for each place or way you might retire; each gets its own target and its own date. Retiring somewhere cheaper is a different date, not a different plan.
- **Your figures, filled in.** Net worth comes from your accounts, income and spending from your transactions, each labelled with where it came from so you can see what was a guess.
- **Inflation is a switch, not a footnote.** On, the chart reads in today's money and the target line is flat — the point of reading it that way is that the number you are chasing stops moving. Off, everything is in future money. Your rate is kept either way.
- **Zoom and pan the chart**, which puts sixty years across half a screen otherwise, and see a marker at the month each lifestyle becomes affordable.
- **The withdrawal rate is a slider that says what it costs.** Raising it looks like more money to live on, when all that moves is the size of pot you are calling enough — so a note under the cards says how long that pot actually lasts, and moves as you drag.

### Fixed

- **The projection was compounding wrong, in your favour, by a lot.** Over thirty years at 7% on 100,000 it reported about 303,000 where the answer is 761,000. Every projection in the app now agrees, and agrees with the arithmetic.
- **The retirement fields can be typed in.** They threw away your keystroke after a single digit, refused to save a figure the app itself had worked out, and quietly unset a value that happened to match a default.
- **In browser-only mode every profile shared one retirement plan.** Each profile keeps its own now.
- **Switching profile refreshes the retirement page**, instead of leaving the previous profile's figures on screen until you reloaded.
- **Sign-in says when the server, not your password, is the problem.** A misconfigured captcha secret used to reject every sign-in as though the credentials were wrong.

## [5.9.1] — 2026-08-22

### Fixed

- **Categories has a place in the sidebar again.** The page was reachable only by accident — the "What's New" tour navigated to it, but it had no sidebar entry, so you landed there with no way in and no way back. It now sits between Transactions and Accounts.
- **The category icon field takes a word, not two characters.** Its own examples — "food", "car", "rent" — were too long to type. It now takes a word and shows the icon that word resolves to.

## [5.9.0] — 2026-08-21

### Added

- **Tags with rules.** A new **Tags** page (sidebar → Analytics) organizes transactions across categories instead of making you invent new ones. Give a tag like "Company" or "Trip to Rome" a rule — a saved filter over description, counterparty, notes, payment method, amount, date, type, categories and accounts — see what it would match before anything is written, then apply it to everything you already have and keep auto-tagging what arrives later.
- **Each tag gets its own view**: income, expenses and transfers for the period, a monthly chart, and which categories the tagged spending falls into — so a "Company" tag reads like a mini profit-and-loss across whatever it spans. Tags on the Transactions page link straight to their filtered list, and you can tag a whole selection of transactions at once.

### Fixed

- **Imports no longer drop rows they can read.** A row with no description was rejected in browser-only mode, so the same sheet imported cleanly in the cloud while silently losing hundreds of rows locally. A row with no date now imports dated today and says so, amounts with more than two decimals are rounded to cents rather than rejected, and a single separator reads as a decimal point (`1,12` is one euro twelve).
- **A spreadsheet cell containing a line break no longer corrupts the import.** The row used to vanish and be replaced by shifted junk rows, with nothing reported.
- **Import rejections name the row** by its date and description, instead of a bare row number to count to in a multi-thousand-line sheet.
- **The daily sync of a saved Google Sheet says what it did** — how many rows it skipped, and how many it imported with a warning. Nobody is watching a sync at 8am.
- **Danger Zone resets now remove everything they say they do**, leaving no account history, loan details, import logs, category links or receipt files behind. Reset Categories restores the same defaults in browser-only and cloud modes.
- **A custom subscription price no longer submits a different amount than the one you typed.**
- **Dark mode follows your operating system** when you have not picked a theme yourself.
- **Unknown addresses show a "page not found" screen** rather than leaving you on whatever page you were viewing.
- **Bill Autopay settings persist** when a bill is created or edited.
- **New accounts use your configured local currency**, including accounts created during an import.

## [5.8.0] — 2026-07-21

### Added

- Undo an import. Each entry under "Recent Imports" now has a Delete button that removes just that import's transactions and recomputes your balances — for cleaning up a mis-mapped or duplicated import without touching anything else.
- The import preview now shows "New accounts to create" next to new categories, so you can see which values become accounts (a transfer's destination) rather than matching an account you already have.

### Fixed

- Imports no longer drop genuine same-day repeats. When your bank records identical transactions on the same day (several small fees, or repeated top-ups of the same amount), they're all kept — flagged as "potential duplicates" you can review, each showing the row it matches — instead of being silently merged into one.
- Transfers between your own accounts reliably link both sides again. A transfer whose destination is an account you have (or one the import creates) no longer loses its second leg and drains the source account — including when the source sheet has stray spaces around a name.
- The transactions list shows a transfer's destination account (e.g. "Erste Current → Revolut") instead of a dash, for transfers between two of your own accounts.

## [5.7.1] — 2026-07-17

### Fixed

- In "Browse catalog" for subscriptions, a price you type now applies when you confirm it with the checkmark (or Enter), instead of snapping back to the default.
- The "Create" button on an empty page — Savings Goals, Housing, and the rest — is centered again instead of stuck to the left.
- Quick Add (⌘K and the + button) now shows the current profile's categories right after you switch profiles, no reload needed.
- The + quick-add now has an "Add transaction" title, and on desktop you can type the amount on your keyboard and press Enter to move on, instead of clicking the on-screen keypad.

## [5.7.0] — 2026-07-17

### Added

- More banks in the importer. Alongside Revolut, Erste and PBZ, Token Circles now reads statements from N26, Wise, ING (Netherlands), Sparkasse and DKB — plus any CSV exported in the YNAB format, which covers a long tail of other banks. It detects the bank for you and prepares the transactions for review, all in your browser.
- A "local-only" choice at the start of setup: run entirely in this browser with no account, and switch back to a synced account any time in Settings.

### Changed

- Signing up drops you straight into the app. After you create an account you're signed in automatically and land in setup — no separate "now sign in" step.
- Bringing in your history during setup is smoother. The main button now carries the real action at each stage ("Continue to preview", then "Import selected") instead of being tucked below a long form, and dropping files shows a clear "drop here" highlight and a spinner while they're read.
- Removing things — subscriptions, accounts, goals, and everywhere else — now asks with a clear pop-up dialog instead of squeezing a yes/no into the row, so the confirmation always fits and reads well.
- Smaller polish: the autopay switch in the bill/expense form matches the app's other switches, the bills calendar's day pop-up is no longer see-through, and supported banks show as tidy pills in the importer.

### Fixed

- Updating to a new release is calm now. An open tab used to sometimes reload several times in a row around a release (occasionally landing on the "Update needed" screen), and the version shown in Settings and on the sign-in screen could lag behind what was actually running. A tab now picks up a release with a single reload at your next navigation, the displayed version always tells the truth, and two releases in quick succession are handled just as smoothly.
- Opening the app offline works better: the installed app now keeps a usable copy of itself for days instead of minutes.

## [5.6.1] — 2026-07-17

### Fixed

- The subscription scan works on hosted accounts again. Scanning your transactions (from Bills, the importer, or the setup wizard) always came back with "no subscriptions found" when signed in to tokencircles.com, even with plenty of recurring charges — it now detects them as intended.

## [5.6.0] — 2026-07-16

### Added

- Guided onboarding. New accounts are welcomed into a short, skippable setup wizard in the app's orbital style: name your space, create your first account, bring your history (bank statements, CSV, or Google Sheets), and adopt the subscriptions we spot for you — then land on your dashboard. Re-run it any time from Settings → About.
- Subscription detection. When you import transactions, Token Circles now recognizes recurring charges from Netflix, Spotify, Claude and 40+ other services — with the price and billing period worked out for you — and offers to track them as subscriptions. Also available from Bills → Subscriptions → "Scan transactions".
- In-place account creation during a bank import: assign each statement to a new account without leaving the importer, so a multi-bank import sets everything up in one pass.
- Branded emails. Your welcome, password-reset, and (on paid plans) budget-alert, spending-report, and upcoming-bills emails now arrive in a polished Token Circles design with a subtle animated orbit, in your own currency, with one-click unsubscribe. Signing up with Google now gets a welcome email too.
- An orbital loading animation replaces the plain "Loading…" screen.

### Changed

- The import preview is cleaner: your stats and the Import buttons sit together up top, with a compact "fill budgets from spending" option below.
- Re-importing a file you've already imported now says so plainly ("everything here was already imported") instead of a confusing "Imported 0" — duplicates are always detected and skipped, so you can safely re-import.
- The sign-in form now flags an invalid email address as you type and explains when the verification step is still loading.

### Fixed

- The Category Allocation and Portfolio orbit charts render correctly again for every number of categories (they could look like a broken ring before).
- Dragging in a larger bank statement no longer occasionally does nothing on the first try.
- Sharper app icon, and no more brief flash of the wrong theme while the app loads.

## [5.5.0] — 2026-07-15

### Added

- Shareable demo links: open a sample profile straight from a link (`?demo=high`, `?demo=mid`, or `?demo=low`) to explore the app with example data.

### Changed

- The app's fonts are now served by Token Circles itself instead of loading from Google — pages render a little faster, work offline, and make no third-party requests.

### Fixed

- No more blank screen after an update. When a new version ships, the app now updates itself cleanly instead of occasionally getting stuck on a white page: it recovers from an out-of-date cache, quietly reloads onto the new version, and — if something still can't load — shows a clear "Reload / Reset app cache" screen instead of nothing. You no longer need to hard-refresh or clear your browser data.

## [5.4.0] — 2026-07-15

### Changed

- Redesigned Settings: a single-column layout with a compact icon sidebar and clearer grouping — General, Exports, Billing, and a new About tab (version, changelog, shortcuts, support, and logs).
- Refreshed buttons across the app to match the Token Circles look, with softer delete buttons that are easier on the eyes.

## [5.3.7] — 2026-07

### Added

- Keyboard shortcuts: press `?` for a guide, or `Ctrl`/`Cmd`+`K` to open the command bar.
- Bank import: pick a worldwide (English) category mapping alongside the Croatian one.

### Changed

- Tidier dashboard — a compact "Views" button, a two-row header, and a one-row period selector (Today, Week, Month, Quarter, Year, and 7/30/90-day ranges).
- Upcoming Bills and the Bills calendar show each bill's real brand or category icon; the Analytics spending heatmap is larger and clearer.
- Premium features (receipts, email alerts) are clearly marked on the free plan instead of failing silently.

### Fixed

- Mobile polish across charts, the bank-import table, and dialogs — no more sideways scrolling on phones.
- Budgets: changing a category's amount works again, and stays editable afterwards.
- Re-running a bank import no longer creates duplicate transactions.
- Sign-in autofill works again on Android and in password managers.
- The Apple subscription icon is visible in dark mode again.

## [5.2.0] — 2026-07-01

### Changed

- Money shows in your selected currency across PDF reports and the dashboard, including currencies with no decimals such as JPY.

### Fixed

- Account balances update reliably and can no longer be left half-applied.

### Security

- Custom reports are now private to your account; sign-in, imports, and cross-origin requests were hardened.

## [5.1.0] — 2026-06-27

### Added

- Delete your account and all of its data from Settings.
- Optional bot protection (Turnstile) on the sign-in and password forms.

### Fixed

- The billing page shows your real plan instead of always reading "Free".
- Spending-report emails are sent once per period, never duplicated.

## [5.0.0] — 2026-06-27

### Added

- Accounts and cloud sync — sign in with Google or email to sync across devices, or keep using the app with no account.
- Plans and billing — Free, Basic, Advanced, and Ultimate tiers.
- Email reminders — budget alerts and a periodic spending report.
- Contact support from within the app.

## [4.0.0] — 2026-05-11

### Added

- Portfolio tracker with live prices and an allocation chart.
- Counterparties — see who owes whom from your transactions.
- Automatic account-balance updates, transfers between accounts, and bulk editing.

## [3.0.0] — 2026-04-01

### Added

- Works offline in your browser, with multiple profiles and demo data.
- Zero-based budgeting, a spending heatmap, an income/expense flow diagram, and PDF reports.
- Receipts, tags, recurring transactions, the Quick Add box, dark and light themes, and an installable app.

## [2.0.0] — 2026-03-15

### Added

- Planning tools — savings goals and loan, housing, retirement, compound-interest, emergency-fund, and rent-vs-buy calculators.
- Bank statement import (CSV and Excel) with column mapping.

## [1.0.0] — 2026-03-01

### Added

- First release — transactions, categories, accounts, a dashboard, budgeting, analytics, and data export.
