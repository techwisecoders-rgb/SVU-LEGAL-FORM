# Architecture — Single-Project Deployment

## Runtime layout

- **Next.js App Router** renders all public pages and customer/reviewer/admin interfaces.
- **Next.js Pages API catch-all** (`pages/api/[...path].ts`) mounts the existing Express application for all `/api/*` requests. Express retains server-side input validation, authentication, authorization, payment verification, webhook idempotency and workflow logic.
- **PostgreSQL + Prisma 7** persist users, sessions, property assessments, bookings, dispute cases, document metadata, payments, refunds, content and audit events.
- **One same-origin deployment** means the website and API use the same host. Client-side requests call `/api/...`; `NEXT_PUBLIC_API_URL` should normally be unset.

## Request flow

1. Browser calls a Next.js page on the project domain.
2. Browser API calls to `/api/*` enter the catch-all Pages API route. Next's request body parser is disabled on this route so Express can parse JSON, multipart requests and raw payment webhooks.
3. Express middleware validates the request and enforces session, role, ownership and CSRF/origin controls.
4. Business logic uses Prisma and PostgreSQL. Payment states only change after backend verification or trusted gateway webhook processing.
5. Public pages and API endpoints deploy together in a single Vercel Next.js project.

## Environment boundaries

- Secrets such as `DATABASE_URL`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, SMTP credentials and administrator bootstrap password are server-only.
- Only public URL values may use `NEXT_PUBLIC_`. The API base URL is intentionally same-origin by default.
- Use a managed PostgreSQL service for a serverless production deploy.
- Vercel filesystem storage is ephemeral. Configure private durable object storage and malware scanning before enabling uploads of real property documents.

## Important limitation

This is a single Vercel project, not a claim that external services disappear: PostgreSQL, email delivery, Razorpay, and private durable storage need provider accounts/configuration. A production deployment should also run the independent authorization, payment, webhook and recovery test suites.
