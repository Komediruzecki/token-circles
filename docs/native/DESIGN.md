# Token Circles mobile design system

The mobile surface inherits the Orbital Observatory and Dawn identity. It does not inherit the desktop composition. The operating scene is a short, frequent money-management task in varied light, so both light and dark surfaces receive first-class design; the device appearance is the proposed default, with a saved explicit override.

## Durable identity

| Role             | Observatory | Dawn      |
| ---------------- | ----------- | --------- |
| Ground           | `#0a0e1c`   | `#f7f9ff` |
| Secondary ground | `#0e1430`   | `#eef2fc` |
| Surface          | `#131c39`   | `#ffffff` |
| Primary text     | `#eaf0ff`   | `#101830` |
| Secondary text   | `#9fb0d6`   | `#5a6788` |
| Action           | `#6e9bff`   | `#3b6fe0` |
| Warm accent      | `#f0a860`   | `#d97f2e` |
| Income           | `#7dffb0`   | `#14985a` |
| Expense          | `#ff9d9d`   | `#d64550` |
| Transfer         | `#93b4ff`   | `#5468d4` |

These values come from `frontend/src/styles/themes/orbit-dark.css` and `dawn-light.css`. They are the starting tokens, not a claim that every possible pairing passes contrast. Verify the actual foreground/background/size combination, especially charts and muted labels.

Use the existing orbit mark as an SVG, with thin ring geometry only where it expresses a relationship, a measured quantity or the brand. A budget arc must have a clear denominator, textual amount and category context. Do not turn money management into collectible tokens or imply cryptocurrency. Income/expense colors have a semantic role and are accompanied by signs and labels.

## Typography and controls

Keep Fraunces for occasional welcome or editorial display because it is a confirmed Token Circles brand face. Use a platform system font for native operating screens; test an Inter alternative as a design decision. Use tabular numerals for amounts, without forcing a monospace face across all content. Never render functional text into an image.

Use restrained opaque operating surfaces, clear large titles and dividing space between row groups. Welcome and onboarding may carry original, cinematic orbit artwork. Artwork recedes completely from transaction entry, authentication, purchase consent and error recovery. No emoji, ornamental currency coins, unexplained scores, oversized dashboard mosaics or desktop navigation scaled into a phone.

## Interaction contract to validate

- Persistent labeled primary destinations; creating a transaction is an action rather than a fake destination. Preserve independent navigation history per destination.
- iOS back affordance and edge gesture, Android system/predictive-back semantics, dismissible sheets with explicit alternatives, safe areas and keyboard-aware forms.
- 44-point iOS and 48-dp Android minimum targets as design targets, mapped and verified on real devices. Body text must remain readable under system font enlargement; screens reflow instead of shrinking.
- Restrained transition motion and optional haptic confirmation after a successful action; reduced-motion path uses immediate or subtle opacity changes. No continuous animation on money-entry screens.
- Compact single-pane flows; medium widths use a rail where appropriate; expanded tablet layouts use list/detail panes. Width and available space determine layout rather than a device-name check.
- VoiceOver/TalkBack order follows visual order. Accessible value labels, meaningful chart summaries, visible keyboard focus, focus restoration on modal close, no color-only states.
- Local data, loading, offline, unsaved changes, failed saves, restored purchases and account deletion must each have an explicit state.

## Composition review

Three image concepts will compare a budget-led daily overview, a transaction-led ledger and an account-led overview. They vary hierarchy, not identity. These are synthetic design studies; generated status bars, small text and controls are not implementation specifications. Selection is pending in the decisions register. Full HTML device frames and native implementation follow approval of a composition.

## References

[Apple tab bars](https://developer.apple.com/design/human-interface-guidelines/tab-bars), [Apple accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility), [Android layouts and navigation](https://developer.android.com/design/ui/mobile/guides/layout-and-content/layout-and-nav-patterns). Source-specific observations and Mobbin links belong in the visual research document.
