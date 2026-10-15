# API Keys

Keys that let other tools call this instance's API — scripts, integrations, Home Assistant dashboards, curl.

## Where It Lives

Admin console → **Access** → **API keys** (`/admin/access/api-keys`), with a **User** column showing whose each key is. The API lets any signed-in user manage their own keys, but this console page is the only screen for it.

## How They Authenticate

Sent as an **`x-api-key` header**, checked before the session cookie. A key acts as the account that made it, but **only with the permissions it was given**:

| Permission | Allows |
|------------|--------|
| **Read** | Always included. Reading anything the account can read; every request that would change something is refused |
| **Write** | Changing things: ratings, playlists, requests, settings |
| **Admin** | Using the account's admin rights, including jobs and system settings. Grants nothing on a non-admin's key |

A permission only narrows what the account can do; it never adds to it. New keys are **Read** unless you tick more. Keys made before permissions existed were given all three, so integrations already wired up keep working; to narrow one from this page, revoke it and create a narrower one (the API can also change a key's permissions in place). A refused request says the key is read-only, so a script that starts failing can tell a narrowed key from an account that lost a permission.

A key also stops working when its account loses access or is disabled on the media server.

## Key Format & Lifetime

- Format: `apt_` + 32 hex characters
- Stored **hashed** (sha256) with an 8-character prefix kept for display — the plaintext is shown **once** at creation ("Copy this key now. You won't be able to see it again!")
- Expiration: **Never / 7 / 30 / 60 / 90 / 180 / 365 days**
- **Last used** is tracked on every use — the fastest way to spot dead keys

## Managing Keys

| Action | Notes |
|--------|-------|
| **Create** | Name, expiry and permissions; plaintext shown once |
| **Rename / change expiry / change permissions** | Through the API only (`PATCH`), while the key is active; **revoked keys are immutable** |
| **Revoke** | Soft-revoke (keeps the row, stops auth); permanent delete is available for admins or already-revoked keys |
| **View all** | Admins see every user's keys; users see only their own |

Expired and revoked keys show status chips in the table and authenticate nothing.

---

**Related:** [User permissions](user-permissions.md) · [User management](user-management.md)
