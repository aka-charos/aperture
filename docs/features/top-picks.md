# Most Watched Lately

Most Watched Lately ranks the most watched titles across all users of your server, over a recent window — what the household has been watching, not what fits you personally.

## Accessing Most Watched Lately

Navigate to **Most Watched Lately** in the sidebar (flame icon). The page has two tabs: **Movies** and **Series** ("Most Watched Movies Lately" / "Most Watched Series Lately").

---

## The Ranking

The header states exactly what's being ranked: **"Ranked by popularity based on watch activity from all users over the last N days"** — the window is admin-configured (default 30 days). The list is worked out when you open the page. On servers that still write the older Top Picks libraries (the legacy name for this list), a **Last refreshed** caption shows when those were last written.

This is deliberately **not personalized**: it's the same list for everyone. For picks that fit you specifically, see [My Recommendations](recommendations.md).

---

## Page Layout

### View Modes

| Mode | Description |
|------|-------------|
| **Grid View** | Poster grid with rank badges and viewer chips |
| **List View** | Detailed rows with viewer stats |

### Rank Badges

Each title carries a numbered rank badge (#1, #2, …). Titles from libraries your account can't open are left out, so the list may skip numbers others see.

---

## Understanding the Numbers

In list view, each title shows:

| Stat | Description |
|------|-------------|
| **Unique Viewers** | How many different users watched it — broadly popular |
| **Play Count** | Total plays ("10+ plays" caps the chip) — high plays with few viewers means a few people rewatch it |
| **Community Rating** | Average rating from your media server |

Series add their own stats: **episodes watched**, **% avg completion** (how much of each episode the household actually watches), and a **network** chip.

Every title also shows whether *you've* watched it (✓ on the poster), and you can rate directly — hover a poster in grid view, or use the inline control in list view. Your ratings still feed your own recommendations.

---

## Popularity Sources

Your admin configures where the ranking comes from; the header tells you which is active:

- **Server watch history** — your community's actual viewing, the default
- **TMDb** — popular, trending (daily/weekly), or top-rated charts
- **MDBList** — curated external lists
- **Hybrid** — local activity blended with one external source

---

## Most Watched Lately vs Recommendations

| Aspect | Most Watched Lately | Recommendations |
|--------|-----------|-----------------|
| **Based on** | All users' activity | Your personal taste |
| **Personalized** | No — same list for everyone | Yes |
| **Good for** | What the household is into right now | Matches for you specifically |
| **Window** | Last N days | Since the last run |

Use both: Most Watched Lately to see what everyone's talking about, Recommendations for what fits you.

---

## Most Watched Lately in Your Media Server

On Emby, Most Watched Lately can appear as two **rows on your home screen** (movies and series) when your admin has switched home rows on; you can hide or move them on the **Emby home screen** tab of your settings ([Emby Home Screen](user-settings/home-screen.md)).

Older setups may also write Top Picks into Emby/Jellyfin as libraries named **"Top Picks - Movies"** / **"Top Picks - Series"**, a Box Set collection or a playlist, with rank badges burned into the posters. That output is being phased out; see [Virtual Libraries](virtual-libraries.md).

---

**Next:** [Discovery](discovery.md)
