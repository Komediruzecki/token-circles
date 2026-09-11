# Field encryption at rest

Status: **implemented, shipping dark.** Nothing changes on a deployment until it is given a
master key (`DATA_KEK_1`). Decided 2026-09-11; supersedes the end-to-end encryption track in
[`../e2ee-research.md`](../e2ee-research.md) and Part B of
[`bank-connectivity-and-encryption.md`](./bank-connectivity-and-encryption.md).

## What this is — and what it is not

**Server-side, application-level encryption.** The Worker holds the keys and decrypts inside
itself to compute, so every feature keeps working: reports, budgets, reminders with real figures,
search, the MCP server and the `/api/v1` API, imports, backup and export.

It protects against someone who gets **the data without the Workers Secrets**:

- a leaked `d1 export` — the deploy pipeline takes one before every migration and keeps it as a
  CI artifact for 30 days;
- a leaked or misconfigured R2 bucket;
- SQL injection or any bug that reads rows it should not;
- anyone with database access who does not also hold the deployment's secrets.

It does **not** protect against the operator, a compromised Worker, or someone holding both the
database and the secrets. It is not end-to-end or zero-knowledge encryption, and that is **not
planned**: bank sync, reminders with amounts, server-side reports and the API all need the server
to read the data, which is exactly why no mainstream budgeting app offers E2EE either.

GDPR Art. 34(3)(a) waives the duty to notify users of a breach of properly encrypted data — a
leaked export without the master key is that case.

## Decisions (2026-09-11)

| Question             | Decision                                                                              |
| -------------------- | ------------------------------------------------------------------------------------- |
| E2EE or server-side? | Server-side. The server keeps the ability to compute; E2EE is dropped.                |
| Tier                 | Not a plan feature at all. No `PlanFeatures` flag, no gate, on every tier.            |
| What is sealed       | Transaction text and receipt files (below).                                           |
| Amounts              | Stay readable. 62 `SUM(amount)` queries across 14 files keep running in the database. |
| Search               | Decrypt, then filter, in the Worker. Substring search behaves as before.              |
| Keys                 | One data key per user, wrapped by a master key held in Workers Secrets.               |
| Existing data        | A background backfill seals it in batches; users notice nothing.                      |
| Rollout              | Local, then dev, then prod — and no prod data is ever used for testing.               |

## What is sealed

| Table / store            | Sealed                                         | Why these                                                                                                          |
| ------------------------ | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `transactions`           | `description`, `beneficiary`, `payor`, `notes` | Who you paid, who paid you, and what for — the identifying part of a ledger.                                       |
| `recurring_transactions` | `description`, `notes`                         | Copied verbatim into the transactions they generate; left plaintext they would reveal exactly what those rows say. |
| `bills`                  | `name`, `notes`                                | Same reason: paying a bill writes its name into a transaction.                                                     |
| R2 receipts              | the object bytes                               | Photos of receipts — the most sensitive artefact in the product.                                                   |

**Readable on purpose:** amounts, dates, types, currencies, category, account and profile ids —
what SQL filters, sorts and sums on.

**Still plaintext, out of scope for this pass:** `category_mappings.pattern` (a normalised copy
of descriptions the categoriser learned), `tag_rules` criteria, account and category names, and
the `notes` columns on accounts, budgets, loans and goals.

**What a leaked database still reveals about a sealed value:** whether it is empty (NULL and `''`
are stored unsealed, below), and its length — AES-GCM ciphertext is exactly as long as the
plaintext plus 28 bytes. Length padding was not judged worth its cost here.

## Key hierarchy

```
DATA_KEK_<n>        Workers Secret: base64 of 32 random bytes. One set per environment —
    |               local, dev and prod never share a key. The highest <n> wraps new keys.
    | wraps
    v
users.dek_wrapped   `dk1.<n>.<iv>.<ct>`: this user's 256-bit data key, AES-256-GCM-wrapped,
    |               bound to the user id by additional data (a key copied to another user's
    | encrypts      row does not unwrap).
    v
that user's sealed columns and receipt objects
```

- **Independent of `JWT_SECRET`.** 2FA derives its key from `JWT_SECRET` (`twofa.ts`), so
  rotating the auth secret orphans every TOTP secret — survivable there because recovery codes
  are hashed. The same coupling here would orphan everyone's history.
