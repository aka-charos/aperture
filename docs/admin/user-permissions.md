# User Permissions

What each user may do, where it's granted, and what the user still controls themselves.

![Admin Users](../images/admin/admin-users.png)

## The Per-User Permission Set

Granted on the **user detail page → Settings** tab (`/admin/access/users/:id`):

| Permission | Grants |
|------------|--------|
| **Movies / Series enabled** | The user gets that media type at all (recommendations, stats, history) |
| **Discovery suggestions** | Access to the [Discover](../features/discovery.md) page |
| **Content requests** | Request buttons anywhere (requires Discovery; disabling Discovery force-disables this) |
| **Allow creating collections** | Their [collections](../features/collections.md) write to the media server for everyone |
| **Email notifications** | The Email & Notifications card in their Preferences |
| **Manage watch history** | Mark watched/unwatched (with the watch-date prompt); admins always can |
| **AI explanation override** | Let the user choose their own explanation preference |
| **Seerr user mapping** | Override the auto-matched Seerr identity |

Admins see and can reach everything regardless of toggles.

## What Users Control Themselves (No Admin Gate)

- **Algorithm weights** — the master toggle and four sliders in their [AI Algorithm](../features/user-settings/ai-algorithm.md) tab (admin defaults apply until they flip it on)
- **Taste profile tuning** — genre/franchise weights, interests, library exclusion (their [Watcher Identity](../features/user-settings/watcher-identity.md))
- **AI library names** — renaming their own AI Picks libraries
- **Poster display, language, similarity prefs** — their [Preferences](../features/user-settings/preferences.md)

## The One Global Gate That Interacts

**Recommendations → Explanations → "Allow Per-User Overrides"** is the global switch that makes the per-user AI-explanation permission meaningful; the effective value chains global default → your grant → their choice (see [AI Explanations](ai-explanations.md)).

---

**Related:** [User management](user-management.md) · [AI explanations](ai-explanations.md) · [Libraries](libraries.md)
