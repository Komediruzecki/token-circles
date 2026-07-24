# Account balance currency invariant

TokenCircles stores every account `balance`, `starting_balance`, and balance-history
entry in the profile's single base currency.

Transactions retain two values:

- `amount` and `currency`: the original source value.
- `amount_local`: the value converted to the profile base currency.

Only `amount_local` (falling back to `amount` for legacy base-currency rows) changes
account balances. A transfer applies the same base-currency value to both account
legs. This is intentional: the transaction schema has no second native-currency
amount for a destination account, so native-currency account ledgers would be
ambiguous for cross-currency transfers.

The base currency is persisted in `settings.currency`. It can be chosen before
financial data is added. Changing it later is rejected because existing
`amount_local` values cannot be safely re-denominated without a dedicated FX
migration.

For legacy installations that have no persisted base-currency setting, the first
explicit Settings choice adopts the existing numeric balances as that currency and
normalizes account currency labels. It does not invent an exchange rate. Users whose
legacy starting balances were entered in native foreign currency must reconcile those
balances once in the chosen base currency.
