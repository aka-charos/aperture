# Trakt Integration

Connect Aperture to Trakt.tv so **users** can sync their ratings and [Discover](../features/discovery.md) can use Trakt charts as sources.

![Admin Settings - Integrations](../images/admin/admin-settings-setup-integrations.png)

## Accessing Settings

Admin console → **Integrations** → **Trakt** (`/admin/integrations/trakt`).

## Creating the Trakt App

1. Sign in at [trakt.tv](https://trakt.tv) → **Settings → API** → create a new application
2. Name it anything; the **Redirect URI** is the important field — see below
3. Copy the **Client ID** and **Client Secret** into Aperture

## The Redirect URI

The page generates and displays the exact callback URL — `https://<your-aperture>/api/trakt/callback` — in a read/editable field, with the instruction: **copy this URL into your Trakt app's Redirect URI field**. If your instance is reachable at more than one address (internal and reverse-proxied), edit the field to the one users' browsers actually use; the out-of-band `urn:ietf:wg:oauth:2.0:oob` URI this doc once recommended is **dead** — the flow is a full-page redirect.

There is no test button here: save the credentials and prove them with a user connect.

## What Users Get

- **Rating sync** — pushing a rating or clearing it goes to Trakt **immediately**; a job imports Trakt ratings for all connected users **every 6 hours**. Ratings only — **Trakt watch history is not imported** anywhere
- **Discovery sources** — `Trending`, `Popular`, and `Trakt Pick` (personalized) join the Discover pool; the trending window is tunable under [Discovery tuning](discovery-tuning.md)

## User Connect Flow

Users connect from **User Settings → Preferences → Trakt Integration** (the card is hidden until you configure credentials): a full-page redirect to Trakt to authorize, then back to Aperture with a success/failure banner. **Tokens are per user** — connecting is each user's choice, disconnecting is one click and immediate (no confirmation dialog).

## Troubleshooting

- **"Redirect URI mismatch" at Trakt** — the URL in your Trakt app doesn't match the field on this page (scheme, host, or port differs)
- **Users see no Trakt card** — credentials aren't saved on this page
- **Ratings not arriving** — check the `sync-trakt-ratings` job history; expired user tokens need a reconnect on the user side

---

**Related:** [Trakt (user doc)](../features/trakt-integration.md) · [Discovery tuning](discovery-tuning.md) · [Jobs overview](jobs-overview.md)
