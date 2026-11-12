# Discord Account Linking

## Flow
1. The player signs in to a Chaotic Gaming account.
2. The website calls `POST /auth/discord-link/challenge` with the player's Core bearer session.
3. Core stores a SHA-256 hash of a random one-time state bound to that principal, expiring in 10 minutes.
4. The browser redirects to the returned Discord OAuth authorization URL using the `identify` scope only.
5. Discord redirects to `GET /auth/discord-link/callback`.
6. Core consumes the state exactly once, exchanges the authorization code server-side, fetches `/users/@me`, and stores the verified Discord snowflake.
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
