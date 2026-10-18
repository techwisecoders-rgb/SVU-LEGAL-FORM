# Deployment guide

## Suggested production layout

- Next.js app on a supported Node.js deployment platform.
- Express API on a compatible Node.js server/runtime.
- Managed PostgreSQL/Supabase PostgreSQL with TLS and restricted credentials.
- Persistent private encrypted storage or a reviewed private object-store adapter for documents.
- SMTP/transactional email provider.
- Razorpay merchant account and HTTPS webhook URL.
- Centralized logs, monitoring, database backups and tested restore procedure.

A frontend-only static host cannot run the separate Express API. Deploy web and API independently unless they are intentionally combined behind a Node.js service. Configure exact origins in `NEXT_PUBLIC_SITE_URL` and `NEXT_PUBLIC_API_URL`.

## Release steps

1. Generate dependencies in a registry-connected environment with `npm install`, commit the resulting `package-lock.json`, and build with the project Node.js version policy. The current source archive omits a lockfile because registry access was unavailable during generation; do not deploy until dependencies are locked and the build passes.
2. Provision Postgres and apply `npx prisma migrate deploy`; keep production migrations under source control and review them before release.
3. Set all server-only environment values in deployment secret management. Set `NODE_ENV=production`, site/API HTTPS origins, database URL and admin bootstrap credentials for first startup only.
4. Configure SMTP, verify mail delivery and remove development token logging.
5. Provision private document storage and ClamAV/vetted scanner; validate uploaded files are denied on scanner unavailability.
6. Run end-to-end checkout with Razorpay test keys and a real signed test webhook before enabling live mode.
7. Configure HTTPS, appropriate cookie settings, origin checks, reverse proxy, trusted IP forwarding and shared WAF/rate limiting. Do not set `TRUST_PROXY=true` behind an untrusted proxy.
8. Configure database backup, restore testing, monitoring, alerting, error reporting, log retention and incident response.
9. Review legal terms, privacy and document retention, case-management policies, tax treatment, invoice details and professional roles.
10. Run the final test checklist in `tests/README.md`; keep a release record with test evidence and rollback steps.

## Environment keys

See `.env.example` for the complete list. `DATABASE_URL`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `SMTP_PASSWORD` and `ADMIN_INITIAL_PASSWORD` are private server secrets. `NEXT_PUBLIC_*` values are expected to be public configuration and must not contain secrets.

## Deployment caveats

- Local filesystem uploads need persistent storage and cannot by themselves support multiple stateless API instances. Use shared private storage or route requests to one persistent file-serving node until an object-storage adapter is implemented.
- The per-process rate limiter does not synchronize across multiple instances.
- The site does not include a video consultation integration. Add a provider only after evaluating privacy, access controls and contracts.
- This application has not been independently security-certified or checked for legal/tax compliance. Complete those reviews before receiving real customers.
