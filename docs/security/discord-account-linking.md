<!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:4e7107669502d1fe7c39eb68f9630e523a760ed4e8c313ad6e34be7d0022a70d -->

<!-- coderabbit-ai-generated-section:v1:32a478b0305f35b83bdcd546ed718dfbb825bbbef9f63c84406e93b156d3c020 -->

# Discord Account Linking

## Flow
1. The player signs in to a Chaotic Gaming account.
<!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:c8ba84b956418353425c99977265ae320f5e23f5db575c7f677baf947e0dc338 -->

2. Create a challenge using one of the supported browser integration paths below. Core requires an active Core bearer session on `POST /auth/discord-link/challenge`; the browser must receive the binding cookie and later send it to the callback on the same public host.

<!-- /coderabbit-ai-generated:v1 -->
3. Core stores a SHA-256 hash of the random state combined with a separate random browser binding, bound to that principal and expiring in 10 minutes. The binding is sent only in an HttpOnly, SameSite=Lax cookie; production uses a Secure, host-prefixed cookie.
4. The browser redirects to the returned Discord OAuth authorization URL using the `identify` scope only.
5. Discord redirects to `GET /auth/discord-link/callback`.
6. Core requires the initiating browser cookie before consuming the matching state exactly once, exchanges the authorization code server-side, fetches `/users/@me`, and stores the verified Discord snowflake.
7. The short-lived OAuth access token is discarded and is never stored.

## Website integration with server-side bearer tokens

For a website that keeps Core bearer tokens on its server, expose both linking routes through the **same public HTTPS website host**. For example, use `https://www.example.com/auth/discord-link/challenge` and `https://www.example.com/auth/discord-link/callback`, forwarding both paths to Core. This is a deployment contract supported by the current Core handlers; it does not establish that a website implementation or deployment already implements it.

1. The signed-in browser posts to the website's challenge route using its website session. The website handler must authenticate that session, apply its CSRF/origin protections, obtain that user's Core bearer token server-side, and forward the request to Core with `Authorization: Bearer <token>`. Never accept a caller-selected principal or token as a substitute for the authenticated website session.
2. Relay Core's response body and `Set-Cookie` headers to the browser without changing the binding cookie attributes. Preserve separate `Set-Cookie` headers if the website also sets session cookies. Preserve `Cache-Control: no-store`. The browser stores `__Host-discord-link` for `www.example.com` in production, with `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`, and no `Domain`. Browser JavaScript receives the authorization URL, but no bearer token or binding value.
3. Navigate the browser to the returned authorization URL. Set `DISCORD_OAUTH_REDIRECT_URL` to `https://www.example.com/auth/discord-link/callback` and register that exact URL with Discord. It must return to the same public host that delivered the challenge response, even if Core runs on another internal host.
4. Forward the callback query and browser `Cookie` header to Core's callback route. Relay Core's status, body or redirect, and `Set-Cookie` clearing header back to the browser. The callback handler uses the binding cookie and stored challenge; it does not require a bearer header. Do not complete the callback on a different Core API hostname.

A website-host challenge proxy alone is insufficient when Discord redirects to a separate Core host: the browser will not send the website's host-only cookie there. Both public routes above must be implemented before enabling this integration. Keep tokens server-side and preserve Core's cookie and single-use challenge checks. Do not log sensitive query strings or cookies at the proxy.

## Direct browser integration

A client that already holds a Core bearer session can call Core directly from the browser. The client and Core must be **same-site** (the same scheme and registrable domain) for the browser to retain the `SameSite=Lax` binding cookie. For cross-origin requests within that site, use `credentials: "include"` and configure credentialed CORS for the specific client origin at the deployment boundary; Core does not currently register a CORS plugin. The callback must return to the same public Core host that issued the cookie. Credentials alone do not allow a cross-site fetch response to set this cookie. This path is not suitable for a website that keeps bearer tokens exclusively server-side.

## Discord Developer Portal
Register the exact redirect URL:
`https://<PUBLIC_LINK_HOST>/auth/discord-link/callback`

`PUBLIC_LINK_HOST` is the website host for the server-side-token integration above, or the public Core host for direct browser integration.

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