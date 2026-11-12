# Steam OpenID account linking

Steam linking uses OpenID 2.0. The website never collects a Steam password or trusts a Steam display name as proof of ownership.

## Configuration

Set the same server-only callback URL in the website and Core:

`STEAM_OPENID_RETURN_URL=https://www.chaoticmindsgaming.com/api/account/link/steam/callback`

The configured value must be an HTTPS URL with no query string or fragment.

## Flow

1. The player signs in to Chaotic Gaming.
2. The website generates a cryptographically random 32-byte state value.
3. The website calls `POST /auth/steam-link/challenge` with the player's session token and state.
4. Core stores only the SHA-256 hash of the state, bound to the authenticated player, with a 10-minute expiry.
5. The website stores the state in an HTTP-only, Secure, SameSite=Lax cookie, bound to a hash of the initiating player session.
6. The browser is redirected to Steam OpenID.
7. Steam returns the signed assertion and state to the website callback.
8. The website verifies its state cookie and initiating session, then forwards the state and assertion to Core.
9. Core checks the expected callback URL and state, validates the Steam assertion with Steam's OpenID endpoint, checks nonce freshness, and consumes the one-time challenge transactionally.
10. Core inserts the verified Steam identity and writes an audit record.

## API

### Create a one-time challenge

`POST /auth/steam-link/challenge`

Requires a player session.

```json
{ "state": "43-character-base64url-value" }
```

### Complete Steam linking

`POST /auth/linked-accounts/steam`

Requires the same player session and the original state:

```json
{
  "state": "43-character-base64url-value",
  "assertion": {
    "openid.ns": "http://specs.openid.net/auth/2.0",
    "openid.mode": "id_res"
  }
}
```

The assertion object must contain the complete Steam OpenID response. The abbreviated example above is not sufficient to pass verification.

### List linked accounts

`GET /auth/linked-accounts`

Returns active linked accounts for the authenticated player.

### Resolve a game identity

`POST /integrations/servers/{serverId}/players/resolve`

Requires a server-scoped `players.resolve` service permission. Only verified, active links are returned.

## Security properties

- No Steam password or Steam Web API key is required for OpenID ownership verification.
- Callback origin and path are allowlisted by the configured URL.
- State is bound to the initiating player in Core and to the initiating browser session in the website.
- Challenges expire after 10 minutes and are consumed once.
- Steam response nonces are freshness-checked and stored as SHA-256 hashes to reject replay.
- Steam signatures are verified by posting the assertion back to Steam.
- One active Steam identity can belong to only one player, and a player can have only one active Steam identity.
- The schema preserves historical unlinked rows and enforces uniqueness for active links. A user-facing unlink endpoint is not implemented yet.
- Account linking does not grant game-admin permissions or moderation privileges.
