# Form errors: one answer, one schema, one kit

Status: **design, with the first slice (categories) being built on `feat/form-errors`**
Date: 2026-10-07, decisions recorded 2026-10-08. Written on PR #599 (`fix/dev-check-polish`,
664fd0c6); rebased onto main (d92626fe) once #599 and #601 merged.

## Decisions (2026-10-08)

1. **#601 merges first.** Done: this branch is rebased onto main with #599 and #601
   (`git rebase --onto origin/main 664fd0c6`), and #601's `publicError` and `errorResponse` carry
   `fields`. `worker/test/category-refusals.test.ts` fails if a refusal's `fields` stop reaching
   the client, and `error-response.test.ts` pins the answer.
2. **The refusals stay, with one rule: an edit that sends a field's stored value unchanged is
   never refused.** Old rows can hold a 3-digit or named colour, a name over 100 characters, a
   type the app does not read, or two names that differ only in case, and the edit forms send
   every field they show on every save. So an edit checks only the fields whose value it changes,
   and the duplicate check runs only when the name changes, compared case-insensitively with the
   row's own stored name: a case-only rename of itself is allowed. Both runtimes, and the form.
3. **A parent from another profile is a 400 with `fields.parent_id`** in both runtimes. The Worker
   used to answer 403.
4. **One `CategoryDialog` is a follow-up** (Later).
5. **Placements confirmed**: Retirement and RetirementPlanner in PR 4; Housing, Portfolio and Tags
   in PR 5; auth and support in PR 6.
6. **Success toasts quote a name in straight double quotes**, the style the app's visible copy uses
   most: at the fork point, 19 strings use straight double quotes and 4 use curly ones, and every
   toast that quotes uses straight ones. #599 standardised on straight apostrophes for the same
   reason. Goals gaining a success toast is fine.
7. **The busy state is in the kit**, so every form inherits it: while a save runs the submit button
   reads "Saving…" or the form's own verb ("Adding…"), the form is `aria-busy`, and the button
   stays focusable (`aria-disabled`, not `disabled`). Busy labels use the ellipsis character, as
   39 of the app's 66 busy labels do.

## Why

On the local-first demo, creating a category with the icon field left blank failed. The only
feedback was a toast that said "Failed to save category" after a router answer of "Validation
failed": no message at the field, no red border. Typing any icon made it save. The blank icon is
fixed on #599. This workstream is about everything around it: a refused form says what is wrong,
at the field that is wrong, in the same words in both runtimes.

## What the code does today

Measured on #599's head (664fd0c6).

- **The client drops the reasons.** The local-first router answers a refused body with
  `400 { error: 'Validation failed', details: [{ field, message }] }`
  (`frontend/src/core/validation.ts` `validateBody`), and the messages are zod's own. The typed
  client's `request()` (`core/api.ts`) reads `error` (or `message`) and nothing else; the raw
  helpers' `parseJsonResponse()` reads `error` only. Nothing in `frontend/src` reads `details`: the
  only readers are `core/__tests__/validation.test.ts` and the console-message detectors described
  under Risks.
- **The Worker validates almost nothing with a schema.** zod covers only the money fields of a
  transaction (`worker/src/validation.ts`), throwing `HttpError(400, 'Invalid transaction: amount:
must be a positive number')`. Every other route hand-checks a few fields and answers
  `{ error: '<its own sentence>' }`. 208 `HttpError(4xx)` refusals across 23 route files.
- **Four client surfaces, not two.** The typed `api.*` goes through `request()`. The raw
  `apiGet/apiPost/apiPut/apiDelete` call `apiFetch` and parse with `parseJsonResponse()`. Two components
  (three forms) call `apiFetch` directly and read the body themselves (`EmailCodeLogin`,
  `TwofaChallenge`), and
  `SupportContact` calls `fetch` with no `apiFetch` at all. Only the first two are in scope for
  `ApiError`; the other two keep their own handling (they are auth and support forms, last in the
  rollout).
- **The surfaces already differ.** A 401 on a write dispatches `auth:required` from `request()`
  and from nothing else. A non-JSON error body (a Cloudflare 502 page) becomes `Error('HTTP 502')`
  in `request()` and `Error('Invalid response format')`, with no status, in the raw helpers. A
  network failure surfaces as the browser's `TypeError` ("Failed to fetch") on both.
