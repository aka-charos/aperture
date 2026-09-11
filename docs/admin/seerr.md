# Seerr Integration

Connect to Seerr (Jellyseerr/Overseerr) to enable content **requests** and **issue reporting** for your users.

![Admin Settings - Integrations](../images/admin/admin-settings-setup-integrations.png)

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

Aperture matches its users to Seerr users **automatically, in tiers**: media-server **GUID** → **email** → **username** → **display name**, with ambiguity guards. Importing your users into Seerr is what seeds the top tiers. There's no manual mapping UI on this page — each user's resolved Seerr identity is visible and overridable on their [user detail page](user-management.md); a failed mapping refuses bulk requests with "Seerr account not linked" when mapping is required.

## Status Model

- **Request status**: `pending → approved → declined`
- **Availability**: `unknown → pending → processing → partially available → available`
- In the UI, requested/pending/approved render in the theme colour; declined in red

## Storage Note

The URL and key are stored in `system_settings` **in plain text** (redacted from logs and form-fill responses) — protect database dumps like credentials.

---

**Related:** [Gap analysis](gap-analysis.md) · [User management](user-management.md) · [Top Picks](top-picks.md)
