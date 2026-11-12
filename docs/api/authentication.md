# Authentication API

Base path: `/auth`. All endpoints return JSON except successful logout (204).

## Register

`POST /auth/register`

```json
{
  "username": "Player_One",
  "email": "player@example.com",
  "password": "use-a-long-unique-password"
}
```

Password minimum is 12 characters. Usernames are 3–32 ASCII letters, digits or underscores. The server hashes passwords using Argon2id. Registration currently does not verify email; do not use email as a recovery factor until verification and recovery flows are implemented.

## Login

`POST /auth/login`

```json
{ "username": "Player_One", "password": "use-a-long-unique-password" }
```

Successful registration/login returns a one-time opaque bearer token and expiry. Store it securely; never put it in a URL or logs.

## Current player

`GET /auth/me`

Header: `Authorization: Bearer <token>`

## Logout

`POST /auth/logout`

Header: `Authorization: Bearer <token>`

Revokes the presented session.

## Current limitations

- Email verification and password reset are not implemented.
- External Discord/Steam account linking is not implemented.
- Multi-factor authentication is not implemented.
- Tokens are opaque and stored as SHA-256 hashes; sessions expire after seven days.
- Authentication is a foundation, not a complete production identity service.
