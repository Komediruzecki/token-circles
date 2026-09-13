# Native planning verification

Research and review date: September 13, 2026. Token Circles base: `fef628e6918eb1d80938c48c9c6eba2463ae642a`. Task branch: `feat/native-app-plan-and-design`.

## Completed deliverable

The branch contains planning documents, a static research gallery, three generated phone/tablet concept boards, and a formula-driven subscription workbook with reproducible inputs. It does not yet contain a native application package, detailed accepted screen wireframes, platform projects, dependencies, migrations or native release workflows.

The product audit inspected the shipping Solid frontend, Cloudflare Worker, D1 migrations, R2 receipt handling, storage adapters, billing catalogue and authentication. Reference applications and personal planning were read as evidence; MercuryPitch, BesideCue, Chaos Master and disjoint-colliders were not edited. The reference audit records exact revisions and separates shipped implementation from transitional scaffolding and older plans.

Independent review reconciled platform-floor proposals, receipt cost limits, authentication decisions and release checklist identifiers. The decision register is the authoritative approval queue; recommendations remain unchecked until the owner accepts them.

## Artifact checks

- Repository dependencies installed with `pnpm install --frozen-lockfile`; no lockfile change.
- Local Markdown/HTML destinations and gallery image paths checked for existence; JSON inputs parsed and illustrative proceeds checked against independent arithmetic.
- Gallery inspected in the in-app browser at its default desktop size, 393 × 852 phone viewport and 1024 × 1366 tablet viewport. No document-level horizontal overflow or broken images were observed. Wide comparison tables intentionally scroll in labeled, keyboard-focusable regions.
- Anchor navigation, concept image links and the subscription review section were inspected. The preview returned HTTP 200.
- Workbook formulas were recalculated and perturbed across VAT modes, refunds, fee credits, RevenueCat thresholds, annual charges, catalog/channel selection and unknown versus zero operating costs. The exported workbook had no cached formula errors. Every sheet and supporting calculation/source area was rendered and visually inspected. See the [workbook verification details](research/economics/README.md).
- The repository's normal pre-commit formatting and pre-push typecheck/lint hooks are retained. Their final outcome is reported with the task-branch handoff. No hooks are bypassed.

No runtime behavior changed, so this pass does not add or claim native behavior tests. Existing web/Worker functional suites and native device builds are not represented as having run. The workbook was verified with Artifact Tool; desktop Microsoft Excel was unavailable for application-level verification.

## Visual evidence and limits

The three original images are design concepts generated with the available ChatGPT image tool, as approved by the owner. The tool does not expose a selectable or verified “2.5” model version. Exact prompts and provenance are in [PROMPTS.md](gallery/PROMPTS.md).

These boards are neither implemented app screenshots nor complete wireframes. Generated text, icons, receipt values, dates and keyboard glyphs need replacement with correct, coherent UI fixtures. Detailed iOS/Android phone and tablet screens, accessibility states and production art follow the composition and scope decisions. Browser viewport checks validate the research page, not VoiceOver, TalkBack, native keyboards, safe areas, back navigation or device performance.

## Inputs that remain unverified

Actual store agreements and program eligibility, live Stripe Price tax behavior, merchant registrations, subscriber mix, retention, infrastructure usage and operating costs were not accessed. Financial tables are scenarios. Unknown expenses keep actual profit unavailable in the workbook.

Published policy and SDK requirements were checked against primary sources dated in their respective documents. The October 1, 2026 Apple EU and Google US changes require a fresh accepted-agreement and effective-date check before implementing purchases and again before submission. The plan distinguishes EU from non-EU EEA storefronts.

Native storage durability, secure storage plugin choice, account linking migration, unsigned iOS/Android builds and purchase lifecycle behavior require later implementation evidence. No production account, database, billing product, contract, store listing or release was changed.

## Local review preview

The gallery is served at [http://127.0.0.1:4386/gallery/](http://127.0.0.1:4386/gallery/). The process is bounded to three hours from launch. Restart from any working directory with:

```sh
rtk proxy timeout 10800 /home/maff/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 -m http.server 4386 --bind 127.0.0.1 --directory /home/maff/.codex/worktrees/0dac/token-circles/docs/native
```

This is a local static preview with no environment secrets. It binds only loopback and fails if port 4386 is occupied. Keep its terminal running; stop a foreground restart with Ctrl+C. If the existing preview is still active, use it rather than starting a duplicate. The HTML and assets also remain available directly in the repository after the preview expires.
