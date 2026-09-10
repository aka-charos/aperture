# Top Picks

Top Picks ranks the most popular titles across all users of your server, over a recent window — what the household has been watching, not what fits you personally.

![Top Picks Page](../images/features/top-picks.png)

## Accessing Top Picks

Navigate to **Top Picks** in the sidebar (flame icon). The page has two tabs: **Movies** and **Series** ("Top Pick Movies" / "Top Pick Series").

---

## The Ranking

The header states exactly what's being ranked: **"Ranked by popularity based on watch activity from all users over the last N days"** — the window is admin-configured (default 30 days). A **Last refreshed** caption shows when the ranking was last computed.

This is deliberately **not personalized**: it's the same list for everyone. For picks that fit you specifically, see [My Recommendations](recommendations.md).

---

## Page Layout

### View Modes

| Mode | Description |
|------|-------------|
| **Grid View** | Poster grid with rank badges and viewer chips |
| **List View** | Detailed rows with viewer stats |

### Rank Badges

Each title carries a numbered rank badge (#1, #2, …) — the same badge that's burned into the poster overlays when Top Picks are written into your media server.

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

## Top Picks vs Recommendations

| Aspect | Top Picks | Recommendations |
|--------|-----------|-----------------|
| **Based on** | All users' activity | Your personal taste |
| **Personalized** | No — same list for everyone | Yes |
| **Good for** | What the household is into right now | Matches for you specifically |
| **Window** | Last N days | Since the last run |

Use both: Top Picks to see what everyone's talking about, Recommendations for what fits you.

---

## Top Picks in Your Media Server

If your admin configured it, Top Picks are also written into Emby/Jellyfin:

- As libraries named **"Top Picks - Movies"** and **"Top Picks - Series"**, or as a **Box Set collection** or **playlist** — depending on the output your admin chose
- Rank badges burned into the poster overlays
- Refreshed automatically on the admin's schedule

See [Virtual Libraries](virtual-libraries.md).

---

**Next:** [Discovery](discovery.md)
