# User Management

Manage accounts, feature access, and per-user operations.

![Admin Users](../images/admin/admin-users.png)

## Where It Lives

Admin console → **Access** → **Users** (`/admin/access/users`); click a row for the **user detail page** (`/admin/access/users/:id`).

## The User List

- **Sync Users** imports accounts from the media server (also automatic every 30 minutes); provider users not yet imported can be imported individually
- Per row: admin badge, quick **Movies / Series** enable toggles, and a **⌄ menu** with **"View the app as this user"** (read-only impersonation) and per-user job shortcuts — **sync history / generate recommendations / update libraries / run all**
- Sorting by email, last login, last activity

## User Detail Page

Tabs across the top:

- **Watch History** — a paginated, sortable view (recent/plays/title) of everything they've played, with play counts and favorite badges
- **Settings** — the per-user permissions and grants (see [User permissions](user-permissions.md)):
  - Movies / Series enabled
  - **Discovery suggestions** and **content requests** (disabling discovery force-disables requests)
  - **Allow creating collections** (their playlists/collections write to the server for everyone)
  - **Email notifications** opt-in (feature gated)
  - **Manage watch history** permission (lets them mark watched/unwatched)
  - **AI explanation override** permission
  - **Seerr user mapping** override

## Disabled Accounts

Disabling a user (or both media toggles) blocks login even with valid media-server credentials — the login page tells them to contact an administrator. Re-enabling restores access.

## Emails

Emails come from the media-server sync, **manual entry**, or the [LLDAP integration](integrations-overview.md) (`sync-lldap-emails` job).

---

**Related:** [User permissions](user-permissions.md) · [Shows You Watch configuration](shows-you-watch.md) · [Jobs overview](jobs-overview.md)
