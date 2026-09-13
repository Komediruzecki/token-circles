# Subscription economics workbook

The deliverable is [native-subscription-economics.xlsx](../../outputs/native-subscription-economics.xlsx). Read the [subscription research](../subscriptions-and-economics.md) before choosing a payment channel. Its policy review is dated 13 September 2026 and separates the announced 1 October changes from current terms.

The workbook contains three sheets:

- **Unit economics:** the six current EUR prices across ten payment channels, with the payment calculation directly below the comparison. Outputs are after transaction tax and modeled refunds, before middleware and operating expenses.
- **Assumptions:** one editable input for every rate, tax treatment, refund credit, selected catalog/channel row, example volume and cost. Blank costs mean unknown. Published sources and material model limits are kept beside these inputs.
- **Monthly model:** selected-channel collections, RevenueCat gross tracked revenue, fee allocation, contribution and operating profit. Annual cash collection is distinct from earned revenue. Profit remains unavailable until matching-period revenue and expenses are supplied.

Default 25% tax and 1,000 charges are examples. The USD/EUR factor of 1.00 is illustrative, not a market quote. A zero US iOS external fee is a sensitivity, not verified final contract terms. Neither the workbook nor the JSON files configure application billing.

`assumptions.json` owns the initial research inputs. `calculated-example.json` is an unrounded, generated snapshot under those defaults; changing workbook cells does not update the JSON snapshot.

## Rebuild

The builder uses the bundled `@oai/artifact-tool` package and creates its temporary module link and previews outside the repository. It does not use repository dependencies. Run it with the bundled Node runtime:

```sh
rtk proxy /home/maff/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node docs/native/research/economics/build-workbook.mjs
```

For a different installation, set `CODEX_ARTIFACT_NODE_MODULES` to that runtime's dependency directory and use its Node executable. Rebuilding overwrites the workbook with JSON defaults, so preserve any manually entered business inputs before rebuilding.

## Verification performed

The builder recalculates and checks representative six-price results against independent arithmetic. It changes and restores inclusive/exclusive tax treatment, refund rate, RevenueCat volume below and above its threshold, catalog/channel selections, annual tracked revenue, and blank versus explicit zero costs. It also checks a complete recognized-revenue/expense example, then restores missing business inputs. The final formula-error scan and exported XLSX cached-error scan found no errors.

Every sheet and the supporting catalog, channel mapping, calculation build, and source areas were rendered and visually inspected. Formula evaluation was verified with Artifact Tool; desktop Microsoft Excel was not available for a separate application-level test. No store, Stripe, RevenueCat or production account was changed.