- **Forms barely mark errors.** 21 `<form>` elements in 18 files. `aria-invalid` appears in 3
  components (`LoginScreen`, `AccountSelect`, `SubscriptionCatalogModal`). No `<label>` in the
  category forms is tied to its control.
- **Toasts carry the failures.** 75 single-line toasts start with "Failed to", "Could not" or
  "Couldn't" (42 `showToast`, 28 `toast`, 5 `addToast`) in 27 files. 20 toasts print a caught
  error's `.message` directly (`err.`, `error.` or `e.message`), in 9 files: Tags (6), Settings
  (5), Loans (2), OnboardingWizard (2), and one each in RecurringSection, ResendVerification,
  CompoundInterestCalculator, EmergencyFundCalculator and Transactions. Transactions' save prints
  one more through a variable (`const message = error instanceof Error ? error.message : ...`).
- **HTML validation does the client-side checking**, where there is any. `required` on the name
  makes the browser show its own bubble and swallow the submit, so the form never runs its own
  code for an empty name, and a name of three spaces passes the browser and fails the server.

## Inventory: the 21 forms

Surface: **raw** = `apiPost/apiPut` helpers, **typed** = `api.*` through `request()`,
**apiFetch** = direct `apiFetch` with a hand-read body, **fetch** = plain `fetch`.

| #   | Form (file:line)                     | Entity          | Endpoints                                                               | Client-side checks today                                                      | A refusal shows as                                            | Surface  | PR  |
| --- | ------------------------------------ | --------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------- | -------- | --- |
| 1   | `features/Categories.tsx:476`        | category        | `POST /api/categories`, `PUT /api/categories/:id`                       | `required` on name                                                            | toast "Failed to save category"                               | raw      | 1   |
| 2   | `features/Budgets.tsx:1346`          | category        | same as 1                                                               | `required` on name                                                            | toast "Failed to save category"                               | raw      | 1   |
| 3   | `features/Bills.tsx:1017`            | category        | `POST /api/categories`                                                  | `required` on name                                                            | toast "Failed to add category"                                | raw      | 1   |
| 4   | `features/Goals.tsx:877`             | category        | `POST /api/categories`                                                  | `required` on name                                                            | toast "Failed to create category"                             | raw      | 1   |
| 5   | `features/Transactions.tsx:1382`     | transaction     | `POST /api/transactions`, `PUT /api/transactions/:id` (+ tags, receipt) | 7 JS checks, each a warning toast ("Please enter a description", ...)         | toast of the raw error message                                | typed    | 2   |
| 6   | `features/Accounts.tsx:582`          | account         | `POST /api/accounts`, `PUT /api/accounts/:id`                           | `required` on name; balance parse, as a toast                                 | toast "Failed to create account" / "Failed to update account" | raw      | 2   |
| 7   | `features/Goals.tsx:709`             | savings goal    | `POST /api/savings-goals`, `PUT /api/savings-goals/:id`                 | `required` name and target; decimal sanitiser                                 | toast "Failed to save goal"                                   | raw      | 3   |
| 8   | `features/Bills.tsx:878`             | bill            | `POST /api/bills`, `PUT /api/bills/:id`                                 | `required` name, amount, due date                                             | toast "Failed to save bill"                                   | raw      | 3   |
| 9   | `features/Loans.tsx:751`             | loan            | `POST /api/loans`, `PUT /api/loans/:id`                                 | `required` on five fields; a hand-rolled `type="number"` (solid-forms rule 2) | toast "Failed to save loan"                                   | raw      | 4   |
| 10  | `features/Retirement.tsx:458`        | retirement goal | `POST /api/retirement-goals`, `PUT /api/retirement-goals/:id`           | `required` on all; ages 18-100, return 0-20                                   | toast "Failed to save retirement goal"                        | raw      | 4\* |
| 11  | `features/RetirementPlanner.tsx:452` | retirement plan | `PUT /api/retirement/settings`                                          | none (NumberField, MonthPicker; the server normalises)                        | toast "Failed to save your retirement assumptions"            | raw      | 4\* |
| 12  | `features/Housing.tsx:443`           | housing expense | `POST /api/housing`                                                     | `required` name and amount; due day 1-31                                      | toast "Failed to save housing expense"                        | raw      | 5\* |
| 13  | `features/Portfolio.tsx:483`         | holding         | `POST /api/portfolio/holdings`, `PUT /api/portfolio/holdings/:id`       | `required`; then a toast "Please fill all required fields"                    | toast "Failed to save holding"                                | raw      | 5\* |
| 14  | `features/Tags.tsx:543`              | tag             | `POST /api/tags`, `PUT /api/tags/:id`                                   | none: an empty name returns silently, with no feedback at all                 | toast of the raw error message                                | typed    | 5\* |
| 15  | `components/LoginScreen.tsx:302`     | session         | `/api/auth/login`, `/register`, `/forgot-password`                      | email format at the field (`aria-invalid`); password length in the form error | form-level text, the raw error message                        | typed    | 6\* |
| 16  | `components/LoginModal.tsx:243`      | session         | `/api/auth/login`, `/register`                                          | required and length, in the form error                                        | form-level text, the raw error message                        | typed    | 6\* |
| 17  | `components/EmailCodeLogin.tsx:125`  | sign-in code    | `/api/auth/email-code/request`                                          | email required                                                                | form-level text, the body's `error`                           | apiFetch | 6\* |
| 18  | `components/EmailCodeLogin.tsx:194`  | sign-in code    | `/api/auth/email-code/verify`                                           | 6 digits                                                                      | form-level text, the body's `error`                           | apiFetch | 6\* |
| 19  | `components/TwofaChallenge.tsx:82`   | 2FA code        | `/api/auth/2fa/verify`                                                  | code present                                                                  | form-level text, the body's `error`                           | apiFetch | 6\* |
| 20  | `components/ResetPassword.tsx:142`   | password reset  | `/api/auth/reset-password`                                              | length, match                                                                 | form-level text, the raw error message                        | typed    | 6\* |
| 21  | `components/SupportContact.tsx:192`  | support message | `/api/support/contact`                                                  | email and message present                                                     | form-level text, the raw error message                        | fetch    | 6\* |

