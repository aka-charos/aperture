# Seerr Integration

Connect to Seerr (Jellyseerr/Overseerr) to enable content **requests** and **issue reporting** for your users.

## Accessing Settings

Admin console → **Integrations** → **Seerr** (`/admin/integrations/seerr`).

## Configuration

| Setting | Description |
|---------|-------------|
| **URL** | Your Jellyseerr/Overseerr base URL |
| **API Key** | From Seerr → Settings → General |
| **Enable Seerr for content requests** | Master switch — the card shows an Enabled/Disabled chip |

## What It Enables

| Feature | Where users touch it |
|---------|---------------------|
| **Requests** | [Discover](../features/discovery.md) hover-request, [person pages](../features/person-pages.md) "not in your library", [series detail](../features/series-detail.md) missing seasons, the search-and-request panel on [My Requests](../features/my-requests.md) |
| **Issue reporting** | "Report a problem" on any title's page → proxied to Seerr (Aperture keeps no issue mirror) |
| **Top Picks auto-request** | Weekly `auto-request-top-picks` job (when enabled per media type) |
| **Gap analysis requests** | Bulk requests from [Gap analysis](gap-analysis.md) |

The daily `reconcile-discovery-requests` job (04:30, ahead of the suggestions run) pulls live statuses from Seerr — which is what lets a declined title be suggested again.

## User Mapping

Every call Aperture makes to Seerr on a user's behalf is made **as that user**, so a request or an issue appears in Seerr under their name, Seerr's own notifications name them, and Seerr's own permissions and quotas apply to them. That includes auto-approval: a user without auto-approve in Seerr gets a **pending** request, and an admin can approve or decline it in Aperture from the all-users view of [My Requests](../features/my-requests.md), as well as in Seerr. When Seerr refuses a request (a quota, a missing permission), the user sees Seerr's own reason.

Aperture matches its users to Seerr users **automatically, in tiers**: media-server **account id** → **email** → **username** → **display name**. The first tier with exactly one match wins; a tier matching several Seerr users stops the search rather than guessing. Importing your media-server users into Seerr is what makes the first tier work. A user's match can be overridden with a Seerr user id on their [user detail page](user-permissions.md) (Settings tab → **Seerr mapping**).

A user who cannot be matched still gets requests through, made as the owner of the API key (as before). Issue reporting is refused for them instead, with an explanation, because Seerr would file their comments under the admin's name.

Non-admins never see root folders or quality profiles: the request options dialog is offered to admins only, and everyone else's requests use their Seerr defaults.

## Status Model

- **Request status**: `pending → approved → declined`
- **Availability**: `unknown → pending → processing → partially available → available`
- In the UI, requested/pending/approved render in the theme colour; declined in red

## Storage Note

The URL and key are stored in `system_settings` **in plain text** (redacted from logs and form-fill responses) — protect database dumps like credentials.

---

**Related:** [Gap analysis](gap-analysis.md) · [User management](user-management.md) · [Top Picks](top-picks.md)
