# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Finance Manager, please use GitHub's [private vulnerability reporting](https://github.com/Komediruzecki/finance-manager/security/advisories/new) to disclose it securely. Alternatively, you can open a public issue stating that you found a potential security issue and a maintainer will provide a private channel for details.

Do not include exploit details or sensitive information in public issues.

## Supported Versions

| Version | Supported |
|---------|-----------|
| 4.x (latest) | Yes |
| < 4.0 | No |

## Security Features

- Passwords hashed with bcrypt
- SQLite parameterized queries prevent SQL injection
- Helmet.js security headers on all responses
- Rate limiting on authentication endpoints
- CORS protection with configurable allowed origins
- Session-based authentication with httpOnly cookies
