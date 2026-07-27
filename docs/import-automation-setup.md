# Import automation setup (daily sheet sync + email-in)

The two server-side automations from the import-automation plan. Both run on the Cloudflare
Worker, so they apply in **self-hosted** or **managed-cloud** mode — not local-only (there's no
server to run them). Design: [plans/import-automation.md](plans/import-automation.md).

---

## 1. Daily auto-sync of a saved Google Sheet

Zero setup, no credentials — it reuses a saved source.

1. Import page → **Connected sources** → add a Google-Sheet link (must be shared "anyone with
   the link can view", or File → Share → Publish).
2. Toggle **Daily** on the source (the pill only appears in self-hosted / cloud mode).
3. The Worker's existing daily cron (`worker/wrangler.jsonc` → `triggers.crons`, `0 8 * * *`)
   runs `runScheduledSheetSyncs` (`worker/src/import-sync.ts`): it fetches each `schedule='daily'`
   sheet, resolves its saved **by-header** mapping against the current header row, and imports
   only new rows via the shared `executeImport` (dedup is automatic — re-syncing a growing ledger
   never creates duplicates and never disturbs earlier transactions). Each run that lands or skips
   rows is recorded as **"Google Sheet (daily sync)"** in Recent Imports (and is undoable there).

Required columns must still resolve (date + amount); if the sheet owner renames/removes them, that
source is skipped for the day (a manual **Fetch & preview** will surface the mismatch).

---

## 2. Email-in — forward a statement, it imports itself

Cloudflare Email Routing delivers a forwarded bank-statement email to the Worker's `email()`
handler (`worker/src/import-email.ts`), which parses CSV/XLSX attachments, auto-detects columns,
and imports them (dedup automatic) into a configured profile.

### Configure the Worker

```bash
# The auth token — it lives in the ingest address's +tag, so keep it long + random.
wrangler secret put EMAIL_INGEST_SECRET --env prod
```

Set these as vars (in `wrangler.jsonc` `env.prod.vars`, or the dashboard):

- `EMAIL_INGEST_PROFILE_ID` — the profile id that emailed statements import into.
- `EMAIL_INGEST_ALLOWED_SENDERS` — optional comma-separated sender allowlist (recommended: your
  own forwarding address). If unset, any sender that knows the address is accepted.

If `EMAIL_INGEST_SECRET` or `EMAIL_INGEST_PROFILE_ID` is unset, email-in is disabled (rejects).

### Configure Cloudflare Email Routing

1. Dashboard → your domain → **Email Routing** → enable it (adds the MX/TXT DNS records).
2. Add a rule: a custom address (e.g. `ingest@yourdomain.com`) or a catch-all → action
   **"Send to a Worker"** → select this Worker.

### Wire up forwarding

- Your ingest address is `ingest+<EMAIL_INGEST_SECRET>@yourdomain.com`. Only mail to that exact
  `+tag` is accepted (the secret _is_ the address).
- In Gmail/Proton, add a filter: when a bank statement arrives → forward to
  `ingest+<secret>@yourdomain.com`. Add that forwarding address to `EMAIL_INGEST_ALLOWED_SENDERS`.

The Worker reads CSV/XLSX attachments, auto-maps columns (Date + Amount required; Description,
Category, Currency, Type used when present), imports with dedup, and logs **"Email import
(<filename>)"** in Recent Imports.

### Limits (v1)

- Attachments must be **tabular CSV/XLSX with a header row**. Raw bank layouts that need
  bank-specific parsing aren't auto-mapped here — use the manual **Bank Imports** tab for those.
- Only attachments are read; the email body is ignored.
- A message with no importable attachment is rejected (bounced), so a misconfigured forward is
  visible rather than silently dropped.
