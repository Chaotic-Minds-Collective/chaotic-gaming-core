# Product Catalogue Administration

Products and prices are separate records. The CLI creates or updates a product and maintains a price history for the selected currency. It does not create a payment, order, entitlement or reward.

## Upsert a draft product

```bash
npm run product:upsert -- '{
  "sku": "7DTD-MEDKIT-01",
  "name": "Medical Kit",
  "description": "One in-game medical kit",
  "productType": "digital_item",
  "status": "draft",
  "currency": "USD",
  "amountMinor": "299",
  "gameKey": "7dtd",
  "deliveryType": "game_item",
  "deliveryPayload": {
    "itemId": "REPLACE_WITH_VALIDATED_ITEM_ID",
    "quantity": 1
  }
}'
```

The example is a draft template, not a real item listing. Replace the item ID only after validating it against the target game build.

## Rules

- Keep products in `draft` until pricing, legal terms, game compatibility and delivery are verified.
- Amounts are integer minor units (299 = USD $2.99).
- Price changes create a new price row and close the previous active price interval.
- Game delivery metadata is stored per product/game mapping.
- Never mark an order paid from the website. Only a verified payment-provider event may do that.
- A product catalogue entry does not guarantee that the item can be delivered in game.
