# Watcher Identity

**Watcher Identity** is your taste profile: what Aperture has learned from your watch history, made inspectable and adjustable. It's the model behind genre boost/avoid, franchise affinities, stated interests, and the taste sentences you can read about yourself.

![User Settings - Watcher Identity](../../images/user-settings/user-settings-watcher-identity.png)

## Accessing

Click your **avatar** in the top bar and pick **Watcher Identity**.

The AI-written taste prose itself ("Movie Identity" / "TV Series Identity") lives on the [Watch Stats](../watch-stats.md) page — this tab is the machinery underneath it.

---

## Identity Settings

- **Status** — Active once you've been analyzed; otherwise "Not Analyzed"
- **Analyzed {date}** — when the profile was last rebuilt
- **Auto-refresh** — the profile rebuilds itself periodically as you watch; a **lock** switch freezes it (with an interval from 7 days to 1 year), so a viewing spree or a housemate's session can't rewrite a profile you've tuned by hand

## Analyze Watch History

The **Analyze Watch History** button re-reads your history and rebuilds the profile. If you already have customized preferences, it asks which way to go:

| Mode | Effect |
|------|--------|
| **Reset All** | Clear everything and recalculate from scratch |
| **Add New Only** | Keep your customized weights and only add newly detected franchises/genres |

Newly detected items are flagged **NEW** in their lists.

## Specific Interests

Free-text chips — *"Time travel stories"*, *"Dark comedies"*, *"Underdog sports dramas"* — that feed recommendations directly. Type and press Enter.

## Franchise Weighting

Per media type (Movies / TV Series sub-tabs), every franchise detected in your viewing gets a slider from **Avoid (−1)** through **Neutral (0)** to **Boost (+1)**:

- Boost franchises you love, avoid the ones you're done with
- Each entry can be removed entirely (✕) — that's "stop modeling this"
- The two threshold dropdowns decide what's worth modeling at all: **Min Franchise Size** (titles available in the library, 2–10) and **Min Watched** (how many you've seen from it, 1–10)

## Genre Weighting

One card, **shared between movies and TV series**:

- Slider **0–2** with **1 = Normal**; **Less** below 0.7, **Boost** above 1.3
- Genres you enjoy up, genres you want to avoid down — changes apply to all features

## Library Sources

Per media type, choose **which of your server's libraries** contribute to the taste profile. Your AI Picks and system libraries are automatically excluded, so the profile never reads its own output.

---

## Tips

- **Analyze first, tune second** — let the detector populate the lists, then bend them
- **Use Add New Only after hand-tuning** — a full reset discards your slider work
- **Lock the identity** if you share a media server and don't want someone else's watching reshaping your profile

---

**Next:** [Trakt Integration](../trakt-integration.md)
