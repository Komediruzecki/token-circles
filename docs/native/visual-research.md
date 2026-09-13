# Native visual research and gallery contract

Keep Token Circles recognizable through its orbit geometry, Observatory/Dawn colors, and occasional Fraunces display type. Replace desktop topology with a mobile task hierarchy. The native operating surface should be quieter than its welcome artwork: fast amount entry and trustworthy data are the purpose of the design.

## Reference gallery structure

The inspected reference is `disjoint-colliders/packages/showcase-gallery`, not a package named `gallery-showcase`. Its `gallery-viewer/native-app.html` is MercuryPitch's phone study; `lumen-native.html` extends the format to phones and tablets. Their useful pattern is a self-contained local research page, reusable device/component rules, screen IDs, explicit states, original visual references and per-screen acceptance notes. The reference also distinguishes product screenshots from generated marketing concepts.

For Token Circles, keep `docs/native/gallery/index.html` beside the versioned master plan while the reference repository remains read-only. Gallery material is review documentation, excluded from the application bundle. An eventual integration into showcase-gallery should add a dedicated `token-circles-native.html`, its source fragments/assets, and one `brand-nav.js` entry on a separate scoped branch; it should not modify MercuryPitch or Lumen pages or replace published product screenshots.

Do not carry over the reference gallery's numerical aesthetic score as evidence of quality. Record actual pass/fail observations, acceptance decisions and links to device evidence. A beautiful static frame does not demonstrate native back gestures, keyboard avoidance, screen-reader behavior or purchase recovery.

## Mobbin observations

These observations come from inspected preview images, accessed September 13, 2026. Mobbin sources are references for behavior and hierarchy, not licensed production assets. Preserve canonical links; preview URLs expire and are not an asset pipeline.

