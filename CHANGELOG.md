# Changelog

New features and notable fixes in Token Circles, in plain language. The full
technical detail lives in [dev-changelog.md](dev-changelog.md).

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this
project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Pick a category icon from a gallery, instead of guessing its name.** The icon field takes a keyword and finds the matching glyph — "food" gets you the fork and knife — which works nicely once you know roughly what is in there, and not at all before that. Typing was the only way to discover the set, so the icons nobody happened to guess the name of may as well not have existed. There is now a button beside the field that opens the whole gallery, with a filter box for when it grows; click one and it fills the field in. Both when you create a category and when you edit one.
- **Installing the app now looks like installing an app.** The install dialog on Android showed a name, an icon and a URL, because we had never given it anything to show — and the icon it put on your home screen was our square shrunk inside a white circle, since none of our icons were drawn to be masked by the launcher. There is now a maskable icon that fills the shape your phone uses, and the dialog shows the dashboard, transactions and analytics, on both phone and desktop layouts.
- **You can see where you are signed in, and sign out of one device.** The account had a single session control, and it revoked everything: signing out on a laptop silently signed you out on your phone and tablet too, mid-use. Settings now lists every signed-in device — what it is, roughly where from, and when it was last active, with the one you are reading on marked — and each has its own "Sign out" that touches only that device. "Sign out on all devices" is still there as the separate, deliberate thing it is for: a device you no longer have, or a session you think someone else has.
- **The old self-hosted server has been removed.** Token Circles ran on a Node/Express server with a SQLite file long before it ran on Cloudflare, and that code was still in the repository — not deployed, not tested, but complete enough to look current, and complete enough that fixes kept landing in it instead of in the thing people actually use. Self-hosting means running your own copy of the Worker on Cloudflare's free tier; that has been the case for a while, and the repository now says so. Nothing changes for anyone using the app, in the browser or in the cloud. If you are running an old Docker image, it will keep working, but it will not get fixes.
- **Your plan is marked as yours.** The plan grid gave its only coloured border and its only badge to the plan we recommend, so a subscriber could not tell at a glance which one they were actually on — and if the plan they were paying for happened to be the recommended one, the only highlight on the page said "Recommended" rather than "Your plan". The card you are on now carries its own border and badge, on Free as well as on a paid plan.
- **A plain way to cancel.** "Manage or cancel your subscription" now sits directly under the line that tells you which plan you are on, instead of only as a button on one card among several. The button on the card says what it opens: change plan, update your card, or cancel.
- **The app updates in one clean step, and the installed app opens offline.** The old service worker took over an open page the moment a deploy landed, which paired the new build's file list with the page's already-loaded HTML — the multi-reload transitions, and the occasional blank screen that only a hard refresh cleared. The new one keeps you on one complete version until you move, then swaps both halves at once. It also keeps the last version it saw, so the installed app opens without a connection.
- **Install works on the dev site too.** The service worker only ever shipped in the production build, and no browser offers "Install app" to a page without one — so the install button had nothing to offer anywhere but the live site. Both builds now ship it.
- **We tell you when a payment fails.** A declined card used to be silent: Stripe retried for a couple of weeks, ran out of attempts, and the plan dropped to Free — with nothing but a red line in Settings, which only helps if you happen to be looking at it. Now the first failed renewal sends a mail that says the plan is still active, when the next attempt is, and links straight to the page where the card can be replaced. A bank asking you to confirm the payment gets its own, different mail — nothing is wrong there, it just needs a tap. And if the subscription does end, the last mail says so and says your data is still where you left it.
- **A subscription needs a confirmed email address.** Receipts, renewal notices and the way back into your account all go to that address, so the plan buttons wait until it is confirmed and say so, with a Resend link right there — rather than sending you to the payment page to be turned away. Managing or cancelling an existing subscription is never blocked.
- **Install Token Circles as an app.** Settings now offers it where the browser supports it — the app gets its own window and a home-screen icon, without the browser around it. On iPhone and iPad, where no browser offers this to a page, it explains the Share menu instead. Nothing is shown at all on browsers that cannot install, or when you are already running the installed app.
- **Signing up with a password now confirms your email.** The welcome mail carries a "Confirm your email" link; clicking it is the whole job. Until then a strip at the top of the app says so and offers to send the link again. Nothing is blocked in the meantime — the account works either way; confirming just means we can reach you about it, which matters most when you need a password reset. Accounts created with Google are already confirmed by Google and see none of this.

### Fixed

