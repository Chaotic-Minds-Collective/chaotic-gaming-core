# Stripe test-mode checkout

## Safety model

This implementation is test-mode only. It requires PAYMENTS_ENABLED=true and a Stripe secret beginning with sk_test_. Live-mode keys are rejected. Checkout remains unavailable unless the webhook signing secret and both return URLs are configured. No production keys or Stripe account objects belong in source control.

The Stripe secret and webhook signing secret belong only in the Core API environment. Never expose them to the website, browser, Discord bot or game-server adapters.

## Required Core environment

- PAYMENTS_ENABLED=true
- STRIPE_SECRET_KEY=sk_test_...
- STRIPE_WEBHOOK_SECRET=whsec_...
- STRIPE_SUCCESS_URL=https://www.chaoticmindsgaming.com/checkout/success?session_id={CHECKOUT_SESSION_ID}
- STRIPE_CANCEL_URL=https://www.chaoticmindsgaming.com/store?checkout=cancelled

Return URLs must use HTTPS, except localhost during local development.

## Stripe test webhook

Configure a test-mode webhook endpoint at:

https://YOUR-CORE-API-HOST/webhooks/stripe

Subscribe to:
- checkout.session.completed
- checkout.session.async_payment_succeeded
- checkout.session.expired
- checkout.session.async_payment_failed

Use the endpoint-specific test webhook signing secret as STRIPE_WEBHOOK_SECRET. The webhook verifier checks the timestamp tolerance and HMAC signature against the exact raw request body.

## Purchase lifecycle

1. The website checks GET /commerce/checkout/status before enabling purchase controls.
2. An authenticated player creates a pending order with POST /commerce/orders.
3. The order owner requests POST /commerce/orders/:orderId/checkout.
4. Core creates a Stripe test Checkout session and stores its session ID, URL and expiry.
5. Stripe sends a signed webhook event.
6. Core validates the event signature, order amount and currency, then marks the order paid and creates entitlements idempotently.
7. A commerce.order.paid event is written to the outbox for downstream game reward delivery.

No entitlement is granted from the browser redirect. Only a verified webhook can mark an order paid. Refund processing, production payment keys and automatic in-game reward delivery are intentionally not enabled in this first test-mode milestone.
