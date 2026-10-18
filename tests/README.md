# Test plan

## Automated unit tests

The API's `src/security.test.ts` checks salted scrypt password hashes, token hashing, timing-safe equality and HMAC behavior. Run after workspace installation:

```powershell
npm test
```

## Required local verification

```powershell
npm run db:generate
npx prisma validate
npx prisma migrate deploy
npm run typecheck
npm run build
npm test
```

## API integration tests to execute before production

- Anonymous request handling and input validation.
- Registration, verification expiry/replay, login, suspension, logout, password reset expiry/replay and session revocation.
- Customer A cannot read/update Customer B's assessment, booking, dispute, document, invoice or payment.
- Reviewer can access only assigned cases and assessments; a reviewer cannot change roles/prices/users.
- Admin endpoint denies missing and non-admin sessions. Initial admin does not promote an existing customer silently.
- Malformed, mislabeled and oversized uploads rejected; scanner unavailable fails closed in production; unauthorized download/deletion returns no sensitive metadata.
- Assessment status/report includes recorded checks only and disclaimer.
- Concurrent slot reservation, slot deactivation, past slots and wrong-service slot cases.
- Razorpay bad HMAC, wrong amount/currency/order, gateway API failure, captured payment, delayed capture, failed payment, duplicate/out-of-order webhook and webhook replay.
- Case payment unavailable before a positive fee is approved and case moves to `AWAITING_PAYMENT`.
- Duplicate order submissions, concurrent refund requests, partial/full refund bounds and signed refund event reconciliation.
- Role changes, account suspension/session revocation, audit writes and notification failures.

## Browser QA

Test 320px, 375px, 390px, 768px, 1024px and 1440px widths. Check keyboard-only navigation, reduced motion, file upload errors, session expiry, email verification state, checkout failure/cancellation, long case messages, private document downloads and responsive admin tables. Do not mark unrun checks as passed.