\* Not placed by the brief. Recommendation under Rollout.

The Transactions form has no inline category creation, and neither has the command bar or the
guided entry: they pick from the active profile's list. The category flows are the four forms
above, plus one-click colour swatches on the Categories and Budgets cards (`PUT /api/categories/:id
{ color }`), which have no form in front of them and keep a toast.

### Editing surfaces that are not `<form>` elements

These write through the same endpoints and belong to the same PRs, though they have no `<form>`:
the Budgets page's budget, allocate and rollover modals (PR 3); the Categories page's Set Budget
modal (PR 3); Goals' contribute action (PR 3); Loans' rate periods and prepayments (PR 4, today a
toast "Month and amount are required"); `ProfileModal` and the sidebar's profile create (PR 4);
the Settings page (PR 4); the import flow, bank rules and connected sources (PR 4);
`RecurringSection`, `SubscriptionCatalogModal`, `SubscriptionScan` and `OnboardingWizard`
(recommended for PR 5).

## Categories: local-first against the Worker, today

| Rule                    | Local-first (`validation.ts` zod + `handlers/categories.ts`)                           | Worker (`routes/categories.ts`)                                                           |
| ----------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| name, create            | required, trimmed, "Category name is required"; zod `min(1)` first                     | required, trimmed, "Category name is required"                                            |
| name, edit              | zod `min(1)`: " " passes and is stored                                                 | **no check**: `''` is stored, `null` hits `NOT NULL` and answers 500 with D1's text       |
| name length             | 100                                                                                    | none                                                                                      |
| duplicate name          | create only, **case-insensitive**                                                      | create only, **exact match** ("Food" and "food" both allowed)                             |
| duplicate on rename     | none                                                                                   | none                                                                                      |
| type                    | **required**, `income` or `expense`                                                    | optional, default `expense`, **any string stored**                                        |
| color                   | **required**, `#RRGGBB`                                                                | optional, default `#6b7280`, any string; a non-string throws in `.trim()` and answers 500 |
| icon                    | blank becomes `tag` (#599)                                                             | blank becomes `tag` (#599)                                                                |
| tax_deductible          | must be a boolean                                                                      | any truthy value; **an edit without it clears it**                                        |
| parent                  | must belong to the profile, 400                                                        | must belong to the profile, **403**; **an edit without it clears it**                     |
| unknown keys on an edit | written into the IndexedDB row as sent                                                 | ignored                                                                                   |
| refusal body            | `{ error: 'Validation failed', details: [zod messages] }` or `{ error: '<sentence>' }` | `{ error: '<sentence>' }`                                                                 |

Where they disagree on what is valid, a person sees it:

- **Editing an imported category fails in local-first only.** The read schema accepts four types
  (`income`, `expense`, `transfer`, `account`), because older imports wrote `account`-typed
  categories before the importer learned to make accounts of them. The local update schema
  accepts two, so saving any change to such a category answers "Validation failed". The Worker
  accepts it.
- **A body without a type or colour fails in local-first only**, though the local handler has
  defaults for both: `validateBody` refuses it before the handler runs.
- **The Worker stores what the read schema then refuses.** A category saved with type `savings`
  makes `CategorySchema` throw on every `api.getCategories()` for that profile.
- **An edit on the Worker silently clears `tax_deductible` and the parent**, because the
  Categories form sends neither. No form sets either today, so nobody has seen it; the tax report
  reads `tax_deductible`.

## Other entities: where the runtimes disagree

From `validation.ts` against each Worker route; each PR re-checks its own entities in detail.

- **Transactions.** Local refuses type `deduction` (the Worker and `shared/transactionInvariant.ts`
  allow it), requires `description`, a `YYYY-MM-DD` date and a `category_id` key; the Worker
  requires none of those. The Worker checks two decimals; local does not.
- **Accounts.** Local requires `type` from four values; the Worker defaults it to `giro`. A 409
  base-currency conflict carries a useful sentence that the Accounts form drops for "Failed to
  create account".
- **Budgets.** Local requires amount, period and start date; the Worker checks only that the
  category is the profile's.
- **Bills.** Local accepts an amount of 0, the Worker refuses it; local requires a frequency from
  five values, the Worker stores any.
- **Savings goals.** Local requires a positive target; the Worker accepts 0.
- **Loans.** Local requires every field; the Worker checks none. A loan without a name answers 500
  with D1's text, and `interest_rate || 5.0` turns a 0 % loan into a 5 % one (outside this
  workstream; noted under Later).
