---
name: solid-forms
description: The rules for editable form controls in this Solid.js frontend — inputs that keep focus while you type, numbers that can be emptied and can hold a decimal, values rounded so HTML5 step validation cannot block a save, and months picked without scrolling through years. Read BEFORE writing or reviewing any component with an <input>, a <select>, or a <For> over editable rows. These are shipped bugs, each found by a user, each cheap to reintroduce.
---

# Editable controls in this frontend

Four bugs keep coming back. Every one of them ships looking fine and fails only when a
real person types into it, which is why none of them are caught by reading the diff.

## 1. A list of editable rows uses `<Index>`, never `<For>`

**The bug the user sees:** the field loses focus after every single character. Type "4500"
and you get "4", then the caret is gone.

**Why:** `<For>` is keyed _by reference_. The standard update is

```tsx
setRows(rows().map((r, j) => (j === i ? { ...r, amount: n } : r)));
```

which creates a **new object** for the edited row. `<For>` compares references, sees a
different one, disposes that row's DOM and builds it again — so the `<input>` the caret was
in no longer exists.

**The fix:** `<Index>` keys by position. The DOM node is stable; only the value updates.

```tsx
// Wrong — rebuilds the row on every keystroke
<For each={settings().incomeSteps}>
  {(step, i) => <input value={step.monthlyAmount} onInput={...i()...} />}
</For>

// Right — the row survives, the value changes
<Index each={settings().incomeSteps}>
  {(step, i) => <input value={step().monthlyAmount} onInput={...i...} />}
</Index>
```

Mind the flipped signature: in `<Index>` the **item is an accessor** (`step()`) and the
**index is a plain number** (`i`, not `i()`).

`<For>` remains correct for read-only lists, where nothing holds a caret.

**Rule of thumb:** does a row contain an `<input>`, `<select>` or `<textarea>`? Then
`<Index>`. Otherwise `<For>`.

## 2. Never write to a focused field

**The bug the user sees:** the box cannot be emptied — clear it and "0" reappears under the
caret. Or a decimal is impossible, because the keystroke that makes the text "3." is eaten.

**Why:** `value={someNumber}` compiles to an effect that writes to the element whenever the
model changes — including the changes this very field just caused. And a partly-typed
number is not a number: while the text reads `3.` or `-`, `<input type="number">` reports
`value === ''` and enters its bad-input state. Anything that writes to `value` at that
instant discards the text the user can still see.

**The fix:** use `frontend/src/components/NumberField.tsx`. It renders the value once
untracked and syncs from the model only when the element does not have focus. Do not
hand-roll `value={n}` + `onInput={e => set(Number(e.currentTarget.value))}` — that is the
bug, written out.

```tsx
<NumberField
  step="0.01"
  class={styles.formControl}
  testId="retirement-input-networth"
  value={settings().netWorth}
  onChange={(v) => update('netWorth', v)}
/>
```

## 3. Round every derived number, or the form will refuse to save

**The bug the user sees:** an auto-filled field reads `7.292500000001382`, and clicking
Save does nothing.

**Why:** an average is a division, and a division of money produces float noise. HTML5
marks a value that is not a whole multiple of `step` **invalid**, and one invalid field
blocks the entire `<form>` from submitting — the browser puts a validation bubble on a
number the user never typed and cannot fix.

**The fix:** round at every point a number is _produced_, not where it is displayed.
`shared/retirementSettings.ts` exports `round(value, decimals = 2)`; `num()` applies it to
every stored field. Round the averages, and round again after arithmetic on them — a
difference of two 2dp numbers is not itself 2dp.

Match precision to the control:

| Field kind                            | `step`   | decimals |
| ------------------------------------- | -------- | -------- |
| money                                 | `"0.01"` | 2        |
| percentages                           | `"0.01"` | 2        |
| whole things (age, %s of a portfolio) | `"1"`    | 0        |

A `step="0.1"` on a field holding two decimals is the same bug in a smaller coat.

## 4. `<input type="month">` and `type="date"` are not acceptable for anything historical

**The bug the user sees:** picking a birth month means clicking back through thirty years,
one year at a time.

**Why:** Chromium's month picker is a day-calendar with the days removed and steps the year
one click at a time; Firefox offers no picker at all.

**The fix:** use `frontend/src/components/MonthPicker.tsx` — a month `<select>` and a year
`<select>`, styled as one control. Any year is one gesture away and type-ahead works
("1990"). It emits and accepts the same `YYYY-MM` string, so storage is unchanged.

```tsx
<MonthPicker
  class={styles.monthPicker}
  ariaLabel="Date of birth"
  fromYear={NOW_YEAR - 120}
  toYear={NOW_YEAR}
  allowEmpty
  value={settings().birthMonth}
  onChange={(v) => update('birthMonth', v)}
/>
```

A month value has no day in it, so it needs no calendar at all.

## Testing this

None of these are visible in a snapshot — all four pass a test that only checks values.
Assert the behaviour instead:

```tsx
// Focus survival: the same DOM node, still focused, after several keystrokes.
const field = labelled('Monthly income from then');
field.focus();
for (const text of ['4', '45', '450', '4500']) {
  await type(labelled('Monthly income from then'), text);
  expect(document.activeElement).toBe(field); // <For> puts <body> here
}

// Step validity: the guard that actually blocks the save.
expect(field.checkValidity()).toBe(true);
expect(field.closest('form')!.checkValidity()).toBe(true);
```

Make the test helper **focus the input before typing** — these controls deliberately behave
differently while focused, so a helper that does not focus tests the wrong path.

Worked examples: `frontend/src/features/__tests__/retirementPlanner.test.tsx`, in the
`describe('the controls behave like controls')` block.

## Reviewing a diff

Five greps that catch all of it:

```sh
grep -n '<For each' <file>            # any editable row in there? -> <Index>
grep -n 'type="number"' <file>        # -> NumberField
grep -n 'type="month"\|type="date"' <file>   # -> MonthPicker
grep -n 'Number(e.currentTarget.value)' <file>  # hand-rolled, always wrong
grep -n 'step="0.1"' <file>           # will 2dp values live here?
```
