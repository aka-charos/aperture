# Trakt Integration

Connect your Trakt.tv account to keep your ratings in sync and add Trakt-powered sources to [Discover](discovery.md).

![User Settings - Profile](../images/user-settings/user-settings-profile.png)

## What Syncs

**Ratings only — in both directions:**

- **Aperture → Trakt** — rating or clearing a title pushes the change to Trakt immediately
- **Trakt → Aperture** — a scheduled job imports your Trakt ratings (1–10 mapped onto the same scale) every **6 hours**, or on demand via the **Sync Ratings** button

Trakt does **not** import your watch history into Aperture — your Aperture history comes from your media server. Trakt ratings simply join the evidence the recommender uses.

Discover also gains three extra sources when you're connected: **Trending**, **Popular**, and **Trakt Pick** (personalized recommendations).

---

## Connecting Trakt

### Prerequisites

1. A Trakt.tv account (free tier works)
2. Your admin has configured the Trakt integration — if not, the Trakt card doesn't appear at all

### Connection Steps

1. Open **Settings → Preferences** (the Trakt card lives there)
2. Click **Connect to Trakt**
3. You'll be redirected to Trakt — log in and authorize Aperture
4. You're returned to Aperture and confirmed connected

### Once Connected

The card shows **Connected as: {username}** and **Last synced: {date}**, with buttons:

| Button | What it does |
|--------|--------------|
| **Sync Ratings** | Imports your Trakt ratings right now |
| **Disconnect** | Removes the link immediately (no confirmation dialog) |

---

## Tips

- **Rate in whichever app you're holding** — the two stay converging either way
- **Sync after rating a burst on Trakt** rather than waiting for the 6-hour job
- **New ratings from Trakt affect your next recommendation run** — regenerate afterwards to feel them

---

**Next:** [Collapsible Sidebar](collapsible-sidebar.md)