- **Housing.** The local schemas are registered as `/api/housings`, but the route is
  `/api/housing`, so they never run. (They would refuse the form: they require a purchase price
  the Housing form does not send.)
- **Profiles and tags.** Both runtimes refuse a duplicate name; tags compare exactly on the Worker.

## Design

### 1. One answer from both runtimes

A refused body answers **400 `{ error: string, fields?: Record<string, string> }`**.

- `fields` maps a body field's name to one sentence that says what is wrong and how to fix it:
  "Give the category a name." The keys are the body's keys, so a form whose values are named like
  its body (all of them) maps them without a table.
- `error` is a summary for a client that cannot place fields: an older frontend, an API client, a
  form that has no field of that name. It is every field message in order, joined with a space.
  A degraded client therefore still shows "Give the category a name." rather than "Validation
  failed".
- Other statuses answer `{ error }` in plain words. Unexpected 500s are generic since #601
  (`worker/src/error-response.ts`).

On the Worker, `HttpError` (`worker/src/http.ts`) gains an optional `fields`, and #601's
`publicError` and `errorResponse` (the app's `onError`) send it. A route turns a failed check into
that error with one call (`accept(...)`, below). This keeps the existing pattern, a refusal is a
throw, and lets PR 2 convert `validateTransactionCreate` without changing its callers.

In the local-first router, `validateBody` answers the same body. Categories go through the shared
check; every other entity keeps its zod schema until its PR, but its issues are translated into a
field and a plain sentence ("Fill in the name.", "Choose a frequency from the list.") instead of
zod's text. `details` goes: nothing reads it.

### 2. One schema per entity, in `shared/`

`shared/` cannot import zod. The Worker is installed outside the pnpm workspace, the root has no
zod, so a bare `import 'zod'` from `shared/` resolves in neither bundle, and the frontend's zod
must load `zodConfig` before any schema is defined (CSP). The existing shared validators
(`transactionInvariant.ts`, `importRowChecks.ts`) are plain TypeScript for the same reason. So is
this:

```ts
// shared/refusal.ts: the contract
export type FieldErrors = Record<string, string>;
export interface Refusal {
  error: string;
  fields?: FieldErrors;
}
export type Checked<T> = { ok: true; value: T } | { ok: false; fields: FieldErrors };
export function refusalOf(fields: FieldErrors): Refusal; // error = every message, joined

// shared/categorySchema.ts: the category, for the form, the local handler and the Worker route
export function checkCategoryCreate(body: unknown): Checked<CategoryInput>;
// An edit of a stored row: only the fields whose value the body changes are checked and returned.
export function checkCategoryEdit(body: unknown, stored: object): Checked<Partial<CategoryInput>>;
export function renamesCategory(storedName: unknown, name: string): boolean; // not by case alone
export function categoryNameTaken(name: string): FieldErrors; // the duplicate-name refusal
export function sameCategoryName(a: string, b: string): boolean;
```

Rules for every entity schema:

- Messages are written for people, say what to do, and name no internals.
- **A blank optional field takes its default**, on a create and on an edit: a blank icon is
  `tag`, a blank colour `#6b7280`, a blank type `expense`. A field left out of an edit is left
  alone.
- Valid means what the store can hold and the read schema accepts. A category's type is one of
  the four the read schema knows, so imported categories can be edited.
- Checks that need the database (a duplicate name, a parent in another profile) stay in the
  handler and the route, with their message from the schema module, so both runtimes still say
  the same thing.

For categories the shared rules settle every disagreement above: the name is required and at most
100 characters on a create and an edit; a duplicate is case-insensitive in both runtimes, and a
rename onto an existing name is refused too; type, colour and icon have defaults; an edit that
leaves out `tax_deductible` or the parent keeps them; unknown keys are dropped. A parent from
another profile is refused at `parent_id` with a 400 in both runtimes; no form sends a parent yet.

**An edit checks only what it changes** (decision 2). A field sent back with the value the row
holds is neither checked nor written, so a row saved under older rules can still be edited: a
colour-only edit of a category whose name is over 100 characters saves. What the edit changes is
checked like anything else. The duplicate check runs only when the name changes other than in case
or surrounding space. "Unchanged" is strict equality with the stored value, so the comparison needs
the row: the Worker route and the local handler run `checkCategoryEdit(body, row)` after loading
it, and the local router has no category PUT entry in `validateBody`. The form runs the same check
against the values it opened with.

### 3. One client error type

```ts
// frontend/src/core/apiError.ts
export class ApiError extends Error {
  readonly status: number; // HTTP status; 0 when no answer arrived
  readonly fields: Readonly<FieldErrors>; // {} when the answer had none
}
export function apiErrorFrom(response: Response): Promise<ApiError>;
export function plainMessage(error: unknown, fallback: string): string;
```

- `request()` and `parseJsonResponse()` both throw `await apiErrorFrom(response)` for any non-2xx.
  `.message` is the answer's `error` (or `message`), else a plain sentence for the status, so a
  non-JSON 502 says "Token Circles isn't answering right now. Try again in a moment." on both
  surfaces. `status` stays where `errorStatus()` and the 409 handling read it.
- `apiFetch` turns a failed network request to the API into `ApiError(0, ...)`, with a sentence
  that depends on `navigator.onLine`. An abort passes through untouched. Both surfaces get it for
  free, and so do the direct `apiFetch` callers.
- An older Worker answers without `fields`; `fields` is `{}` and the form shows the summary.
- `plainMessage(error, fallback)` is the one way to put a failure in a toast: an `ApiError`'s
  words, or the caller's fallback for anything else (a `TypeError` from a bug says nothing a person
  can act on).

