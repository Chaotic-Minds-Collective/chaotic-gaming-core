# Commerce catalog administration

## Permission model

Catalog administration requires the platform-scoped commerce.manage permission. The base RBAC migration assigns that permission to the platform_admin role. Regular player sessions cannot create products, change prices or configure game delivery mappings.

After the first player account is registered, run this command from the Core application environment using its configured DATABASE_URL:

    npm run admin:grant -- <PLAYER_PRINCIPAL_UUID>

The account page displays the player's principal UUID. The command is explicit, idempotent and audited. It does not run automatically and must only be used for the intended platform owner.

## Product and price management

All endpoints below require an authenticated platform_admin principal.

- GET /admin/commerce/products
- POST /admin/commerce/products
- PATCH /admin/commerce/products/:productId
- POST /admin/commerce/products/:productId/prices

Create a product:

    {
      "sku": "atlas-supporter-pack",
      "name": "ATLAS Supporter Pack",
      "description": "Example catalog entry; replace with approved product copy.",
      "productType": "supporter",
      "status": "draft",
      "currency": "USD",
      "amountMinor": 999
    }

Amounts are integer minor units. For USD, 999 means $9.99. New products default to draft unless explicitly activated. Price changes append a new price record and close the previous active price; historical order snapshots are not rewritten.

## Game delivery mappings

Use:

    PUT /admin/commerce/products/:productId/game-mappings/:gameKey

Example body:

    {
      "serverId": "<registered-server-uuid>",
      "deliveryType": "give_item",
      "deliveryPayload": {
        "itemId": "adapter-defined-item-id",
        "quantityPolicy": "order-quantity"
      }
    }

The selected server must exist and its game key must match the route gameKey. A mapping is scoped to one game and one server. deliveryPayload is passed to the adapter as data; adapters must validate it against their own allowlisted delivery schema and must never execute arbitrary console commands from untrusted payload fields.

## Reward lifecycle and current limitation

After a verified Stripe test payment, Core creates an entitlement. If the player has a verified Steam identity and a matching product/game/server mapping, Core automatically creates an idempotent reward-queue entry. If the player links Steam later, POST /account/entitlements/:entitlementId/claim queues the existing entitlement.

The durable queue is ready, but game delivery is not complete until a corresponding server adapter implements and validates the deliveryType. The ATLAS plugin currently reports heartbeats only; do not expect ATLAS item delivery yet. No real products, prices, mappings, servers or payments have been provisioned by this change.
