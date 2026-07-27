# Plans: Import Automation — Saved Sheets, Drive Sync & Server Ingestion

Status: **proposal for decision** — nothing here is built yet. Covers three of
the four asks (saved Google-Sheet link, automated statement ingestion, in-app
storage sync). The fourth — bank connectivity (Erste/Revolut/aggregators) and
encryption — is its companion doc
[`bank-connectivity-and-encryption.md`](./bank-connectivity-and-encryption.md).

Each part ends with open decisions. A shared architecture ties them together so
we build one set of primitives, not four features.

---

## The unifying idea — "Connected Sources"

All four asks are the same shape: **a saved, reusable origin that feeds the
import pipeline we already have.** The existing importer already does the hard
parts — parsing, column mapping, a source-agnostic preview table, and
duplicate-skipping against stored transactions — for _one-shot_ uploads. The
only thing missing is the ability to **remember an origin** and **re-run it**
(manually, on open, or on a schedule).

### What already exists (reuse, do not rebuild)

Traced end-to-end; anchor files:

- **`frontend/src/features/import/importFlow.ts`** — `createImportFlow()` is the
  headless controller (all state + actions, no rendering). `flow.currentRows()`
  / `flow.currentHeaders()` are **source-agnostic** — any origin that produces
  `{ headers, rows }` and calls `setUploadResult(...)` / `setSheetResult(...)`
  gets mapping, preview, dedup, and execute for free.
- **`frontend/src/features/import/ImportPreviewStep.tsx`** — the preview table
  we want to reuse. Props are just `{ flow, embedded? }`; it reads everything
  through `flow`. The onboarding wizard
  (`components/onboarding/OnboardingWizard.tsx:216`) already re-embeds the whole
  flow — **reuse is proven, not theoretical.**
- **Google Sheet fetch already works** (public sheets only): serverless
  `core/storage/handlers/importFlow.ts:importGoogleSheet` races published-CSV +
  gviz-JSON + export-CSV + a corsproxy fallback; Worker
  `worker/src/routes/imports.ts:280` does CSV-export only. Reached from the flow
  via `flow.setSheetUrl(url)` + `flow.fetchGoogleSheet()`.
- **Duplicate-skipping already works**, in both runtimes, on every execute:
  `POST /api/import/execute` skips any incoming row matching an existing
  transaction on `date + lower(description) + account_id + type + currency` with
  amount within ±0.01, multiplicity-aware (genuine same-day repeats still
  import). Serverless `handlers/importFlow.ts` / Worker `imports.ts:365`.
- **`import_id`** is stamped per import batch for undo ("Delete import") and
  idempotent retry — re-running the same batch can't double-insert it.
- **Column mapping**: `core/importMapping.ts` `autoDetectMapping(headers)` maps
  headers → the 12 transaction fields by synonym.

### What is missing (the actual new work)

1. **No saved-source entity anywhere.** Greenfield. (The only per-source memory
   today is for bank statements — `core/bankImport/memory.ts` +
   `rulesStore.ts`, localStorage, per-profile — a good copy pattern but not
   cloud-synced.)
2. **`fetchGoogleSheet` has UI side-effects** (`importFlow.ts:994-999` drives
   step navigation) — a background "auto import" needs a **navigation-free
   fetch path**.
3. **No scheduling / background sync** for imports — new (an in-app effect, a
   Worker cron branch, or an external caller).
4. **No Google Drive / OAuth anywhere** — Sheets are read as _public_ CSV only.
   Private Sheets and any Drive listing need a real Google OAuth grant (the
   sign-in OAuth is scope `openid email profile`, stores no token — not
   reusable).
5. **Two runtimes to keep in parity** — every `/api/*` import endpoint has an
   IndexedDB implementation (`core/storage/handlers/*`) _and_ a Worker one
   (`worker/src/routes/*`). Anything new must land in both.

### The Source model

One persisted entity, profile-scoped, kind-tagged:

```ts
type SourceKind = 'google_sheet' | 'google_drive_folder' | 'bank_aggregator' | 'email_inbox';
type Schedule = 'manual' | 'on_open' | 'daily';

interface ImportSource {
  id: string;
  profileId: number;
  kind: SourceKind;
  label: string; // "Main budget sheet", "Erste giro"
  config: Record<string, unknown>; // kind-specific (sheetUrl+gid, driveFolderId, aggregatorAccountId…)
  mapping?: Record<FieldName, string>; // BY HEADER NAME, not column index (see caution below)
  categoryTypes?: Record<string, 'expense' | 'income' | 'account'>; // remembered mapping-step decisions
  defaultAccountId?: number;
  schedule: Schedule;
  lastSyncedAt?: string;
  lastCursor?: string; // optional incremental marker (e.g. max external_id / date)
  createdAt: string;
  updatedAt: string;
}
```