- **A blocked captcha no longer looks like a broken sign-in page.** The verification step is loaded from Cloudflare, and an ad blocker, a privacy extension or a filtered network can stop it arriving. When that happened you got an empty box, the line "Complete the verification above to continue" pointing at nothing, and a Sign in button that stayed greyed out with no way to un-grey it — a login screen that simply does not work, and nothing on it saying why. It now says the verification step could not load, names the domain to allow, suggests the usual causes, and offers a Retry that genuinely tries again. A widget that loads and then errors gets its own message. Nothing changes when the captcha works.
- **One missing receipt image no longer costs you the whole backup.** If a single receipt's stored file could not be read — lost to a storage migration, an upload that never finished — the export refused outright and you got no file at all, which is the worst possible moment for a backup to withhold itself. It now saves everything else, leaves that one receipt out, and says how many were skipped. The transactions those receipts belonged to are kept in full.
- **A backup is always the whole account.** The full backup exported whichever profiles happened to be selected, but restoring one replaces _every_ profile on the account — so a backup taken while looking at two of your three profiles quietly deleted the third when you restored it. The backup file now always covers everything a restore would replace. Per-resource CSV exports are unchanged: those follow your selection, and nothing restores from them.
- **You can always restore your own backup.** A restore was checked against your plan's profile limit, so an account holding more profiles than its current plan allows could not put its own data back — exactly when it matters most. Restoring what you already had is always allowed; going beyond it still isn't.
- **Using the app on your phone and your laptop at the same time no longer double-counts.** Several actions read the current state, decided what to do, and then wrote — and if the same thing happened on another device in between, both writes went through. Paying a bill from two devices took the money twice. Populating a recurring transaction created it twice. Editing the same transaction on both reversed the old amount twice and left the account balance permanently wrong. Each of those now decides and writes in one step: the first one through wins, and the second is told the item changed rather than being quietly applied on top.
- **Editing something that changed elsewhere now says so.** Saving a transaction that another device had already edited or deleted used to close nothing and show nothing — the button simply appeared not to work. It now says the transaction changed on another device and reloads the list so you can see what is actually there.
- **Error messages from the server reach you.** Several parts of the app replaced whatever the server said with "Request failed with status 409", so a clear explanation became a number.
- **A password reset link works exactly once.** Opening the same link twice — a mail app that previews links, a forwarded message — could set the password twice. Spending the link is now the single thing that decides whether it is still valid, and any other pending reset links for the account are retired in the same step.
- **Receipt limits hold when two uploads finish together.** Two uploads arriving at the same moment could both take the last slot on your plan.
- **Signing in with a stale cookie left over from another environment.** A browser that had used both the live site and the preview site ended up holding two session cookies with the same name; the server read whichever the browser happened to list first, which was reliably the older, expired one — so a correct password produced a login screen again, on that browser only, and clearing site data was the only way out. Every cookie sent is now tried, and the one that actually verifies wins.
- **"Too many attempts" after a handful of ordinary sign-ins.** The rate limit counted every attempt, including the successful ones, so signing in and out across a few devices spent the budget meant for someone guessing at your password. Only failures count now, a success clears the count, and the message says how long the wait actually is instead of "please wait a bit".
- **Bank import tells you which file is missing an account.** Pressing "Process & continue" without picking a target account put one line at the top of the page — on a phone, above a fold you are nowhere near by then, so the app looked like it simply did nothing. The file that needs an account now goes red, says "Choose an account for this statement" right under the picker, and scrolls into view. The summary at the top stays.

## [5.9.3] — 2026-08-23

### Fixed

- **"Reseed demo data" no longer stacks up duplicate holdings.** On the self-hosted server every run of the demo reset left the previous run's portfolio holdings and recurring transactions in place and added a fresh copy on top, so a database reset four times listed every example holding four times over — while the app still reported the demo data as restored.
- **Reseeding restores all three example profiles, not just the one you were looking at.** The reset rebuilds the Low/Mid/High Income set, but it only cleared the profile that happened to be active. The other two kept whatever they already held, and a profile that had been emptied some other way came back with its accounts, holdings and goals doubled.
- **"Delete all my data" now deletes all of it.** The same self-hosted reset left portfolio holdings, recurring transactions, tags, receipts, housing details and category import rules behind. Browser-only and cloud storage were already clearing everything.

## [5.9.2] — 2026-08-23

### Added