### 4. The form kit: `frontend/src/components/form/`

```ts
const form = createForm({
  initial: { name: '', type: 'expense', color: DEFAULT_COLOR, icon: '' },
  check: (values) => fieldErrorsOf(checkCategoryCreate(values)), // {} when fine
  send: async (values) => { await saveCategory(values); close() }, // throw to refuse
  failure: "Couldn't save the category. Try again.", // when the error carries no words
})

form.values.name           // a store: read it in JSX
form.set('name', value)     // returns value; re-checks every field a submit has marked
form.reset(values?)         // open for an edit; drops the answer to a send still in flight
form.error('name')          // the field's message, or undefined
form.notice()               // the form-level message, or undefined
form.submitting()           // true while send() runs
form.submit                 // what the <form> runs on submit
form.attrs                  // spread on the <form>: noValidate, onSubmit, aria-busy while sending
```

```tsx
<form class={styles.modalBody} {...form.attrs}>
  <FormNotice form={form} />
  <Field form={form} name="name" label="Category name" class={styles.formGroup}
         labelClass={styles.formLabel}>
    {(control) => (
      <input {...control} type="text" required class={styles.formControl}
             value={form.values.name} onInput={(e) => form.set('name', e.currentTarget.value)} />
    )}
  </Field>
  <Field form={form} name="color" label="Color" group ...>
    {(control) => <div {...control} class={styles.colorPicker}>...swatches...</div>}
  </Field>
  <SubmitButton class={styles.btnPrimary} busy={form.submitting()} busyLabel="Adding…">
    Add Category
  </SubmitButton>
</form>
```

