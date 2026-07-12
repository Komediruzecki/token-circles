# E2E test conventions

Playwright end-to-end tests live here. They run against the built SPA proxied to the
backend (see `playwright.config.ts`). CI runs the `@smoke` subset on pull requests and the
full suite on `main`.

## Select by `data-test-id`, not by copy

**Structural assertions must target `data-test-id` hooks, never user-visible text.** Matching
on copy (`getByText(/Recent Transactions/i)`, `getByRole('button', { name: /save/i })`,
`locator('button', { hasText: '...' })`) couples the test to wording that product/design change
freely. When the dashboard card "Recent Transactions" was renamed to "Transactions", a
copy-matching smoke test silently went red on every build without a single line of app logic
changing — the failure it reported ("element not found") looked like a data bug and cost real
time to chase. A test-id would have survived the rename untouched.

`playwright.config.ts` sets `testIdAttribute: 'data-test-id'`, so use the built-in locator:

```ts
await expect(page.getByTestId('dashboard-transactions')).toBeVisible()
```

(There is also a `getByTestId(page, id)` helper in `test-helpers.ts` for spots that need the raw
CSS selector.)

### When text matching _is_ correct

Assert on copy only when the copy itself is what you're testing — an i18n string, a specific
error message, a formatted currency value. Even then, scope it to a `data-test-id` element
(`page.getByTestId('dashboard-metric-networth-value')` then check its text) rather than searching
the whole page.

## Naming

Kebab-case, hierarchical, stable across redesigns:

```
{area}-{element}[-{qualifier}]
```

- `area` — the page or feature: `dashboard`, `transactions`, `budgets`, `nav`, …
- `element` — the meaningful node: `header`, `metric-networth`, `transactions`, `link-accounts`.
- `qualifier` — an optional sub-part: `dashboard-metric-networth-value`.

Repeated rows share one id and are queried positionally:

```tsx
<For each={txns}>{(t) => <div data-test-id="dashboard-transaction-item">…</div>}</For>
```

```ts
await expect(page.getByTestId('dashboard-transaction-item').first()).toBeVisible()
```

## Where to put the hook

Put the `data-test-id` on the semantically meaningful container a test needs to find — the page
root, a section/card, a key value, an actionable control, or a list item. Add it to the
component, keep it stable, and don't reuse one id for unrelated nodes.

## Reference implementation

`tests/dashboard.spec.ts` + the ids in `src/features/Dashboard.tsx`,
`src/components/Dashboard/OverviewDeck.tsx`, and the nav in `src/App.tsx` are the worked example
of the above. New/updated specs should follow that shape; existing copy-matching specs are being
migrated to it area-by-area.
