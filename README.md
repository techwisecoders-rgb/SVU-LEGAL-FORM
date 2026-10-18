# SVU Developers Private Limited — Real Estate Legal Advisory Platform

A full-stack Node.js/Next.js platform for Indian real-estate legal-assistance intake, property due-diligence workflow, paid consultations, secure customer document exchange, dispute intake and case messages, Razorpay payments, refunds, a knowledge centre and role-protected operations tooling.

> **Deployment disclaimer:** This is a substantial deployable application codebase, not a legal-compliance certification or a substitute for production security review. It cannot verify title automatically and must not be presented as a licensed law practice, arbitral institution, guaranteed legal clearance or guaranteed dispute outcome. Live payments, email, malware scanning and production hosting require the operator's own approved accounts, credentials, policies and professional review.

## Architecture

- `apps/web`: Next.js App Router, React, TypeScript, Tailwind CSS, Motion and Lucide icons.
- `apps/api`: Node.js + Express JSON API, Zod input validation, server-side role checks, scrypt password hashes, opaque HTTP-only session cookies, email verification/reset tokens, private document routes, Razorpay order/signature/webhook integration, status workflows and audit events.
- `prisma/schema.prisma`: PostgreSQL schema and initial migration for users/sessions, assessments/checklists, service pricing/slots/bookings, disputes/messages/milestones/status history, documents, payments/webhooks/invoices/refunds, articles/bookmarks and audit records.
- `prisma/migrations`: initial PostgreSQL migration.
- `docs`: setup, security, payment, deployment, content review and operations guidance.

No Docker or Redis is required.

## Requirements

- Node.js 22.16.0 (or a compatible newer Node 22 release) and npm 10+
- PostgreSQL 14+ or Supabase PostgreSQL
- Optional: SMTP/transactional email provider
- Optional: Razorpay test/live credentials and webhook secret
- For production uploads: ClamAV (`clamscan`) or an equivalent reviewed malware-scanning implementation

## Run on Windows (PowerShell)

1. Extract the ZIP and open `svu-developers-legal-platform` in VS Code.
2. Create the local environment file:

   ```powershell
   Copy-Item .env.example .env
   ```

3. Edit `.env` before running. Set `DATABASE_URL` to your local/PostgreSQL connection. Change `ADMIN_INITIAL_EMAIL` and replace the placeholder `ADMIN_INITIAL_PASSWORD` with a unique random password of at least 16 characters. Do not put secrets in `NEXT_PUBLIC_*` variables.
4. Install packages (internet is required the first time):

   ```powershell
   npm install
   ```

5. Generate Prisma Client and apply the included initial migration:

   ```powershell
   npm run db:generate
   npx prisma migrate deploy
   ```

   For a new local database where you intend to develop schema changes, you can use `npm run db:migrate -- --name init` instead of `migrate deploy`; do not run both initialization paths against the same database.

6. Seed script is intentionally non-destructive and adds no fake customers, legal credentials or transaction records:

   ```powershell
   npm run db:seed
   ```

7. Start the web frontend and API together. The root `predev` lifecycle automatically runs `npm run db:generate` first, so the Prisma client import under `apps/api/src/generated/prisma/` exists before the API starts:

   ```powershell
   npm run dev
   ```

   If you start the API directly with `npm --workspace apps/api run dev`, first run `npm run db:generate` from the repository root.

8. Open `http://localhost:3000`. The API health endpoint is `http://localhost:4000/health`. The API will create the initial admin once from `ADMIN_INITIAL_EMAIL`/`ADMIN_INITIAL_PASSWORD` if no account already exists at that email. The API will not silently promote an existing user.

After the first administrator account is successfully created, remove `ADMIN_INITIAL_PASSWORD` from the deployment environment and restart the API. Create reviewer accounts through the protected Users & Roles screen by changing a normal account's role to `REVIEWER`.

### Available root commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Run Next.js and API concurrently |
| `npm run dev:web` | Frontend only |
| `npm run dev:api` | API only |
| `npm run build` | Build frontend then TypeScript API |
| `npm run typecheck` | Run frontend TypeScript check and API compile |
| `npm test` | Run security utility tests |
| `npm run db:generate` | Generate Prisma Client |
| `npx prisma migrate deploy` | Apply committed migrations in deployment |
| `npm run db:migrate -- --name change_name` | Create/apply a development migration |
| `npm run db:seed` | Run the safe seed script |

## Advanced client-facing experience

The home page is designed as an interactive product experience, not only a static marketing page. It includes:

- A property-preparation navigator: select property type, transaction stage and state to generate a local preparation checklist. The output is explicitly informational and does not claim that checks have been performed.
- A searchable, category-filtered service directory.
- An illustrative customer-workspace preview with interactive Checklist, Documents and Timeline tabs. Its example status and document rows are labeled as demo content, not live customer records.
- A locally interactive checklist with progress, plus a step-by-step workflow explorer.
- Detailed service/knowledge pages with a designed hero, review considerations, next-step CTA, related resources and legal limitations.
- Responsive design for desktop, tablet and mobile, a restrained navy/ivory/gold system, and SVG/ICO brand icons.