> **Caution (from the code trace):** the flow's live `columnMapping` is
> `Record<field, columnIndex>` — index-based, so it silently breaks if the sheet
> owner reorders columns. **Persist the mapping by header name** and re-resolve
> indices at fetch time.

Persistence mirrors the two-runtime pattern:

- **Serverless** — a new `import_sources` idb store + a local handler.
- **Self-hosted / cloud** — a `import_sources` D1 table (migration `0020_…`) +
  `GET/POST/PUT/DELETE /api/import-sources` Worker routes. Profile-scoped exactly
  like every other table (`profile_id`, `X-Profile-Id` header — see
  `worker/src/profile.ts`).

### Fetch adapters (each yields `{ headers, rows }` or file bytes)

| Adapter              | Source of rows                                                  | Status                                        |
| -------------------- | --------------------------------------------------------------- | --------------------------------------------- |
| `GoogleSheetAdapter` | existing public-sheet fetch                                     | **exists**, wrap it                           |
| `GoogleDriveAdapter` | list a folder → download new files → `/api/import/upload` parse | **new** (needs Google OAuth `drive.readonly`) |
| `AggregatorAdapter`  | Enable Banking → normalize to canonical headers                 | **new** (see companion doc)                   |
| `EmailAdapter`       | forwarded statement attachment                                  | **new / optional**                            |

Everything downstream of the adapter — mapping, preview, dedup, execute — is the
code we already have.

### Runner tiers (the axis behind asks 1, 3 and 4)

The same source can be driven four ways; pick per source via `schedule` + user
opt-in:

1. **In-app manual** — a button. (Ask 1's two buttons; Ask 4's "Sync now".)
2. **In-app auto** — a SolidJS effect on app open / interval when
   `schedule='on_open'`. Headless fetch → `handleImport('new')`. (Ask 4.)
3. **Worker cron** — the daily server routine. A `scheduled` handler already
   exists (`worker/src/index.ts:156`; crons in `worker/wrangler.jsonc`, currently
   `0 8 * * *` + others). Iterate `schedule='daily'` sources, fetch, insert via
   the shared execute logic. **Runs in the platform context with full D1 access —
   no API token needed.** (Ask 3, no extra hardware.)
4. **External push** — your always-on box or a Claude routine calls a **new
   authenticated ingestion API** with a personal token. (Ask 3, dedicated
   server / browser-control alternatives.)

---

## Part 1 — Saved Google-Sheet link with two branded buttons (Ask 1)

### The experience

In **Settings → Import** (or a "Connected Sources" card on the Import page), the
user pastes a Google-Sheet link once, confirms the column mapping once, and it is
saved as a `google_sheet` source. Each saved source renders as an
instrument-panel row: label, masked URL, `last synced 2h ago`, and **two buttons
on the right**:

- **Auto Sync** (primary, azure, orbital glyph) — headless: fetch → apply saved
  header mapping → `handleImport('new')` → toast _"7 new · 3 duplicates skipped"_.
  No modal, no steps. Safe to spam because dedup is automatic.
- **Fetch & Preview** (secondary, glass, preview-grid glyph) — fetch → open the
  **existing `ImportPreviewStep`** in a modal with rows preloaded, so the user
  can accept/reject/skip per row, adjust the date-range filter, review
  new-categories/new-accounts, then commit. This is literally the current preview
  step, hoisted into a modal.

### Why this is ~80% built

- "Fetch & preview" = `flow.setSheetUrl(url)` + `flow.fetchGoogleSheet()` +
  render `<ImportPreviewStep flow={flow} embedded />` in a dialog. All exists.
- "Auto Sync" = same fetch, then `goToMapping()` (auto-detect) → `handleImport('new')`.
- Dedup, undo, import-logs — all already on the execute path.

### The genuinely new work

1. **Source persistence** (Source model above; both runtimes).
2. **Navigation-free fetch** — add a `flow` method (or call
   `apiFetch('/api/import/googlesheet', …)` directly) that fetches + parses
   without driving step navigation, for the headless Auto-Sync path.
3. **Map-by-header** — persist/replay `mapping` keyed on header text; re-resolve
   to indices after each fetch.
4. **The two branded buttons** (design below) + a saved-source list/card + an
   "add source" mini-flow (reuses the Sheets tab of `ImportDataEntry`).
5. **Preview-in-modal** — mount `ImportPreviewStep` outside the full Import page
   (precedent: the onboarding wizard already embeds it).

### The branded buttons (design)

