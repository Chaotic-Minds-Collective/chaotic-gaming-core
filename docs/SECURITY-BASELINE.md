# Security baseline

- Never expose PostgreSQL directly to browsers, Discord bots or game plugins.
- Each integration receives its own service principal and narrowly scoped credential.
- Persist only cryptographic hashes of bearer/session secrets; show generated secrets once.
- Require proof of ownership before linking Discord, Steam or game identities.
- Enforce account status and scoped permissions on every protected API operation.
- Treat Discord roles as display/community metadata, not automatic platform administrator grants.
- Verify payment provider signatures server-side before granting entitlements.
- Use idempotency keys for externally retried state-changing operations.
- Record privileged actions and security-relevant failures in the audit log.
- Use TLS, secret rotation, rate limits, secure cookies, CSRF protection where cookie sessions are used, and strict CORS allowlists.
- Do not run migrations against production without an explicit deployment/change window.