- `Field` renders the label (`for` the control, or `aria-labelledby` for a `group` such as the
  swatches), the control, the error and the hint. The control gets `id`, `name`, `aria-invalid`
  and `aria-describedby` (error first, then hint).
- `[aria-invalid="true"]` inside a field gets a border in `--danger`. The message uses a new
  `--danger-text` token, set in both themes for 4.5:1 on the modal surface; `--danger` itself is
  4.4:1 on the light theme's white.
- `FormNotice` is a `role="alert"` region for what belongs to no field: offline, a 500, a field
  the server named that this form does not show.
- On submit the kit runs `check`. Errors mark their fields and focus moves to the first invalid
  control in DOM order; nothing is sent. Otherwise `send` runs; an `ApiError` with `fields` marks
  the fields this form has (registered by its `Field`s) and puts the rest in the notice; one
  without `fields` puts its message in the notice; anything else puts `failure` there.
- A marked field is re-checked as it changes, so its message goes as soon as it is fixed. An
  unmarked field is never checked while typing. A server mark (a duplicate name) goes on the first
  change, because the client check cannot know it still holds.
- `novalidate` on the form (from `form.attrs`), `required` kept on the control: the browser stops
  swallowing the submit, and assistive technology still hears "required".
- While `send` runs, `form.attrs` sets `aria-busy="true"` on the form and a second submit does
  nothing. `SubmitButton` reads `busyLabel` ("Saving…" by default) and is `aria-disabled`, not
  `disabled`: a disabled button loses focus, which drops a keyboard user at the top of the page.
  A click on it while busy submits nothing. The kit's stylesheet gives it the look a page's own
  `:disabled` rule would have.
- It follows solid-forms rules 1 to 4; it renders no list of editable rows and no number field.

The category's form logic lives once, in `features/categoryForm.ts` (the values, the shared check,
the create or update call, the success toast): `createCategoryForm({ color, editing, onSaved })`
returns the form plus `open(category?)`, which fills it for a new category or an edit. Each of the
four places keeps its own markup and look, built from `Field`, `FormNotice` and `SubmitButton`. A
create or an edit sends only the four fields the dialogs show, so an edit cannot clear a parent or
a tax flag. An edit is checked with `checkCategoryEdit` against the values `open` filled in, so a
row saved under older rules can be edited without its name or colour being refused.

### 5. Toast policy

A form's errors stay in the form: no failure toast from a converted form. Toasts are for success,
undo, and work with no form in front of the person (a swatch click, a delete, a background
reload). Those failure toasts go through `plainMessage`. A success toast that names what was saved
quotes it in straight double quotes: `Added "Coffee" to your categories.` (decision 6).