The demo checklist and workspace preview are front-end demonstrations. They do not write data to the database; actual submitted assessments, bookings, uploads, payments and cases use the authenticated API workflows described below.

## Public pages and workflows

- Branded homepage, responsive header/navigation, legal services index, long-form service pages, articles and FAQs, contact, pricing, property check, consultation booking, dispute submission, case tracking, and policy/disclaimer pages.
- The custom line-trail effect supports pointer/touch input and respects reduced-motion preferences.
- Article content is admin-managed and must be reviewed before publication. Starter educational snippets are generic; they are not jurisdiction-specific legal advice.
- Property checks record evidence, sources, findings, missing information and next steps. The generated text summary explicitly states that it is not a verified title certificate or final legal opinion.

## Customer security features

- Account registration/login, hashed passwords, opaque database-backed sessions stored in an HTTP-only cookie, logout/revocation, email verification, password reset and account password change.
- Customer dashboard for own assessments, bookings, disputes, case messages, uploaded files, invoices, payments, bookmarks and refund requests.
- Authorization checks use database relationships instead of trusting customer-supplied IDs.
- Document uploads accept PDF/JPEG/PNG after type signature checking, store files outside the public web directory with restrictive permissions, record SHA-256, restrict downloads by owner/assigned reviewer/admin, and write access audit events. Production uploads are rejected unless malware scanning is available and passes.
- Case messages distinguish customer-visible messages from staff-only internal notes; assigned reviewers can manage milestones, findings, and communications in `/reviewer`.

## Razorpay setup (test mode first)

1. Create/verify the merchant account in Razorpay and use its **test** credentials first.
2. Set `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` and `PAYMENTS_ENABLED=true` in the **API server's** private environment. The key secret and webhook secret must never be added to the browser bundle.
3. Register the webhook URL `https://YOUR-API-DOMAIN/api/payments/webhook` in Razorpay. Choose at least payment captured, order paid, payment failed and refund lifecycle events supported by the implementation. Copy the webhook secret into the server environment.
4. Test successful checkout, failure, duplicate webhook delivery, signature rejection, delayed capture, cancellation and refund reconciliation with Razorpay test cards/UPI methods.
5. Use only after the account is approved, policies/tax/invoice content are reviewed, HTTPS is enabled and a qualified security review is complete should live keys be configured.

Payment amounts are read from server-side booking/case records in integer paise; the API creates orders with Razorpay and independently validates checkout HMAC, order/payment IDs, amounts, currency and captured state. Signed webhook events are retained for idempotency/audit. If gateway credentials are absent, payment requests return a clear disabled/configuration response—no fake payment success is emitted.

See [`docs/payment-setup.md`](docs/payment-setup.md).

## Email and file storage

- Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` and `MAIL_FROM` to enable email delivery. Without SMTP, development verification/reset links are logged in the API terminal; do not use this fallback in production.
- `PRIVATE_UPLOAD_DIR` defaults to an app-private directory outside `apps/web/public`. For production, use a persistent private disk with encrypted backups, restrictive access, access logging and a documented retention/deletion process. Do not horizontally scale with local-only storage unless requests are pinned to the same durable storage; a private object-storage adapter is a future deployment integration.
- With `NODE_ENV=production`, ClamAV scanning is required by default. Install ClamAV and configure `CLAMSCAN_PATH` (or provide a vetted scanner before changing `MALWARE_SCAN_REQUIRED`).

## Important notes before going live

- Configure `NEXT_PUBLIC_SITE_URL` and `NEXT_PUBLIC_API_URL` to the exact HTTPS origins. API CORS and cookie-origin checks reject unconfigured browser origins. For production cross-origin deployment, configure secure cookies and CORS intentionally; a same-site frontend/API deployment is simpler.
- Use HTTPS only in production; `Secure` cookies depend on production mode. Configure `TRUST_PROXY=true` only behind a trusted, correctly configured proxy.
- Set a proper production database, connection limits, backup and recovery plan, monitoring and log retention. The included in-memory rate limiter is per API process; add a gateway/WAF/shared rate-limiter for multi-instance deployments.
- Configure public website contact/social details through the code/site settings as applicable; do not publish fake company credentials, office addresses, advocate details, awards, testimonials or outcomes.
- Have a qualified Indian legal professional review all legal copy, state-specific steps, arbitration wording, Terms, privacy/data retention, cancellation/refund rules and the scope of each paid service. Configure tax treatment and invoice format with an accountant.
- The site is not a substitute for qualified review, nor an automated title-verification engine. A dispute intake does not mean a matter is arbitrable or that the company can appoint an arbitrator/act as a tribunal.

## Test and build status

The repository contains focused unit tests for password hashing, token hashing, constant-time comparisons and HMAC calculation. Run `npm test`, `npm run typecheck` and `npm run build` in an environment with dependencies installed and a configured Prisma client. Registry access failed while preparing this archive, so no `node_modules` or package lock is included and the Next.js/Prisma dependency-backed production build could not be executed here. The final source tree is syntax-parsed and the self-contained security utility tests are executed, but a successful dependency-backed build should not be assumed until those commands pass in your environment.

See `docs/implementation-status.md` for the tested boundaries and remaining production readiness work.
#   S V U - L E G A L - F O R M  
 