- **The retirement planner is editable.** It never was: the projection came from server defaults — age 30, retire at 65, 500 a month, 7% — and the page asked for them without passing anything, so no control could reach any of it. You were looking at a fixed picture of someone else's retirement. Every assumption is now a field, and the chart redraws as you type.
- **Simple and advanced.** Simple asks for a contribution, a return, and what you want to retire on. Advanced projects your income and spending separately, so you can plan a pay rise, a job change, a career break, or a few years of higher spending, and work the return out from how your money is actually allocated.
- **Inflation is a switch, not a footnote.** On, the chart reads in today's money and the target line is flat — the point of reading it that way is that the number you are chasing stops moving. Off, everything is in future money, which flatters it. Your rate is kept either way.
- **More than one retirement.** Add a lifestyle for each place or way you might retire; each gets its own target and its own date. Retiring somewhere cheaper is a different date, not a different plan.
- **Your figures, filled in.** Net worth comes from your accounts, income and spending from your transactions, and the retirement target from what you spend now — each labelled with where it came from, so you can see what was a guess and change it.
- **Zoom into the chart.** Sixty years drawn across half a screen puts a decade in a centimetre. Scroll to zoom, drag to pan, pinch on a phone or tablet; the axis relabels itself as you go. Double-click, or the button that appears in the corner, goes back to the whole projection.
- **The chart marks when you reach each lifestyle.** A line at the month it becomes affordable, labelled with that lifestyle's name in its own colour, so you can see where your savings meet the target rather than reading the date off a card and hunting for it on the chart.
- **The withdrawal rate is a slider, and it tells you what it costs.** It is the most misread number on the page: raising it looks like more money to live on, when your spending never changes and all that moves is the size of pot you are calling enough. A chip under the cards now says how long that pot actually lasts — "for as long as you like", or "about eleven years, around age 46" — and it moves as you drag.
- **Every assumption explains itself.** The notes that used to sit under the fields are now behind a small "i" beside each label: hover on a computer, tap on a phone. They were unreachable on a phone before, since a hover is the only thing that showed them.

### Fixed

- **The projection was compounding wrong, in your favour, by a lot.** Investment gains were kept in a separate pile that never earned anything itself, which is simple interest wearing compound interest's clothes. Over thirty years at 7% on 100,000 it reported about 303,000 where the answer is 761,000. Every projection in the app now agrees, and agrees with the arithmetic.
- **The retirement fields can be typed in.** Every one of them threw away your keystroke after a single digit, and the lists of pay steps and spending periods rebuilt themselves as you typed, so the field you were in stopped being the field you were in. Decimals survive being half-typed, and a field can be emptied instead of snapping back to zero.
- **A date of birth is picked, not scrolled to.** The browser's own month control makes you step to 1995 one year at a time. It is a month and a year to choose from now.
- **Saving works instead of being rejected.** A contribution the app worked out for you could arrive as 7.292500000001382, which the form then refused to save because it is not a whole number of cents. Derived figures are rounded to something a person would write down.
- **Saving a figure that happened to match a default quietly unset it.** Type 500 a month, save, switch profiles and back, and it was replaced by a number worked out from your transactions. The same held for a net worth of 0, an income or spending of 0, and a retirement spend of 2000 — the app could not tell "I chose this" from "I never said", so it overwrote your answer every time the page loaded.
- **In browser-only mode every profile shared one retirement plan.** Opening a second profile showed the first one's assumptions, and saving there overwrote them. Each profile keeps its own plan now, and a plan saved before this fix stays with whichever profile opens the page first.
- **Switching profile refreshes the page you are looking at.** Retirement, and every other page kept open behind it, went on showing the previous profile's figures until you reloaded or navigated away and back.
- **"Filled in from your data" stops taking credit for what you typed.** After saving, the note still listed your own entries as though the app had guessed them.
- **Sign-in says when the server, not the password, is the problem.** A missing captcha secret rejected every sign-in as though the credentials were wrong. A misconfigured server now answers as one, logs which half is wrong, and reports its captcha state on the health endpoint.
- Self-hosters on the legacy backend: the Import page and the retirement planner no longer request endpoints that server never had.

### Changed

- **The loading placeholders take the theme's blue** instead of a flat grey that belonged to no theme in particular.
- **Every switch on the retirement page is the app's own switch.** The chart's options sit under it in a compact size, and the two settings inside the form read as settings rows: wording and what it currently means on the left, switch on the right.

## [5.9.1] — 2026-08-22

### Fixed