On-brand with the "Orbital Observatory" identity and the existing novel controls
(Command Bar ⌘K, Guided Orbit, `PeriodOrbit`). SVG icons only — **no emoji**
(per project rule) — mono uppercase micro-labels, azure focus glow. Tokens from
`styles/themes/orbit-dark.css`:

- **Auto Sync** — filled azure (`--primary` → `--primary-strong` gradient) with
  `--glow-primary`. Glyph: an **orbital ring with a comet-arrow** that completes
  one revolution on click (the "sync" motion), respecting
  `prefers-reduced-motion`. On hover the ring's glow intensifies; while syncing
  it spins and the label switches to a live `SYNCING · 7 NEW`.
- **Fetch & Preview** — glass surface (`--surface`, `--border`), azure text +
  hairline azure border that lights on hover. Glyph: a **miniature preview grid**
  (three rows, a scanning azure line sweeping down — echoes the preview table).
- The pair sits in a **segmented "instrument" capsule** (one rounded glass
  housing, a hairline divider between the two) so they read as one control, not
  two stray buttons. The warm accent (`--accent-warm`) appears only as a tiny
  "saved" dot / last-sync tick — the one warm touch per view.

A live, on-brand mock of both buttons is provided alongside this plan (see chat).

### Constraints / caveats

- **Published sheets only.** No OAuth today → the saved link must be
  "anyone with the link can view" or File→Share→Publish. Private sheets are a
  later upgrade (Google OAuth `spreadsheets.readonly` — see Part 4).
- **Worker parity is weaker** — CSV-export only, no gviz, no multi-tab (`imports.ts:280`).
  A saved-link feature must tolerate that in self-hosted/cloud mode.
- **Column drift** — handled by mapping-by-header + re-detect; surface a
  "columns changed, re-check mapping" nudge if a mapped header disappears.

### Open decisions

1. Where does the saved-source UI live — Settings → Import, a new top-level
   "Sync" area, or a card on the Import page?
2. Auto-Sync default mode — `'new'` (skip anything that looks like a duplicate,
   safest) vs `'selected'`? Recommendation: `'new'`.
3. Do we let a source auto-sync on app open now (Part 4), or ship manual-only in v1?

---

## Part 3 — Automated statement ingestion: email → Drive → daily (Ask 3)

Your pipeline today: bank emails a statement (Proton/Gmail) → you drop it in a
Google Drive "incoming" folder → it gets processed daily. Four ways to automate
the last mile, ranked for your situation (solo, cloud profile on Cloudflare,
possibly buying an always-on box).

### Option A — Worker cron pulls Drive (recommended: no hardware)

The existing daily `scheduled` handler lists the Drive "incoming" folder,
downloads new files, parses them with the **existing** upload parser, inserts via
the **existing** execute+dedup path, then marks each file processed (move to a
"processed" folder or record its Drive `fileId` in a small ledger table so it is
never reprocessed).

- **New work:** Google OAuth (offline/refresh token) _or_ a service account with
  the folder shared to it; a `GoogleDriveAdapter` (list + download); a cron
  branch in `runScheduledReminders`; a `processed_files` ledger.
- **Cost:** €0. **Hardware:** none. **Auth:** no personal API token needed (cron
  runs in-platform with D1).
- **Best for:** "I don't want to run a server; just have it happen daily."

### Option B — External push via a personal API token (your always-on box / a Claude routine)

Your box (or a scheduled Claude Code routine) watches Drive/email, parses
locally, and POSTs parsed rows to a **new** `POST /api/ingest` authenticated by a
**personal API token**.

- **New work (backend, cleanly scoped):** a `api_tokens` table
  (`user_id, token_hash, scopes, profile_id, …`); accept `Authorization: Bearer`
  in `getAuthFromRequest` as an alternative to the cookie (the auth core is
  deliberately framework-independent — `worker/src/auth.ts:184`); a token-mgmt UI
  in Settings; the `/api/ingest` endpoint (thin wrapper over execute).
- **Cost:** €0 + your box. **Most flexible** (the token also powers a Claude
  routine or any script). **Best for:** you're buying the always-on PC anyway.

### Option C — Browser/Playwright drives the app UI

Automate a headless browser: sign in (or reuse a stored session), drop the file
on the import dropzone, click import.

- **Pros:** zero backend change. **Cons:** brittle (auth cookie refresh, UI
  changes, Turnstile on auth), slowest, most maintenance. **Recommendation:**
  fallback only — prefer an API over puppeteering your own app.

### Option D — Skip Drive: forward the bank email straight in

Point a mail rule at an ingestion address; **Cloudflare Email Routing** delivers
the message to the Worker, which parses the statement attachment and runs
execute+dedup. Ties into the ROADMAP's "Email receipt parsing" item.

