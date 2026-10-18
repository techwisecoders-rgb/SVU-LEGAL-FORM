# Staff and admin guide

## First administrator

Set a unique `ADMIN_INITIAL_EMAIL` and unique `ADMIN_INITIAL_PASSWORD` (at least 16 characters) in the private API environment before first startup. The API bootstraps only if that email does not already exist. It will never promote an existing user from environment settings. Remove the initial password after successful setup.

Open `/admin` and sign in with the administrator credentials. Create customers through `/register`; change trusted personnel to `REVIEWER` only in **Users & roles**. Do not share accounts. Role changes and suspensions are audit logged; suspending an account revokes its current sessions.

## Service pricing and slots

Use **Services & pricing** to configure real service names, descriptions, fee in paise/rupees, duration and active state. An inactive/unconfigured service is not offered publicly. Published fee and scope must match the terms shown to the customer. Use **Availability** to create future slots; avoid overlapping slots that would confuse customers. A database uniqueness constraint and conditional slot claim prevent two bookings from claiming the same slot.

## Property assessments

Move the status only when the matching step occurs. Use **Edit reviewer notes**, **Add checklist item** and **Assign reviewer**. Checklist items should record evidence, source, findings, missing documents and next steps, not automated guesses. Assignments use reviewer UUIDs shown in Users & roles. The downloadable summary reflects recorded data and limitations; review it before treating it as an external deliverable.

## Dispute cases

Use status to reflect intake, screening, conflict check, qualified professional review and scope/fee approval. Assignment should be to an active reviewer only. Set a fee and move to **AWAITING_PAYMENT** only after service scope, deliverables, exclusions, applicable third-party expenses and the cancellation/refund terms have been approved and communicated. The portal does not decide arbitrability. Use **Add case message / note** to send a visible message or internal-only staff note; verify the confirmation before posting.

## Payments and refunds

Use **Refunds** to review customer requests. **Submit to Razorpay** sends a real gateway refund request and is disabled until Razorpay is configured. Final status should be reconciled from signed webhook events. A requested/pending refund is not an approved or processed refund. Never mark a gateway refund successful manually. If status is `NEEDS_RECONCILIATION`, the gateway response may have been lost after Razorpay accepted the request; the reserved amount cannot be retried until staff reconcile it against the Razorpay dashboard and correlate the gateway refund ID/status. Reconcile payments in Razorpay and the stored payment/webhook records.

## Content

Use **Articles** for draft, review, publish and archive. All legal material needs a qualified human review with current law and jurisdiction before publication. Store `lastReviewedAt`; do not fabricate citations, credentials, case outcomes, testimonials or guarantees.