- **Categories has a place in the sidebar again.** The Categories page was reachable only by accident — the "What's New" tour navigated to it, but it had no sidebar entry, so you landed on a standalone page with no way in and no way back. It now sits between Transactions and Accounts.
- The icon field when creating or editing a category accepted only two characters, while its own example said "e.g., food, home, car" — so none of the suggestions could be typed. It now takes a word and shows, next to the field, the icon that word resolves to. "food", "car" and "rent" each pick their own glyph; anything unrecognized falls back to matching on the category name, as before. Fixed in both the Categories page and the add-category form on Budgets.
- The tick mark on a selected category color sat off-centre in its circle. It is centred now.
- The category icon and its name were touching on the Categories page, with no space between them.

## [5.9.0] — 2026-08-21

### Added

- **Tags with rules.** A new **Tags** page (sidebar → Analytics) turns tags into a way to organize across categories instead of inventing a new one. Create a tag like "Company" or "Trip to Rome", give it a rule — a saved filter over description, counterparty, notes, payment method, amount, date, transaction type, categories, and accounts — then apply that rule to every transaction you already have. Each rule shows a preview ("42 matching, 12 would be newly tagged", with examples) before anything is written, and can keep auto-tagging matching transactions you add later.
- Each tag gets its own view: income, expenses and transfers for the period, a monthly income-vs-expense chart, and a breakdown of which categories the tagged spending falls into — so a "Company" tag reads like a mini profit-and-loss across whatever categories and accounts it spans.
- Tags on the Transactions page are now linkable: "View" on a tag opens the transactions list already filtered to it.
- The Tags page states what it is acting on: selecting a tag is visibly marked and named above its activity and rules, the rule count is a real button that jumps to the rules (it used to look like a badge), Edit happens inside the card being edited rather than above the whole grid, and the rule form is a single readable column in four labelled steps instead of ten inputs packed into four columns. "View" no longer lands on an empty table — when a tag has nothing in the current period the link asks for all time and says why it widened.
- Tag several transactions at once: select rows on the Transactions page and use **Tag** to add or remove a tag across the whole selection. Adding leaves each row's other tags in place, and you can pick existing tags or create a new one on the spot.

### Fixed

- **Imports no longer drop rows they can read.** A row with no description now imports instead of being rejected — previously this happened only in browser-only mode, so the same sheet imported cleanly in the cloud while silently losing hundreds of rows locally. A row with no date imports dated today and tells you so, rather than being thrown away.
- Amounts with more than two decimals — the residue of a currency conversion — are rounded to cents and imported, instead of being rejected as unreadable. The preview lists which rows were rounded so you can correct the sheet if you'd rather.
- A single separator in an amount now reads as a decimal point (`1,12` is one euro twelve), and the preview flags the one shape that could also be thousands grouping so you can check it.
- Import rejections now name the row by its date and description, and a self-transfer says which account both sides landed on and which column each came from — instead of a bare row number to count to in a multi-thousand-line sheet.
- A spreadsheet cell containing a line break no longer corrupts the import: the row used to vanish and be replaced by shifted junk rows, with nothing reported.
- The daily sync of a saved Google Sheet now says what it did: the entry under Recent Imports lists how many rows it had to skip and how many it imported with a warning (a missing date filled in as today, an amount rounded to cents). Nobody is watching a sync at 8am, so those were previously landing in your books unannounced.
- Dark mode follows your operating system when you haven't picked a theme yourself, and keeps following it as you switch back and forth.
- Unknown addresses now show a proper "page not found" screen rather than leaving you on whatever page you were viewing.
- The Transactions, Dashboard and Budgets pages show placeholder shapes while loading instead of the word "Loading".
- Danger Zone resets now remove every matching data type without leaving account history, loan details, import logs, category links, or receipt files behind. Profile-specific actions preserve other profiles, while Reset All consistently clears data across all of your profiles.
- Reset Categories now restores the same defaults in browser-only and cloud modes without leaving transactions or goals linked to deleted categories.
- Account balance fields now accept either a comma or dot for cents without moving the cursor while you type.
- New accounts use your configured local currency, including accounts created during an import; EUR is used when no valid preference is available.
- Custom subscription prices now stay as editable drafts until the checkmark applies them, preserve the cursor while typing, and reject malformed values instead of silently submitting a different amount.
- Bill and housing modals now use a compact orbital title accent, while Autopay is a clean borderless title/subtitle row with a right-aligned switch instead of overlapping text and stacked dividers.
- Bill Autopay settings now persist when a bill is created or edited in both browser-only and cloud storage modes.
- Account-card activity now renders transfers in blue with a neutral `±` prefix instead of presenting them as green income.

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
