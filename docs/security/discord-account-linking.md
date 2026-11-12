<!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:32a478b0305f35b83bdcd546ed718dfbb825bbbef9f63c84406e93b156d3c020 -->

# Discord Account Linking

## Flow
1. The player signs in to a Chaotic Gaming account.
2. The website calls `POST /auth/discord-link/challenge` from the player's browser with their Core bearer session, retaining the response cookie (use credentials when fetching across origins). Server-to-server challenge creation does not establish browser ownership.
3. Core stores a SHA-256 hash of the random state combined with a separate random browser binding, bound to that principal and expiring in 10 minutes. The binding is sent only in an HttpOnly, SameSite=Lax cookie; production uses a Secure, host-prefixed cookie.
4. The browser redirects to the returned Discord OAuth authorization URL using the `identify` scope only.
5. Discord redirects to `GET /auth/discord-link/callback`.
6. Core requires the initiating browser cookie before consuming the matching state exactly once, exchanges the authorization code server-side, fetches `/users/@me`, and stores the verified Discord snowflake.
7. The short-lived OAuth access token is discarded and is never stored.

## Discord Developer Portal
Register the exact redirect URL:
`https://<CORE_API_HOST>/auth/discord-link/callback`

Configure these Core environment variables together:
- `DISCORD_OAUTH_CLIENT_ID`
- `DISCORD_OAUTH_CLIENT_SECRET`
- `DISCORD_OAUTH_REDIRECT_URL`
- Optional `DISCORD_LINK_COMPLETE_URL` — a fixed, HTTPS website page to show after a successful link.

Use only the `identify` OAuth scope. No bot permissions or guild membership scope are required for account ownership verification.

## Security
- The user must already have an active Core session to create a challenge.
- State is random, hashed at rest, bound to one principal, expires in 10 minutes and is consumed once.
- OAuth code exchange occurs server-side. Client secrets and access tokens never reach the browser.
- Discord IDs are stored as text and uniquely linked across active accounts.
- A Discord account already linked to another Core account cannot be claimed.
- Discord server roles do not grant platform/game administrator permissions.
- Do not log OAuth codes, access tokens, client secrets or raw state values.

## Browser requirements and retries
The callback must use the same Core host that issued the cookie. Starting another challenge replaces the browser cookie, so only the newest flow can complete in that browser. Existing challenges created before browser binding was introduced must be restarted. Missing or mismatched cookies cannot consume a challenge or write a link. The cookie is cleared after a valid challenge is consumed.

A Discord verification failure requires starting a new challenge. This preserves single-use behavior even when a token exchange may have succeeded before a network failure.


<!-- /coderabbit-ai-generated:v1 -->