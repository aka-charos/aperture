# The Rating System

Aperture uses a **1–10 star rating**. Ratings are the strongest taste signal the recommender has, and they sync to Trakt if you've connected it.

![Browse Movies with Ratings](../images/features/browse-movies-list.png)

## Rating a Title

### From a poster

1. **Hover** any poster — your current rating appears as a single star icon, filled proportionally (half-filled icon = 5, full = 10; the icon is deliberately distinct from the red favorite heart)
2. Hover or click it and a **popper opens with stars 1–10**, the label under the popper naming the value:

| Value | Label | Value | Label |
|-------|-------|-------|-------|
| 1 | Terrible | 6 | Fair |
| 2 | Awful | 7 | Good |
| 3 | Bad | 8 | Great |
| 4 | Poor | 9 | Amazing |
| 5 | Meh | 10 | Perfect |

3. **Click** a star to rate; **click the same value again** to clear the rating entirely

### From list views and detail pages

List rows carry the rating inline (no hover needed), and detail pages have the same popper on the hero's rating display. Rating works from the dashboard, Browse, Recommendations, Watch History, search results, and person/studio carousels — anywhere a poster appears.

---

## Where Ratings Show Up

- **Dashboard** — the Recent Ratings card, with dates ("Rated on Jan 11, 2026"), rateable in place
- **[Watch Stats](watch-stats.md)** — aggregate views of what you watch and how the crowd rates it
- **Recommendations** — ratings are the single biggest input to [your AI picks](recommendations.md)
- **Your media server** — nothing is written back to Emby/Jellyfin by rating itself (except the watch-date prompt below); the rating lives in Aperture
- **Trakt** — pushed immediately on rate and on clear, if connected (see [Trakt Integration](trakt-integration.md))

---

## Rating Something You Never Played

If your media server has no record of you playing a movie you rate, Aperture asks **"When did you watch *title*?"** — because a rating without a watch is half the story, and your server should reflect reality:

- Five time bands are offered: **This month**, **Last month**, **Earlier this year**, **Last year**, **Longer ago than that**
- The bands are **clamped to the title's release** — a 1998 film keeps all five; something released this month offers fewer, and an unreleased title offers none
- Choosing a band marks the title watched **on your media server** with a date from the band (the midpoint of it), and stores that the date is approximate — so your history and stats reflect the watch without inventing a fake play at a fake hour
- If only one band survives, the prompt becomes a simple *"Mark as watched?"* yes/no — one surviving option shouldn't pretend to be a choice
- **Not now** — saves the rating only
- **I haven't seen it** — the named dismissal: the rating is saved, Aperture records you haven't seen it, and it never asks about this title again

This prompt applies to **movies only** — series episodes aren't dated this way.

---

## How Ratings Affect Recommendations

### High ratings (7–10)

Strong positive evidence: similar titles, genres, people, and franchises rise in future runs. Favoriting works in the same direction.

### Low ratings (1–3)

How dislikes are treated is your choice under [AI Algorithm Settings](user-settings/ai-algorithm.md):

| Mode | Effect |
|------|--------|
| **Exclude Completely** (recommended) | Disliked titles never appear in recommendations |
| **Penalize But Allow** | They're scored down but can still appear if something else fits strongly |

Either way the model learns from what you don't like. The **Your Disliked Content** list in the same tab lets you re-rate or clear any of them.

### Middle ratings (4–6)

Minimal push either way — "it was fine" is a legitimate answer, and a useful one.

---

## Tips

- **Be consistent** — a 7 should always mean the same thing to you; the model learns your scale
- **Use the full scale** — a 3 and a 6 mean very different things
- **Rate both likes and dislikes** — low ratings are valuable data
- **Backfill older favourites** — the watch-date prompt makes dating them easy, and old favourites are powerful evidence

---

**Next:** [My Recommendations](recommendations.md)
