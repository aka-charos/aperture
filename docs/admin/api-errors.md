# API Errors

How integration failures surface to admins, and how to clear them.

![Admin Settings - Integrations](../images/admin/admin-settings-setup-integrations.png)

## Where It Appears

An **error alert** mounts inside the admin shell and shows only on **Integrations** pages, listing the most recent failures (up to 5) with a detected-at timestamp and an indicator chip elsewhere in the shell. It's UI-only — no email or webhook notification.

## Covered Providers

Every integration client reports structured failures to one sink:

**OpenAI, Google (Gemini), Tavily, fastCRW, TMDb, Trakt, MDBList, OMDb, LLDAP**

Each provider's client classifies failures — so a message is specific (e.g. OMDb answers some errors as HTTP 200 with an error body; fastCRW reports errors in the message before the status). Seerr failures are not part of this sink; they surface in Seerr's own dashboard.

## Error Types

| Type | Presentation |
|------|--------------|
| **Auth** (red) | Invalid or revoked key |
| **Rate limit / quota limit** (amber) | Throttling or exhausted quota — shows a **reset countdown** where the provider reports one |
| **Outage** (blue) | Provider unreachable / server errors |

Dismissal-aware: alerts can be dismissed per provider, and a **successful connection test** auto-clears auth/outage alerts for that provider. Quota errors are **never auto-cleared** — a test passing doesn't mean the quota reset.

## Retention

- Alerts stop displaying after **7 days** and are purged after **30** (a manual cleanup action exists on the errors API)
- Dismissed rows are deleted after 7 days
- Errors are informational — jobs keep their own retry/lockout behavior regardless

## What To Do

Each alert carries an action button where one applies (Check Settings / Learn More / Upgrade), deep-linking to the right integration page. Fix, **Test** on the integration card, and the alert clears; if the failure was quota, wait for the reset.

---

**Related:** [Integrations overview](integrations-overview.md) · [OMDb](omdb.md) · [AI providers](ai-providers.md)
