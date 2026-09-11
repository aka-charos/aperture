# LLDAP Email Import

Import user email addresses from an LLDAP directory, so features that email users (notifications) have addresses without manual entry.

## Where It Lives

Admin console → **Integrations** → **LLDAP** (`/admin/integrations/lldap`). Shows a green **Configured** chip once URL, username, and password are all set.

## Configuration

| Field | Notes |
|-------|-------|
| **Server URL** | e.g. `https://lldap.example.com` |
| **Admin Username** | Must be an **LLDAP admin account** — regular accounts can't look up other users |
| **Admin Password** | Masked once saved ("Password is saved. Enter a new one to replace it."); whitespace is stripped before submit |
| **Enable LLDAP email import** | Master switch — disabled until the three fields above are present. Caption: "Users without a manually-set email will get theirs from LLDAP" |

**Save** and **Test Connection** buttons; the test reports how many users it found ("Connection successful! Found N user(s) in LLDAP.").

## How Sync Works

The daily `sync-lldap-emails` job (03:15) authenticates to LLDAP, fetches all users, and matches **Aperture username → LLDAP user id, case-insensitively**:

- **Matched** — email copied across, unless the user's email is **locked** (manually set emails are never overwritten)
- **Unmatched** — skipped silently; not an error
- The summary (`{matched, updated, skipped, total}`) lands in the job run history

Unconfigured instances don't fail the job — it logs "LLDAP is not configured — nothing to do" and completes cleanly. Failures (auth, unreachable server) surface in the [API errors](api-errors.md) panel under the LLDAP provider.

## The Premise

This only makes sense when **Emby/Jellyfin authenticates against the same LLDAP** — that's what makes usernames align. If your media server has independent accounts, matching will skip everything.

There is no "sync now" button on the page — manual runs go through **Operations → Jobs → Sync LLDAP Emails**.

---

**Related:** [User management](user-management.md) · [Jobs overview](jobs-overview.md) · [API errors](api-errors.md)