- **One key per user**, because profiles are never shared between users (every access check is
  `id = ? AND user_id = ?`), so a user's whole multi-profile household is under one key. A
  household shared _between_ users would need multi-recipient wrapping; it is not in v1.
- **Rotation** retires a master key; it does not change a single data key.
  1. Add `DATA_KEK_2`, keeping 1. New data keys wrap under 2 at once, and the backfill cron
     re-wraps existing ones from 1 to 2, up to 1 000 per run, by compare-and-set.
  2. Wait for `staleKeys=0` in the `[backfill]` log line. `rewrapFailed` counts keys that could
     not be re-wrapped: under a master key already removed, or damaged (those log a `[data-keys]`
     line naming the user).
  3. Remove `DATA_KEK_1` from the Worker. Removing it too early shows at once: `/api/health` says
     `misconfigured` while any key is under a master key that is not configured.
  4. Keep `DATA_KEK_1` itself in Proton Pass. Backups taken before step 2 finished — the deploy's
     `d1 export` artifacts and D1 Time Travel, 30 days each — still hold keys wrapped under it.

  This protects against the old master key leaking _later_. If it has already leaked together with
  a copy of the database, the data keys in that copy are exposed and re-wrapping them changes
  nothing: that takes new data keys and every row re-sealed, which is not built.

- **Deleting an account deletes the only live copy of its key.** It does not make old backups
  unreadable on its own: the deploy's `d1 export` includes `users`, wrapped keys and all, so a
  deleted user's data in a backup still opens with the master key until the 30-day retention
  expires — exactly as plaintext does today. Immediate crypto-shredding would need the keys kept
  outside the data backups; that is a follow-up, not a v1 claim.

**Losing every `DATA_KEK_<n>` a user's key was wrapped under loses that user's sealed data.**
The keys live in Proton Pass, per environment.

## Formats

| What           | Format                                                                                     | Additional data                                        |
| -------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| Text value     | `tc1.<b64url iv>.<b64url ct+tag>`, fresh 96-bit IV                                         | `tc1\|<table>\|<column>\|u<userId>`                    |
| Data key       | `dk1.<n>.<b64url iv>.<b64url ct+tag>`                                                      | `dk1\|u<userId>\|k<n>`                                 |
| Receipt object | `TCE1` · chunk size u32 · 8-byte nonce prefix, then 1 MiB chunks; IV = prefix · u32(index) | `tce1\|receipt\|u<userId>\|<header>\|<index>\|<final>` |

Receipts are chunked because one can be 50 MB and a Worker has 128 MB: an upload streams through
a 1 MiB window rather than sitting in memory beside its own ciphertext. The header, index and
final flag in every chunk's additional data make a reordered, truncated or re-headed object fail
to open rather than open wrong. The additional data does not bind the row id, which the INSERT
storing the value assigns.

## The invariants the code enforces

1. **A user's rows are sealed only once the user has a key, and from then on a missing or wrong
   master key is a hard error** — 503 on reads and writes alike. Nothing falls back to writing
   plaintext for a user whose data is sealed.
2. **`text_enc` is authoritative per row** (0 plaintext, 1 sealed; `receipts.enc` likewise). An
   existing row changes form in exactly one place, the backfill, by compare-and-set.
3. **Edits never read the marker and then write.** `sealedUpdate` sends one batch with both forms
   — `… AND text_enc = 1` sealed, `… AND text_enc = 0` plain — and D1 applies whichever matches the
   row as it stands. This closes the race where the backfill converts a row between an edit's read
   and its write, which would leave plaintext inside a sealed row for good.
4. **`''` and NULL are stored unsealed.** Hides nothing worth hiding, and keeps a column
   `DEFAULT ''` — which an INSERT that omits the column gets unsealed from the database — valid
   inside a sealed row.
5. **No SQL touches a sealed column on the encrypted path.** Filtering, sorting, grouping,
   `DISTINCT`, `COALESCE` and dedup move into the Worker after opening. A deployment with **no**
   master key keeps the original SQL exactly, so its behaviour is byte-for-byte what it was.

## What moved out of SQL, and what it costs

On a deployment with a key: transaction search and text sorts (with pagination and totals), the
summary totals under a search, MCP search, merchant grouping and the counterparty list,
counterparty totals, bill ordering, import dedup, tag-rule matching and category suggestions.

