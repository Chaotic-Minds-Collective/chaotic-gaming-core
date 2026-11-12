# Commerce API

## Product catalog

`GET /catalog/products?currency=USD`

Returns active products that have a currently valid price for the requested ISO 4217 currency.

## Create an order

`POST /commerce/orders`

Requires a player bearer session and an `Idempotency-Key` header (8–128 characters).

```json
{
  "currency": "USD",
  "items": [
    { "productId": "00000000-0000-4000-8000-000000000000", "quantity": 1 }
  ]
}
```

Order creation snapshots the selected product name, SKU and price, records an outbox event, and does not charge money. Reusing an idempotency key with a different request body returns a conflict.

## Player entitlements

`GET /account/entitlements`

Requires a player bearer session. Entitlements are separate from payment transactions and game delivery attempts.

## Not implemented yet

No payment provider is connected. There is no checkout session, live charge, webhook verifier, refund automation, wallet spending API, or game reward worker. Do not accept payment details or claim a purchase is paid until a payment provider's signed server-to-server confirmation has been verified and reconciled.
