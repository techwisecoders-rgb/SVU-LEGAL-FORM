# Architecture

## Runtime

- Web: Next.js App Router, React, TypeScript and Tailwind; default local origin `http://localhost:3000`.
- API: Express on `API_PORT` (default `4000`), using Prisma/PostgreSQL. Default local API origin `http://localhost:4000`.
- File data: private filesystem folder configured with `PRIVATE_UPLOAD_DIR`, never a static web directory.
- Payments: Razorpay REST API from the server, Checkout JS loaded by the client, server signature/remote status verification, webhook-driven reconciliation.
- Email: optional configured SMTP for verification/reset and user notifications.

## Trust boundaries

1. Browser values are untrusted. Server validates all structured input with Zod and computes price/ownership/allowed status changes from PostgreSQL records.
2. Customer sessions use a random opaque cookie token; only the SHA-256 token hash is persisted. Cookie flags are HTTP-only, same-site configurable and secure in production or `SameSite=None` mode.
3. Staff endpoints check the session role on the server. Reviewers may only access assessments/cases assigned to their account; admin management is restricted to administrators.
4. Document reads re-check the logged-in principal against its parent request and reviewer assignment. Documents are not served statically. Production scanning is required.
5. Razorpay webhook requests must include a valid HMAC signature of the raw request body. Webhook IDs are unique; payment transitions are idempotent. Checkout callbacks alone are not sufficient for marking a payment captured.
6. Audit entries record relevant user/staff, payment, file and workflow actions. Audit data should be monitored and retained under a reviewed policy.

## Critical workflows

### Property assessment

Public form -> optional logged-in customer -> persisted request -> staff assignment -> checklist items that cite the record/source and evidence reviewed -> additional information/review status -> downloadable summary. The summary is only a rendering of recorded database entries, not an automatic title check.

### Consultation

Administrator defines a service and fee -> administrator publishes available slots -> customer selects service/slot -> transaction claims slot with a conditional update and unique `BookingRequest.slotId` -> order is created server-side -> Razorpay signature and remote captured status checked -> payment/invoice stored -> booking becomes confirmed only after capture. Cancellation of paid bookings is a request for policy review, not an automatic refund.

### Dispute intake

Customer submits a matter outline and relevant information -> initial screening/conflict check/professional review -> qualified person decides whether and what service can be accepted -> agreement and fee scope recorded -> status transitions to `AWAITING_PAYMENT` after the fee is explicitly agreed -> payment verification -> messages, documents and milestones stay behind authenticated authorization. The site must not suggest every real property/land dispute is arbitrable.

### Refund

Customer requests a refund -> administrator reviews the request and policy -> API submits an eligible request to Razorpay -> webhook updates refund state. It is not safe to manually mark a gateway refund successful without confirmation from Razorpay.

## Data model

See `prisma/schema.prisma`. The initial migration is in `prisma/migrations/20261017000000_init/migration.sql`. UUID primary keys are not meant to be authorization checks; every route still checks ownership and roles.

## Scaling notes

The API rate limiter is in-memory, appropriate only as a basic single-process safeguard. Multiple instances require shared gateway/WAF/rate-limit controls. The private filesystem requires durable private storage; multiple API instances need shared encrypted object storage or sticky routing backed by durable disk. Database connections, task queues, mail delivery, scanning and metrics need capacity planning for real workloads.