### 6. Guards

- `frontend/src/__tests__/toastErrorMessages.test.ts` scans `src` for a toast that prints a caught
  error's `.message`, directly or through a variable assigned from one a few lines above. It allows
  today's 20 by file and count (21 at the fork point; #599 fixed one in Transactions), fails when a
  file goes over its count (a new one), and fails when a file goes under (shrink the list). A
  converted file is not on the list, so it is held at zero. The scanner is tested on samples it must
  and must not flag.
- Unit tests for the kit, `ApiError` on both surfaces and in both modes, and the shared schema.
- Worker tests for the categories routes' refusals and the `fields` passing through
  `errorResponse`.
- Per-form tests on the real local-first router: a bad submission marks the field and sends
  nothing; a server refusal marks the field; no failure toast.
- E2E per converted form, cloud and local-first: a bad submission marks the field.
- Rule 5 in `.claude/skills/solid-forms/SKILL.md`.

## Rollout, one PR each

1. **Contract, `ApiError`, kit, categories.** Forms 1-4, the swatch toasts, the shared category
   schema in the form, the local handler and the Worker route; the generic local translation for
   every other entity.
2. **Transactions and accounts.** Forms 5 and 6, the inline Cash account in the Transactions form.
   Shared schemas for both; `validateTransactionCreate/Update` move onto the transaction schema;
   the seven warning toasts become field errors. Decide `deduction` and the required
   `description`.
3. **Budgets, goals, bills.** Forms 7 and 8, the budget, allocate, rollover and Set Budget modals,
   goal contributions.
4. **Loans, profiles, settings, import.** Form 9, the rate period and prepayment forms,
   `ProfileModal` and the sidebar create, Settings, the import flow and its rules, and forms 10
   and 11 (Retirement, RetirementPlanner): the retirement settings next to the loans and settings
   work. Confirmed 2026-10-08.

Added to the plan, and confirmed on 2026-10-08:

5. **Housing, portfolio, tags, recurring and subscriptions.** Forms 12-14, `RecurringSection`,
   `SubscriptionCatalogModal`, `SubscriptionScan`, `OnboardingWizard`. Fix the dead housing schema
   keys here.
6. **Auth and support.** Forms 15-21. They already show errors in the form, so the change is
   field placement, `aria-invalid`, and moving `EmailCodeLogin`, `TwofaChallenge` and
   `SupportContact` onto `ApiError`. Rate-limit and captcha answers need their own wording.

## Risks

- **Deploy skew.** The frontend and the Worker deploy separately (a push to main deploys both to
  dev; a tag deploys both to prod, one workflow each). A new frontend on an old Worker gets
  `{ error }` with no `fields`: the client check has already caught the empty name, and anything
  else shows the Worker's sentence in the notice. An old frontend on a new Worker reads `error`
  and shows the summary, which is now a plain sentence. Local-first ships inside the frontend, so
  its router and client cannot skew.
- **The new Worker refuses what the old one stored**: a type outside the four, a colour that is
  not `#RRGGBB`, a name over 100 characters, a case-insensitive duplicate, a rename onto an
  existing name. Only the app writes categories (no MCP or v1 tool does; the importer inserts its
  own rows), and the app's forms cannot produce any of them except the two duplicates. It refuses
  them when a create or an edit sets them, never when an edit sends a row's own value back.
- **Old rows.** Local-first rows written before #599 can have `icon: null`, no `tax_deductible`,
  or the importer's `account` type; cloud rows can have names over 100 characters, an off-palette
  or 3-digit colour, or a twin that differs only in case. An edit sends the form's whole body, so
  each runtime compares it with the stored row and checks only what changed (decision 2): an old
  row saves with its old values, and a case-only rename of one twin is allowed. Reads are
  unchanged: `normalizeCategory` and `CategorySchema` still accept every stored shape.