Semantics on that path differ from SQLite's `LIKE` in two ways, both closer to what someone
typing into a search box means: case folding covers all of Unicode (SQLite folds ASCII only),
and `%` and `_` are literal characters rather than wildcards.

Measured in workerd: **~9 µs to open a value, ~2.5 µs to seal one.** The worst case — a
20,000-row ledger, four columns, 80,000 opens — is about 0.7 s of CPU; a typical 2,000–5,000-row
ledger is 70–175 ms. Tag-rule matching, a hot path while a rule is edited, opens only the fields
the rule's criteria reference.

## The backfill

`worker/src/backfill.ts`, on its own trigger `*/20 * * * *` (dev and prod). Each run is bounded —
60 s, 5,000 rows, 50 receipts — and the next run resumes. It seals by compare-and-set against the
exact values it read, so an edit landing in between makes the write miss and the row is retried
later rather than overwritten with the old text. Receipts are resealed to a **new** object key,
the row is swapped to it by compare-and-set, and only then is the plaintext original deleted.

Rows on a profile nobody owns (`profiles.user_id` NULL — legacy data) have no key to be sealed
under and stay plaintext. A user whose key cannot be produced is skipped and logged; everyone
else still gets sealed, and the skipped rows do not count against a run's budget — every run reads
them again from the start, and counted they would use it up before reaching anyone else.

## Rollout — no prod data in testing

1. **Local.** Put a local-only key in `worker/.dev.vars`:
   `DATA_KEK_1=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")`.
   `cd worker && pnpm test` (keyless) must fail fast with a clear message while that line is
   there — remove it for keyless runs; `pnpm test:sealed` runs the whole suite keyed. For the
   backfill: `wrangler dev --test-scheduled`, then
   `curl "http://localhost:8787/__scheduled?cron=*/20+*+*+*+*"`.
2. **Dev.** `wrangler secret put DATA_KEK_1 --env dev` with a dev-only key.
   `GET /api/health` must report `"encryption": "on"`; watch the `[backfill]` log lines until
   `complete=true`; then use the app end to end.
3. **Prod.** Only after dev sign-off, with a separate prod-only key.

Merging deploys to dev and applies migration 0031 there. **Tagging a release applies 0031 to
prod**: schema only — four columns and one partial index, every existing row at `text_enc = 0` —
and with no prod key, behaviour is unchanged. The migration rehearsal for 0031 uses synthetic
data, not a prod export.

## Failure modes

| Symptom                                         | Cause                                                                                   | Effect                                                                                                             |
| ----------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `encryption: "misconfigured"`                   | a `DATA_KEK_<n>` that is not base64 of 32 bytes                                         | writes for users needing a new key fail with 503                                                                   |
| `encryption: "misconfigured"`                   | no `DATA_KEK_<n>` at all while some user holds a data key — a deleted or dropped secret | every read and write of sealed data fails with 503; a search on the keyless SQL path can silently miss sealed rows |
| `encryption: "unknown"`                         | D1 did not answer the health check's query                                              | nothing by itself; ask again                                                                                       |
| 503 "Encrypted data is temporarily unavailable" | master key missing or wrong for a user who has a key                                    | that user's sealed data is unreadable until the key is restored                                                    |
| 500 naming a table and column                   | a stored value failed authentication — tampered, or truncated                           | the request fails; nothing is shown in its place                                                                   |

## Follow-ups

- Immediate crypto-shredding: keep wrapped keys outside the data backups.
- Seal bank and OAuth refresh tokens with the same key hierarchy before any is stored
  (bank-connectivity plan, decision 1).
- The remaining plaintext columns listed above.
- `security.txt` (RFC 9116), still open from Stage 0.
- Cheaper keyed reads. A text sort opens every sealed column of the whole filtered set before
  cutting the page (it needs only the sort column until then); `openRows` decrypts one value at a
  time; and the keyed counterparty, merchant and search scans have no cap. Narrow the sort to
  `id` plus the sort column and fetch the page afterwards, batch the decrypts, and consider
  precomputed counterparty aggregates if a large ledger gets near the CPU limit.
- A sealed receipt download carries no `Content-Length` — the decrypting stream has no known
  length. Nothing in the app reads it today.
- A receipt deleted while the backfill is resealing it can leave the sealed copy in R2 with no row
  pointing at it (ciphertext, not plaintext). A sweep for unreferenced objects would reclaim it.
