# Razorpay payment setup

## Environment

Set these on the **API server only**:

```dotenv
RAZORPAY_KEY_ID="rzp_test_REPLACE_ME"
RAZORPAY_KEY_SECRET="replace-with-test-key-secret"
RAZORPAY_WEBHOOK_SECRET="replace-with-independent-webhook-secret"
PAYMENTS_ENABLED="true"
```

Do not prefix secrets with `NEXT_PUBLIC_` or place them in any frontend source. `PAYMENTS_ENABLED` defaults to false in `.env.example`, so orders are refused until explicitly enabled.

## Checkout path

1. The server reads service/booking/case amounts from PostgreSQL; client-supplied amounts are ignored.
2. It creates a Razorpay order through its authenticated server API and records the gateway order ID.
3. Checkout JS presents the order to the customer.
4. The API checks the HMAC signature for `order_id|payment_id` using the key secret.
5. The API fetches the payment from Razorpay and checks order ID, amount, currency and captured status.
6. Signed webhook messages are independently verified against the raw body. Captured payment state, invoice and service status transitions are persisted once.
7. If a payment is only authorized/pending capture, the API records `PENDING_CAPTURE` and does not confirm the paid service.

## Webhook

Register `https://YOUR-API-HOST/api/payments/webhook`. Configure the applicable `payment.captured`, `order.paid`, `payment.failed` and refund lifecycle events supported by your Razorpay account. Save the signing secret from the webhook configuration as `RAZORPAY_WEBHOOK_SECRET`, separate from the API key secret.

The API stores event IDs and avoids replaying already processed events. It returns a retryable server error if a refund event arrives before a matching saved refund is available, so Razorpay can retry delivery. If a refund API request times out or a 5xx error makes its outcome ambiguous, the record becomes `NEEDS_RECONCILIATION`; the amount remains reserved and the UI must not resubmit it blindly. An administrator must compare the payment/refund in the Razorpay dashboard and reconcile the stored gateway refund ID/status before any retry. Do not simply change that status to `FAILED` or create a replacement refund because the network response was lost.

## Test checklist

- Valid test payment creates one captured payment and one invoice.
- Wrong signature is rejected and logged.
- Wrong payment/order/amount/currency association is rejected.
- Failed payment remains unpaid and can be retried with a new server order.
- Replayed captured webhook does not create a second invoice or double-confirm.
- Two simultaneous booking requests cannot claim the same availability slot.
- A customer cannot pay another user's booking or case.
- Case payment is allowed only when the scope/fee review has moved it to `AWAITING_PAYMENT`.
- Refund request stays pending until reviewed; gateway result is reconciled from a signed webhook.
- Refund totals cannot exceed captured paise amount, including amounts in `NEEDS_RECONCILIATION`.
- A simulated network timeout during refund creation is treated as unknown, not proof of failure; no second refund can be submitted until reconciled.

## Live mode gate

Before live keys: merchant account approval, test-mode results, HTTPS, webhook validation, cancellation/refund terms, tax/invoice review, logging, backup/recovery and security sign-off. Invoice output currently contains a basic receipt record, not a complete tax invoice system. Have an accountant configure applicable GST/tax, legal name/address, invoice numbering and statutory fields.
