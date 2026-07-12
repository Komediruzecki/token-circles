# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Finance Manager, please use GitHub's [private vulnerability reporting](https://github.com/Komediruzecki/finance-manager/security/advisories/new) to disclose it securely. Alternatively, you can open a public issue stating that you found a potential security issue and a maintainer will provide a private channel for details.

Do not include exploit details or sensitive information in public issues.

## Supported Versions

| Version      | Supported |
| ------------ | --------- |
| 5.x (latest) | Yes       |
| < 5.0        | No        |

## Security Features

These describe the maintained Cloudflare Worker backend (`worker/`). The legacy Express
server (`backend/`) is deprecated and not deployed.

- **Passwords** hashed with PBKDF2-HMAC-SHA256 (WebCrypto), per-user random salt, constant-time
  verification. Login is protected against user enumeration (a dummy hash is always verified) and
  rate-limited per IP and per email.
- **Authentication** is a stateless HS256 JWT in an `HttpOnly`, `SameSite=Lax`, `Secure` cookie.
  "Sign out everywhere" is supported by bumping a per-user token version, which invalidates all
  outstanding tokens.
- **Parameterized SQL** everywhere (D1); table/column identifiers in the query helpers are
  validated against an allowlist regex to prevent injection.
- **Per-request authorization**: every data query is scoped to the caller's profile/user; foreign
  keys supplied by the client (accounts, categories, transactions, receipts, …) are ownership-checked.
- **Security headers** on API responses (Content-Security-Policy, `Strict-Transport-Security`,
  `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`) and on the
  static app responses.
- **Rate limiting** on authentication endpoints and on expensive/destructive endpoints
  (imports, PDF/report generation, data export, and profile-data reset).
- **CORS** locked to a single configured origin with credentials (fails closed if unset).
- **Bot protection** via Cloudflare Turnstile on the auth forms.
- **Billing** webhooks (Stripe) are verified by signature with a timestamp replay window, and the
  user's plan is only ever set from a verified webhook — never trusted from the client.

### Data storage & encryption

Data is encrypted at rest by the platform (Cloudflare D1 and R2 use AES-256) and in transit via
TLS. In the default **local-first** mode, data never leaves the browser (IndexedDB). End-to-end
(zero-knowledge) encryption of synced data is on the roadmap, not yet implemented; see the docs.