| Inspected reference                                                                         | Observation                                                                                                                                                 | Token Circles implication                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Monarch overview](https://mobbin.com/screens/eff6b2af-549f-4f68-88f0-1a50b8237bbe)         | Persistent labeled tabs distinguish Dashboard, Accounts, Transactions, Cash Flow and Budget. A transaction-review state has plain-language completion copy. | Explicit destinations and meaningful empty/completion states are useful. Avoid reproducing the large vertically stacked dashboard containers.                                                          |
| [Origin spending](https://mobbin.com/screens/d200648c-ec30-4280-b283-bab4ae483fd2)          | Recent transactions have aligned signed amounts, with a spending/budget relationship visible nearby. Its tab set is broad and crowded.                      | Preserve direct numerical hierarchy and recent context; keep Token Circles' primary navigation smaller and its Add action separate.                                                                    |
| [CRED spending summary](https://mobbin.com/screens/7f33e880-f2cb-450b-a1bd-90def15a9e64)    | A strong period total precedes a labeled historical chart and a direct transaction action. Several dark chart labels are faint.                             | Lead with a useful period, provide drill-through, and validate contrast instead of reproducing the faint-on-dark treatment.                                                                            |
| [YNAB transaction flow](https://mobbin.com/flows/5cccbfe6-fea1-46e1-a61f-e6dbdd11fbb7)      | A modal transaction editor places amount/type first, then payee/category/account/date, above a keypad. The type changes the visible amount sign.            | Use amount-first entry, an explicit cancel action and concise field rows. Validate sign/type behavior and keyboard reach. Token Circles will use SVG category icons, not the emojis in this reference. |
| [Buddy add transaction flow](https://mobbin.com/flows/039fb847-de6f-420b-9ed5-07c360627474) | Amount/type remain visible as category, wallet and recurrence choices appear in contextual sheets.                                                          | Preserve entry context and support quick pickers, but avoid a deep chain of stacked sheets that makes back/cancel ambiguous.                                                                           |
| [one year purchase sheet](https://mobbin.com/screens/df0d769a-48b0-46b0-beb4-9f8225d4ce5a)  | Restore/legal links exist beside purchase choices; much explanatory copy precedes the actions.                                                              | Restore and terms must be findable. Token Circles needs concise capability-specific copy and full annual totals, without inventing a lifetime offer.                                                   |
| [Moonly purchase screen](https://mobbin.com/screens/f7877081-db2b-4775-b33b-2fdc2d48eb26)   | The preview has close and restore controls and illustrated promotional content; a large illustration interrupts legibility.                                 | Keep a clear exit and restore action, and keep generated artwork away from purchase consent and prices. This reference does not prove an annual-plan design.                                           |

## Platform guidance

Android's current navigation guidance recommends three to five peer destinations, a distinct primary action, and adapting bottom navigation to a rail on wider layouts. This supports the proposed four destinations and separate transaction creation action; a tablet must make better use of space. [Android layouts and navigation, updated September 11, 2026](https://developer.android.com/design/ui/mobile/guides/layout-and-content/layout-and-nav-patterns)

Android accessibility guidance calls for 48-dp touch targets, text contrast of 4.5:1, non-text contrast of 3:1, labeled elements and non-gesture alternatives. Use these as minimum design checks and verify behavior through the actual WebView/native accessibility bridge. [Android accessibility](https://developer.android.com/design/ui/mobile/guides/foundations/accessibility)

Apple's tab-bar guidance supports persistent, labeled destinations. Its HIG pages are JavaScript-rendered; the retrieved search excerpt supports the navigation observation, while detailed metrics and current platform styling still require a direct HIG/device review. Do not claim that a web preview is a native UIKit tab bar or that CSS blur automatically implements the current system material. [Apple tab bars](https://developer.apple.com/design/human-interface-guidelines/tab-bars), [Apple accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility)

## Concept review

| Concept                 | Strongest idea                                                                                                | What must change in implementation                                                                                                                                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A — Daily orbit         | A clear monthly budget relationship and a strong welcome image; amount-first entry; tablet budget list/detail | Replace ornamental timeline dots with a real selectable period control. Use system numerals for amount entry, a correct decimal keypad, SVG icons and current fixture dates. Avoid turning the overview into a wall of cards.                 |
| B — Daily ledger        | A legible transaction list and a useful tablet reconciliation layout                                          | Use native operating typography instead of the generated serif titles. Receipt and amount in the generated board do not reconcile; authored fixtures must. Do not add unverified split behavior or lifetime offers from unrelated references. |
| C — Account perspective | Account total and budget context stay together; tablet makes room for history and context                     | Do not imply investment growth or net worth when only account balances are shown. Remove arbitrary greeting identities and unapproved slogans. Keep destination labels/icons stable.                                                          |

**Recommended combination:** A's budget-led daily overview and welcome composition with B's transaction list and tablet list/detail. C remains an alternative if account balances should lead the product. The concept decision is pending; choosing a board does not approve every synthetic control, amount or generated phrase.

The three original images live in `gallery/assets/` and their full prompts are in [PROMPTS.md](gallery/PROMPTS.md). Each board has three phone views and a tablet view. All four devices in a board are generated together and are illustrative compositions, not native render captures. The image tool's model version is unverified; use of the available tool was explicitly approved.

## Detailed gallery production after composition and scope approval

Record V01 (composition), D04 (V1 scope) and V05 (first detailed review slice) before producing the dependent detailed frames. Create semantic HTML/CSS/SVG frames at logical resolution, scaled only by the outer gallery. Keep functional text and controls independent of any image. Device presets should include compact iOS, compact Android, iPad portrait and landscape, and Android tablet landscape. Breakpoint behavior in the implemented app will use available window width, not these presentation-device names.

Each screen gets: a stable ID; job and route; current/new capability label; phone and expanded layout; loading/empty/error/offline variants; real-data requirements; native behavior notes; accessibility evidence; implementation phase; and an explicit approval state. The [surface plan](surface-plan.md) owns the coverage inventory.

At minimum, the first detailed review should cover welcome, storage choice, local setup, cloud sign-in, overview, transaction list, new expense with keyboard, transaction detail/receipt, accounts, transfer, budgets, budget detail, insights, export/backup, paid upgrade, existing web subscriber, restore, settings/account deletion and one network/save error. Show tablet overview, transaction list/detail, budget list/detail and settings. Expand advanced screens when V1 scope is confirmed rather than hiding them behind generic placeholders.

## Artwork production list

Generate assets only after the accepted composition shows where they belong. Proposed first production batch:

| Asset                             | Purpose and delivery                                                    | Constraints                                                                           |
| --------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Welcome, Observatory              | Portrait optical orbit sculpture, dark negative space for semantic text | No currency symbols, fake chart values or letters; local-first copy remains live text |
| Welcome, Dawn                     | Independently composed daylight version, not a color inversion          | Readable foreground and meaningful subject crop on short screens                      |
| Onboarding: on this device        | Small calm orbit object suggesting a self-contained space               | Do not imply encryption or physical-device backup                                     |
| Onboarding: optional cloud        | Two orbit planes connected by light, text-free                          | Only use with approved sync language; do not depict people collaborating              |
| First account / first transaction | Small supportive empty-state illustration                               | Keep the task button and explanation dominant                                         |
| Tablet welcome                    | Landscape composition with separate content zone                        | Not a cropped phone image                                                             |

Additional assets for later onboarding, optional promotional backdrops and store artwork can bring the collection to ten, twenty or more if needed. Keep store screenshots grounded in working app builds. Do not generate a decorative background for every operating page.

## Acceptance checklist

- [ ] Composition choice recorded in V01; selected strengths and rejected literal details documented.
- [ ] Every amount/date/account in detailed frames comes from a coherent labeled fixture.
- [ ] Existing mark is used as source SVG; generated substitutes do not replace the brand.
- [ ] Phone forms show the keyboard and the save action together, including smaller height and enlarged text.
- [ ] Tablet panes adapt, with selected state and detail persistence on resizing.
- [ ] Dark and light contrast, tap targets, reduced motion, keyboard focus and reading order checked.
- [ ] Native behaviors that a gallery cannot prove are labeled for physical-device QA.
- [ ] Review pages have no remote fonts, tracking or production API dependency; reference links open only on request.
- [ ] Images and relative links resolve; gallery works at desktop and mobile viewport widths.
- [ ] Original generation outputs and prompt provenance are preserved; unused concepts stay outside application assets.
