# API Keys

Keys that let other tools call this instance's API — scripts, integrations, Home Assistant dashboards, curl.

## Where It Lives

Admin console → **Access** → **API keys** (`/admin/access/api-keys`). **Users can manage their own keys too** (same section in their user settings); the admin page adds the **all-users view** with a User column.

## How They Authenticate

Sent as an **`x-api-key` header**, checked before the session cookie. A key resolves to **its owner's full identity and permissions** — admin status, enabled flags, watch-history permission — so a key effectively *is* its owner; there are no separate scopes. Treat and share keys accordingly.

## Key Format & Lifetime

- Format: `apt_` + 32 hex characters
- Stored **hashed** (sha256) with an 8-character prefix kept for display — the plaintext is shown **once** at creation ("Copy this key now. You won't be able to see it again!")
- Expiration: **Never / 7 / 30 / 60 / 90 / 180 / 365 days**
- **Last used** is tracked on every use — the fastest way to spot dead keys

## Managing Keys

| Action | Notes |
|--------|-------|
| **Create** | Name + expiry; plaintext shown once |
| **Rename / change expiry** | Allowed while active; **revoked keys are immutable** |
| **Revoke** | Soft-revoke (keeps the row, stops auth); permanent delete is available for admins or already-revoked keys |
| **View all** | Admins see every user's keys; users see only their own |

Expired and revoked keys show status chips in the table and authenticate nothing.

---

**Related:** [User permissions](user-permissions.md) · [User management](user-management.md)