- **The two client surfaces.** Anything wired into only one of them drifts (#574 was exactly that).
  `ApiError` is built by one function, `apiErrorFrom`, which both call, and the network case is
  converted in `apiFetch`, which both pass through. The tests run each case through both surfaces.
- **Console detectors.** The release suite (`tests/release/release-fixtures.ts`) and
  `quick-entry-phone.spec.ts` treat a console line containing `Validation failed` in local-first as
  a bug: a write the local schemas refused. The local router keeps logging
  `[routeApiRequest] Validation failed` for every schema refusal, categories included, so those
  detectors still see one. A category edit is checked in its handler, against the stored row, so
  the handler logs `[categoriesUpdate] Validation failed` for the edits it refuses. A form's own
  client check now stops most bad submissions before they reach the router at all.
- **#601.** It replaced `app.onError` with `errorResponse` (`error-response.ts`). It merged first,
  and the rebase carried `fields` through `publicError` and `errorResponse`. A Worker test fails
  if a refusal's `fields` stop reaching the client, so a later change cannot drop them quietly.
  Its two D1-leak tests had sent the category edit a null color, which the edit now stores as
  the default; they send it to a stand-in route that writes the column unchecked.

## Test strategy

- **Shared schema** (`frontend/src/core/__tests__/categorySchema.test.ts`): every rule and
  default, create and edit, every message, the summary.
- **Worker** (`worker/test/category-refusals.test.ts`): each refusal's status, `error` and
  `fields`; the duplicate rules; an edit keeping `tax_deductible` and the parent; defaults stored;
  a parent from another profile at `parent_id`; and edits of rows seeded in D1 under older rules
  (3-digit and named colours, a name over 100 characters, an unreadable type, case twins, a
  foreign parent), each sending its own values back and saving, while a changed bad value is still
  refused. Each was run against the old route first and fails there.
- **Local-first router** (`core/storage/__tests__/categoryRefusals.test.ts`): the same cases
  through `routeApiRequest`, with the old rows seeded in IndexedDB, the generic translation for one
  other entity, no `details`, the console line kept.
- **ApiError** (`core/__tests__/apiError.test.ts`): both surfaces, both modes, 400 with and
  without `fields`, a non-JSON 502, a network failure offline and online, an abort.
- **Kit** (`components/form/__tests__/`): no message while typing first time, marking and focus on
  submit, re-checking a marked field, server fields and the notice, `aria-*` wiring, groups, and
  the busy state: the label, `aria-disabled` without `disabled`, focus kept, `aria-busy`, one send.
- **Forms** (`features/__tests__/categoryForms.test.tsx`): each of the four forms against the real
  local-first router: an empty name marks the field and stores nothing; a duplicate marks the name
  with the server's sentence; a blank icon stores `tag`; no failure toast; the success toast's
  words. Categories and Budgets also edit a row saved under older rules.
- **E2E** (`frontend/tests/category-form-errors.spec.ts`), cloud and local-first: an empty name
  marks the field with its message; a duplicate is marked with the server's message; a blank icon
  saves as `tag`. The Bills, Goals and Budgets dialogs: an empty name marks the field. Signed in,
  a held save shows the busy button, keeps focus on it, and marks the form `aria-busy`.
- **Guard**: the toast scan and its sample tests.
- Every fix of behaviour has a test that fails on the old code; the report lists which.

## Later

- **Fifteen pages reload through `refetchOnActive` with no newest-answer guard.** Two overlapping
  reloads can land out of order and show the older answer. Moving the guard into the shared helper
  (`core/pageVisibility.ts`) is a data-layer change for its own PR.
- **One `CategoryDialog` instead of four** (decision 4). Bills and Goals use a native colour input
  and have no icon field; Budgets has no icon gallery. Merging them is a design decision, so this
  PR keeps each look and shares only the logic (`categoryForm.ts`).
- `request()`'s response-schema failure throws "API Response Validation failed for /x", which the
  toasts that print `.message` show as is.
- A 401 on a write fires `auth:required` from `request()` only; the raw helpers do not.
- The local router answers an unexpected handler error with the raw `err.message` and status 500,
  as the Worker did before #601.
- A loan's `interest_rate || 5.0` on the Worker stores a 0 % loan as 5 %.
- The housing schema keys (`/api/housings`) in `validation.ts` never match the route.
