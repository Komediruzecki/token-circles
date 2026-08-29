# MCP server and account API

Token Circles exposes a remote MCP server so an AI agent can read your account, analyse it, and
push documents in. It is authenticated with a personal access token, and it reaches only the
account that minted the token.

## Mint a token

Signed in to the app, from the browser console on the app origin:

```js
await fetch('/api/account/api-tokens', {
  method: 'POST',
  credentials: 'include',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'my agent', scopes: ['read', 'write', 'import'] }),
}).then((r) => r.json());
```

The `secret` is shown once. Store it in a password manager; it cannot be recovered.

Scopes: `read` (all reads and snapshot download), `write` (create transactions and accounts,
categorize, tag rules, budgets), `import` (upload statements, list and undo import batches).
Grant the narrowest set that does the job.

Minting is cookie-authenticated only, so a leaked token cannot mint itself more tokens.
Revoke with `DELETE /api/account/api-tokens/<id>`.

## Connect a client

```bash
claude mcp add --transport http token-circles https://api.tokencircles.com/mcp \
  --header "Authorization: Bearer tc_pat_..."
```

## Tools

Call `whoami` first: it returns your profiles, their ids, and the scopes your token carries.
Every tool takes an optional `profileId`, defaulting to the token's profile.

| Tool                      | Scope  | What it does                                               |
| ------------------------- | ------ | ---------------------------------------------------------- |
| `whoami`                  | read   | Account, plan, profiles, token scopes                      |
| `get_overview`            | read   | Balances, net worth, month totals, upcoming bills          |
| `list_transactions`       | read   | Filtered, cursor-paginated transactions                    |
| `summarize_spending`      | read   | Server-side totals by category, merchant, month or account |
| `list_reference_data`     | read   | Accounts, categories, tags, counterparties                 |
| `get_budgets_and_goals`   | read   | Budgets with spend, savings goals, loans                   |
| `export_snapshot`         | read   | Signed URL for a full JSON download                        |
| `prepare_import`          | import | Signed upload URL plus a curl command                      |
| `list_imports`            | import | Recent import batches                                      |
| `undo_import`             | import | Delete one import batch                                    |
| `create_transactions`     | write  | Bulk add, duplicates skipped                               |
| `create_account`          | write  | Add an account                                             |
| `categorize_transactions` | write  | Set category and tags by id                                |
| `upsert_tag_rule`         | write  | Persist a categorization rule                              |
| `upsert_budget`           | write  | Create or adjust a budget                                  |

## Importing a statement

Files are uploaded over plain HTTP, never through a tool argument: a base64'd spreadsheet inside
a tool call would be emitted token by token by the model, which is slow, costly and truncates.

1. `prepare_import` with `mode: "preview"` returns an upload URL and a curl command.
2. Upload: `curl -fsS -X POST "<uploadUrl>" -F "file=@statement.csv"`. The response reports the
   detected column mapping, the date and amount parse rates, and a duplicate estimate. Nothing
   is written.
3. Repeat with `mode: "commit"` to import.

### How the file is read

The server tries the bank adapters first and only falls back to generic CSV if none of them
handles the file. This is the same set the app's **Bank Imports** tab uses — Revolut, Erste, PBZ,
N26, Wise, ING, Sparkasse, DKB and YNAB — so a statement you can drag into the app is a statement
the API accepts.

That order matters because the generic path guesses a column mapping from the first row, which
assumes a file that is already app-shaped: header on line 1, one signed amount column, UTF-8,
comma-separated. Bank exports usually aren't. An Erste statement is Windows-1250, semicolon-
delimited, carries a bank preamble above its header row, and splits debit and credit across
`Isplate`/`Uplate` rather than signing a single column. Its adapter knows all of that; generic
header-guessing cannot.

The response says which parser ran:

| Field           | Meaning                                                                |
| --------------- | ---------------------------------------------------------------------- |
| `parsedBy`      | `bank:<id>` when an adapter handled it, `generic-csv` for the fallback |
| `bank`          | `{ id, label, confidence }`, or `null` on the generic path             |
| `targetAccount` | The account the rows were booked against                               |

Two query parameters tune it:

- **`account=<name>`** — the app account this statement belongs to. Without it the adapter falls
  back to its own label (`Erste`), and the response carries a warning saying so. Pass it on any
  routine you leave unattended.
- **`bank=<id>`** — force an adapter instead of detecting one, for a file whose name and contents
  give nothing away. An unknown id is rejected rather than silently falling through.

The account named by `account=` is created if it does not exist yet, so the rows always belong to
something. On the generic CSV path, where the means-of-payment values are whatever the file says
rather than a name you chose, creating accounts from them stays opt-in behind
`autoCreateAccounts=true`; without it those rows import unattached, and the response lists them
under `newAccounts`.

Columns are auto-detected on the generic path. The server refuses the file if fewer than 95
percent of rows have a readable date and amount — a mis-detected date column would otherwise
import as a pile of transactions dated today.

New categories are not created unless you pass `autoCreateCategories: true`. Rows import
uncategorized instead, which is the safer default when nobody is watching.

**Leave `importId` unset on a repeating routine.** A fresh id relies on content deduplication and
adds only genuinely new rows, leaving previously-imported transactions and any categorization
you applied since alone. Pinning a stable id makes a re-run _replace_ that batch: the old rows
are deleted and reinserted, and the categorization goes with them.

Supported formats are CSV and XLSX. For a PDF statement, parse it yourself and call
`create_transactions` with the rows.

The Worker cannot see the category and transfer rules you edited in the browser — those live in
that browser's local storage. API imports use the same defaults the app ships with, so a
statement imported this way may categorize differently from the same file dragged into the tab.

## Analysing locally

`export_snapshot` returns a download URL rather than the data. Curl it to a file and analyse the
file — do not paste the contents back through a tool call.

Receipt image bytes are excluded by default: they are large, and they answer no question a
spending analysis asks. Pass `includeReceiptFiles: true` for a genuine full backup.

## Limits

- Upload: 10 MB per file.
- Tool results: 200 KB on the wire. A result travels twice in one response — once structured,
  once as text for clients that don't read structured results — so the budget is 100 KB of
  payload. Larger results are refused with a message telling you to narrow the filters or use
  `export_snapshot`.
- Lists: 500 rows per call, cursor-paginated.
- Rate limits: 240 MCP calls per minute, 30 imports per 5 minutes, 10 snapshots per 5 minutes.
  The API import quota is separate from the app's own, so a routine cannot spend the budget you
  need to import a file by hand.
- Upload and download URLs expire after 15 minutes and work for one purpose only.
