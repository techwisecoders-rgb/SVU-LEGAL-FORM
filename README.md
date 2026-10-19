# SVU Developers Private Limited — Single-Project Full-Stack Website

This is the **single-application deployment edition** of the SVU real estate legal advisory platform. It intentionally uses one Next.js project at the repository root. The public website and the Express API deploy together to one domain; do not deploy `apps/web` and `apps/api` separately.

## Architecture

- **Website:** Next.js App Router, React, TypeScript, Motion and Lucide icons, with responsive service pages, the interactive property navigator, legal knowledge centre, and customer/reviewer/admin workspaces.
- **API:** Express is mounted behind `pages/api/[...path].ts`. Requests to `/api/*` are handled by the same Vercel/Next.js project and origin, including authentication, property assessments, bookings, cases, documents, articles, admin workflows and Razorpay endpoints.
- **Database:** PostgreSQL through Prisma 7 and the PostgreSQL driver adapter. The Prisma Client is generated into `src/api/generated/prisma/`.
- **Local development:** `npm run dev` starts only Next.js on port 3000. The Express API is available under that same origin, for example `http://localhost:3000/api/health`.

## Run on Windows (PowerShell)

1. Install Node.js 22 or newer and PostgreSQL (or create a PostgreSQL database with a managed provider).
2. Copy `.env.example` to `.env` and edit the values, especially `DATABASE_URL`, `ADMIN_INITIAL_EMAIL`, and `ADMIN_INITIAL_PASSWORD`.
3. In the project root, run:

   ```powershell
   npm install
   npm run db:generate
   npm run db:deploy
   npm run db:seed
   npm run dev
   ```

4. Open `http://localhost:3000`.

For a brand-new local database, `npm run db:migrate -- --name init` can create a development migration; for the included initial schema, `npm run db:deploy` applies the existing migration.

## Deploy as ONE project on Vercel

1. Push this folder to GitHub and import that repository into Vercel.
2. Keep **Root Directory** set to the repository root (`.`). This ZIP has no `apps/` directory or workspace package manifests. If you are updating your existing GitHub repository, delete the old `apps/` folder completely before committing; leaving the old `apps/api/package.json` and `apps/web/package.json` in the repository can make Vercel continue to detect both apps.
3. Select **Next.js** as the Framework Preset. Vercel should detect a single Next.js application.
4. Use the project defaults or set:
   - Install Command: `npm install`
   - Build Command: `npm run build`
   - Output Directory: leave the Next.js default; do not set a custom `public` or static output folder.
5. Add the environment variables below to this single Vercel project. Choose Production, Preview, and Development scopes as needed. Do not paste the whole `.env` file into a frontend-only app; add each `KEY` and `VALUE` in this one project's Environment Variables UI.
6. Deploy. The site and `/api/*` endpoints share one domain and one deployment.
7. Before inviting customers, run `npx prisma migrate deploy` against the production database from a trusted terminal/CI job, then verify login, email, booking and payments in Preview using test credentials.

### Required Vercel environment variables

- `DATABASE_URL` — reachable PostgreSQL connection string. Keep it server-side; do not prefix it with `NEXT_PUBLIC_`.
- `ADMIN_INITIAL_EMAIL` — the intended initial administrator email.
- `ADMIN_INITIAL_PASSWORD` — unique secret with at least 16 characters. Never use the sample value.
- `NEXT_PUBLIC_SITE_URL` — the canonical production URL, e.g. `https://your-domain.com`. For Preview, either set the preview URL or allow the code to use Vercel's deployment URL.

**Do not set `NEXT_PUBLIC_API_URL` to a separate API host.** It is optional; leave it unset so browser requests use same-origin `/api/...` URLs. If the environment UI contains an old `NEXT_PUBLIC_API_URL` pointing to port 4000 or another deployment, remove it from this project and redeploy.

Optional variables:

- Razorpay test credentials: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`; keep `PAYMENTS_ENABLED=false` until test-mode order creation, signature verification and webhook delivery have all been tested.
- Email: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM`.
- Security: `SESSION_COOKIE_SAMESITE`, `TRUST_PROXY` (normally `false` unless you have reviewed the proxy configuration), `MALWARE_SCAN_REQUIRED`, `CLAMSCAN_PATH`.
- `NEXT_PUBLIC_API_URL` should be absent or empty for this single-origin setup.

## Vercel deployment limitations to resolve before production use

Vercel runs API endpoints as serverless functions. Its local filesystem is ephemeral, and the function's writable `/tmp` storage is not a durable document store. This app's included local/private-file adapter is suitable for local development only. Before accepting confidential property documents on Vercel, implement and configure durable **private object storage** (for example a private Supabase Storage bucket or another encrypted object-storage provider) with authorization, malware scanning, retention and audit controls. Do not work around this by storing documents under `public/`.

Vercel serverless request limits also mean large multipart document uploads need a direct-to-private-object-storage upload flow; the API caps an incoming upload at 4 MB when `VERCEL` is set. Do not represent document upload as production-ready until durable storage and malware scanning have been configured and tested.

Other external integrations remain their own services/credentials (PostgreSQL, email delivery and Razorpay), but they do **not** require separate Vercel frontend/API projects.

## Useful commands

```powershell
npm run dev
npm run build
npm run start
npm run test
npm run typecheck
npm run db:generate
npm run db:migrate -- --name init
npm run db:deploy
npm run db:seed
```

`npm run build` generates Prisma Client first and then builds the Next.js application. A successful build is not proof that live database, SMTP, object storage, or Razorpay integrations are configured.

## Security notes

- No production credentials are included. Never commit `.env`.
- Passwords are hashed; browser sessions use HTTP-only cookies and server-side session records.
- API validation and role/ownership checks are enforced on the server.
- Payment amounts are calculated server-side; gateway signatures and webhooks are verified.
- Property checklists record evidence; they do not guarantee title, safety, arbitrability or legal outcomes.
- All actual legal findings need qualified review and source/date evidence.
- The seed script intentionally does not generate fake users, property findings, customer data, payments or official credentials.

See `docs/` for architecture, security, payments, deployment, admin operation, legal-content review and the client-demo guide.
