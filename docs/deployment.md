# Deployment Guide — Single Next.js Project

## Intended Vercel structure

Deploy the **repository root as one Next.js project**. The Next.js App Router serves the website; `pages/api/[...path].ts` mounts the Express API behind `/api/*`. The project has one root `package.json`, one Vercel project, one environment-variable configuration page, and one deployment URL.

Do not create separate Vercel projects for `apps/web` and `apps/api`; those workspace folders are intentionally absent from this single-project edition.

## Vercel settings

- Framework Preset: `Next.js`
- Root Directory: `.` (repository root)
- Install Command: `npm install`
- Build Command: `npm run build`
- Output Directory: use the Next.js default
- Development Command: `npm run dev`

The build command runs `prisma generate` followed by `next build`. Set the database environment variable in the Vercel project's build/runtime environment before deployment because Prisma's configuration validates it during generation/build.

## Required variables

| Key | Required | Notes |
|---|---:|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string accessible from Vercel; never expose to client code. |
| `ADMIN_INITIAL_EMAIL` | Recommended | One-time server-side admin bootstrap. |
| `ADMIN_INITIAL_PASSWORD` | Recommended | Unique secret, minimum 16 characters. |
| `NEXT_PUBLIC_SITE_URL` | Yes for custom domain | Canonical HTTPS site URL. Preview can use Vercel's automatic deployment URL. |
| `NEXT_PUBLIC_API_URL` | No | Leave unset. API is served at the same origin under `/api`. |
| `RAZORPAY_KEY_ID` | Optional | Use test credentials initially. |
| `RAZORPAY_KEY_SECRET` | Optional | Server-only secret. |
| `RAZORPAY_WEBHOOK_SECRET` | Optional | Configure the webhook URL as `https://your-domain.com/api/payments/webhook`. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM` | Optional | Configure email delivery; do not claim email was sent if unconfigured. |

Add variables in this **single Vercel project's** Settings → Environment Variables. Do not put secrets in `NEXT_PUBLIC_*`. Redeploy after environment-variable changes.

## Database migrations

Run `npx prisma migrate deploy` from a trusted terminal or deployment job configured with the production database. Do not depend on build-time deployment side effects to mutate the production database. Review and back up the database before applying schema changes.

## Critical limitations before production

- The current private-document adapter writes to the local filesystem. Vercel function filesystems are ephemeral, so this is not durable across invocations. Configure a private durable object-storage adapter and secure upload/download/delete flows before accepting confidential property documents.
- The current API caps uploads at 4 MB on Vercel due to serverless request limits. A production implementation should upload directly to private object storage using short-lived, scoped authorizations and complete malware scanning before making files available.
- Configure a managed PostgreSQL database, email delivery, payment gateway webhooks, logging and backups. These are supporting services, but the frontend and API remain one Vercel project.
- Use Razorpay test mode until order creation, signature verification, webhook idempotency, failure paths, refunds and reconciliation have been tested.
- Perform an independent security and legal review before production use.
