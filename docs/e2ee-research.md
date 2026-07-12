# E2E Encryption for Token Circles — Research Summary

Companion to `docs/readiness-audit-agent-prompt.md` (Phase 5). Findings from a sourced research pass (July 2026); items marked *(judgment)* are engineering estimates rather than sourced facts.

## What the market actually does

- **Commercial budgeting apps (YNAB, Monarch, Copilot, Lunch Money): none offer E2EE at any price.** They all use "bank-grade" language meaning TLS in transit + AES-256 at rest (see ynab.com/security, monarch/copilot/lunchmoney security pages). The structural reason: their core value is server-side bank aggregation (Plaid/MX/Finicity) — plaintext must land on their servers, so E2EE is architecturally impossible for them.
- **Password managers: E2EE is table stakes and free** (Bitwarden's free tier is fully zero-knowledge; 1Password, Enpass similar). Users in privacy-conscious niches expect it there.
- **The only real prior art in this niche is Actual Budget** — open source, local-first, optional E2EE sync, free. Its design (verified from source, `packages/loot-core/src/server/encryption/`):
  - Separate *encryption password* → PBKDF2-SHA512 (10k iterations — low by current OWASP standards; use ≥600k or Argon2id) → 256-bit AES-GCM key.
  - Each CRDT sync message and each budget-file blob is encrypted client-side; the server stores only ciphertext plus `{keyId, salt, encrypted-test-blob}`. The key never leaves the client.
  - Consequences they document honestly: lose the password + local copy = data gone forever; enabling is one-way (forces a sync reset); timestamps/filenames stay plaintext; bank-sync tokens live *outside* the E2EE envelope because the server must use them.
- Other OSS finance apps: Firefly III explicitly has **no** at-rest or E2E encryption (docs say "use disk encryption"); Ivy Wallet/Cashew are local-only with unencrypted cloud-drive backups. Actual is the only prominent one with true E2EE sync.

## Compliance: E2EE is not required

- **GDPR Art. 32** lists encryption as an example measure ("inter alia as appropriate"), not a mandate. TLS + at-rest + access controls is the accepted baseline. **Art. 34(3)(a)** is the carrot: a breach of properly encrypted data waives user-notification duty — E2EE shrinks breach blast radius massively.
- **SOC 2**: expects in-transit + at-rest encryption and key hygiene; never E2EE. First-year cost if ever needed: ~$25k–50k (auditor $12–20k + Vanta/Drata-class tooling) — not worth it for a consumer app now.
- **PCI DSS**: scope attaches to card PANs. Stripe Checkout keeps you at SAQ-A; transaction descriptions/amounts are not cardholder data. Non-issue (just never persist full card numbers from bank imports).
- **Cloudflare platform**: D1 and R2 are already AES-256 encrypted at rest by default, TLS in transit (developers.cloudflare.com/d1/reference/data-security, /r2/reference/data-security). R2 supports SSE-C customer keys, but that's still server-side. Cloudflare has no user-facing KMS; Workers Secrets / Secrets Store cover server-held keys.

**Bottom line: the current stack already meets the compliance baseline. The case for E2EE is trust/differentiation, not law.**

## Recommended incremental path *(judgment, validated against precedent)*

"Tunnel first, encrypt later" is a normal, legitimate roadmap (WhatsApp, Zoom, Excalidraw all retrofitted E2EE):

- **Stage 0 — now, ~1–2 dev-weeks:** you already have TLS + at-rest via Cloudflare. Add: honest security page (current SECURITY.md describes the deprecated Express stack), security.txt (RFC 9116, free), GitHub private vulnerability reporting (free), JWT/secret-rotation hygiene. Cash cost ≈ $0.
- **Stage 1 — Actual-style E2EE of synced data, ~4–8 solo-dev-weeks:** separate encryption passphrase (required even for Google-sign-in users); Argon2id (WASM) or PBKDF2-SHA256 ≥600k (native WebCrypto); random per-user DEK wrapped by the password-derived KEK; **mandatory printable recovery key** (second wrap of the DEK) so password reset ≠ data loss; AES-256-GCM on the payload client-side. Key precondition: make the server store opaque blobs instead of parsed columns — decide this *before* building any real sync engine, it's what made Actual's E2EE cheap. Excalidraw's minimal version of this pattern was a single 4-day PR.
- **Stage 2 — full zero-knowledge incl. receipts, ~2–4 months cumulative:** client-side encryption of receipt files before R2 upload, client-side thumbnails/OCR, key rotation, threat-model doc. Server-side features that need plaintext (email reminders with amounts, server-rendered PDFs) must move client-side or degrade — Token Circles is unusually well-positioned because the local-first codebase already computes everything in the browser.

**What breaks under E2EE:** server-side reports/analytics endpoints, email reminders containing real amounts, receipt processing, any support tooling that reads user data ("we cannot recover your data" becomes literal). Web-app caveat to state honestly: the server ships the JS, so browser E2EE is weaker than native-client E2EE against a malicious/compelled operator.

## Money

- Mandatory infra cost: **≈ $0** (WebCrypto is free; Cloudflare secrets free tier suffices; AWS KMS if ever wanted: $1/key/mo + $0.03/10k ops).
- Optional assurance when revenue justifies it: small-scope web-app pen test **$5k–$30k**; crypto-specific audit **$30k–$200k** (OSTIF's published range; TrueCrypt's crowdfunded audit was ~$70k). Free alternative used by Actual/Standard Notes/ente pre-revenue: publish the crypto design doc, invite community review, reuse audited primitives, apply for an OSTIF-sponsored audit as an OSS project.

## Premium or free?

**Ship E2EE free on every tier; charge for hosting/sync convenience.** That's the pattern everywhere E2EE exists in this space (Actual: free OSS feature; Bitwarden: free tier is E2EE; Obsidian Sync: you pay for the sync service, E2EE is inherent to it; Proton: E2EE in free tier, storage paid). Paywalling E2EE itself reads badly in privacy-conscious communities — and since this repo is AGPL, the implementation would be public anyway. E2EE is a genuine differentiator here precisely because no mainstream budgeting app can offer it.
