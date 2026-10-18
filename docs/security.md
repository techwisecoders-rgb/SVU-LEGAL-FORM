# Security and privacy controls

## Implemented controls

- `scrypt` salted password hashes; no plain-text password persistence.
- Opaque session cookie marked HTTP-only; only a hash of the session secret is saved. Session expiry and revocation on logout, reset and password change are implemented.
- Single-use hashed verification/reset tokens with expiration; password reset responses avoid account-existence disclosure.
- Zod schemas at the API boundary, Helmet, credentialed origin-restricted CORS, write-origin checking, server-side role and owner checks, generic error responses and basic per-IP/auth throttles.
- Payment calculations are from persisted service/booking/case amounts. Checkout signature, Razorpay API result, amounts, currency, order association and captured state are checked; webhook HMAC uses the raw JSON body and stored event IDs for idempotency.
- Private document storage uses random filenames, file size/MIME/signature validation, restricted file permissions, authorization before read/delete, no static links, hash/access logging, and mandatory scan behavior in production.
- Case messages separate user-visible content from staff-only internal notes. User roles and reviewer assignments are checked on server routes.
- Audit entries for significant account, payment, refund, upload/download/delete and workflow operations.

## Required production actions

1. Use HTTPS only. Configure site/API origins exactly and verify cookie `SameSite`, `Secure`, and domain behavior in the deployed browser. Prefer same-site web/API origins.
2. Set strong, unique environment secrets. Remove `ADMIN_INITIAL_PASSWORD` once the first admin is bootstrapped. Never commit `.env`, credentials, uploaded documents, production database dumps or real customer records.
3. Configure a trusted reverse proxy and `TRUST_PROXY` only as needed; add shared rate limiting/WAF because the included throttle is process-local.
4. Install ClamAV or a vetted malware scanner and test quarantine/rejection behavior. Keep the private storage path outside static web roots. Use durable encrypted backup and retention/deletion controls.
5. Configure SMTP and verify DKIM/SPF/DMARC/domain delivery. Disable development token-link logging in production.
6. Configure Razorpay in test mode; verify payment signature rejections, delayed capture, failure, duplicate/out-of-order webhook, refund and reconciliation scenarios. Use HTTPS webhook URLs and exact secrets.
7. Apply least privilege to staff and the database. Create reviewers only where professionally appropriate; review staff offboarding/session revocation, logs, backups and access periodically.
8. Conduct independent security tests: CSRF/origin, brute force, rate limits, cross-user record/file access, upload polyglots, malware, XSS, IDOR, race/concurrency, webhooks, refunds and recovery.
9. Define data retention, user access/correction/deletion requests, incident response, breach notification and backup recovery with qualified counsel.

## Important limitations

- The current upload backend uses local private disk, not a managed object-storage product. Production must ensure persistence and encryption, or replace it with a vetted private object store.
- The included rate-limit map is per process; it is not a complete distributed anti-abuse system.
- A code archive, syntax parse, or utility test does not establish production security. Dependency-backed builds, database/schema validation, integration/E2E tests, gateway setup and an independent review remain required.