- **New work:** an Email Routing worker binding + attachment parse + a
  sender/subject allowlist (security). **Cost:** €0. **Elegant** — removes the
  Drive hop entirely. **Caveat:** statement formats vary; the bank-import
  adapters in `core/bankImport/*` are the parsing basis.

### Recommendation

**A or D need no extra hardware and no token** — start there. Add **B** if you
want the dedicated box regardless (its token is the reusable key for scripts and
Claude routines). **C** only if you refuse to touch the backend. All routes feed
the _same_ execute+dedup path, so they compose.

### Open decisions

1. Runner home for "daily": Worker cron (A/D) vs external box (B) vs both?
2. Google access model: user OAuth with offline refresh token vs a **service
   account** with the folder shared to it (simpler for a single-user Drive)?
3. Do we want the personal API token now (unlocks B + Claude routines + any
   script), or defer until you have the box?
4. Email-in (D): worth doing given variable statement formats, or Drive-only?

---

## Part 4 — In-app sync from Drive / storage (Ask 4)

A `google_drive_folder` source with a **"Sync now"** button and optional
**auto-sync on open**. Same Source model, same preview/dedup pipeline; the
difference from Part 1 is the origin is a _folder of files_ (not one sheet) and it
can run unattended in the browser.

### Design

- **Connect** — a Google **Picker + GIS token client** in the browser grants
  `drive.readonly`; the user picks the "incoming" folder; we save a
  `google_drive_folder` source. (Dropbox/OneDrive later via the same adapter
  seam.)
- **Sync** — list folder → for each new file (by `fileId` not seen before) →
  download bytes → `/api/import/upload` parse → mapping → **execute (dedup
  auto)** → mark `fileId` processed. `schedule='on_open'` runs this silently on
  load behind a user opt-in; `'manual'` is the button.
- **Duplicate-skipping is already solved** at the transaction level; the
  per-file `fileId` ledger additionally avoids re-downloading/re-parsing files.

### Where OAuth tokens live (ties to encryption)

- **Cloud mode** — the Worker stores the Google **refresh token** per user;
  it must be **encrypted at rest** with a Worker-held key (envelope), because the
  server has to use it. This is exactly the "sync tokens live outside the E2EE
  envelope" tension documented in
  [`../e2ee-research.md`](../e2ee-research.md) and expanded in the companion doc.
- **Local (serverless) mode** — the token can stay in the browser (IndexedDB),
  never touching a server.

### Open decisions

1. Providers for v1 — Google Drive only, or also Dropbox/OneDrive?
2. Auto-sync default — opt-in on open (recommended) vs manual-only?
3. Token storage & encryption approach (see companion doc's token-at-rest
   section) — decide before storing any refresh token server-side.

---

## Cross-cutting decisions (decide once, up front)

1. **Source entity home** — new `import_sources` D1 table + idb store (recommended,
   because it must sync in cloud mode) vs overloading `settings`.
2. **DB-level idempotency** — add an optional **`external_id`** column + unique
   index on `transactions` so aggregator/statement rows with a stable bank id
   can't double-insert and support a real incremental cursor? (Recommended for
   Parts 2–3; today dedup is a derived fingerprint recomputed each run — correct
   but not cursor-friendly.)
3. **Personal API token** — build the bearer-token auth path (unlocks Part 3B +
   Claude routines + scripts)? Small, self-contained.
4. **Google OAuth** — adopt Drive/Sheets scopes + token storage (unlocks private
   sheets + Drive sync)? User-OAuth vs service account.
5. **Runner placement for "daily"** — Worker cron (no hardware) vs external box.
6. **v1 scope** — smallest valuable slice is \*\*Part 1 with public sheets, manual
   - preview\*\* (reuses almost everything). Everything else layers on.

## Suggested sequencing

1. **Foundation + Ask 1** — Source entity (both runtimes) + saved public-sheet
   source + the two branded buttons + preview-in-modal + headless fetch +
   map-by-header. Highest value, smallest build. _(1 PR)_
2. **Ask 4 (in-app sync)** — Google OAuth (Drive) + `GoogleDriveAdapter` +
   "Sync now" + opt-in auto-sync on open + `fileId` ledger + token-at-rest
   encryption. _(1–2 PRs)_
3. **Ask 3 (daily automation)** — Worker cron Drive ingestion (Option A) and/or
   Email Routing (Option D); add the personal API token (Option B) if you want
   external push. _(1–2 PRs)_
4. **Ask 2 (bank aggregator)** — `AggregatorAdapter` (Enable Banking) +
   normalization + `external_id`; gated by external onboarding. See companion
   doc. _(1–2 PRs + onboarding)_

Everything shares the Source model + the existing import pipeline, so each phase
is additive and independently shippable.
