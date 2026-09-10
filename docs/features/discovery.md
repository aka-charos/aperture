# Discover

Discover surfaces movies and TV series that **aren't in your library yet** — AI-scored suggestions you can request into your library in one click when your admin has configured Seerr.

![Discovery Page](../images/features/discovery.png)

## Accessing Discover

Navigate to **Discover** in the sidebar (compass icon).

**Note:** Your admin must enable Discover for your account; otherwise the page tells you it's not enabled.

---

## Page Layout

### Tabs

- **Movies** — movie suggestions
- **TV Series** — series suggestions
- **Streaming** — popular titles and streaming momentum from JustWatch charts (if your admin enabled it)

On the Movies and TV Series tabs, a second switch chooses between:

| Sub-tab | Description |
|---------|-------------|
| **Picked for you** | The scored suggestion pool, ranked by match to your taste |
| **Popular by genre** | TMDb Discover strips per genre — several genres together means titles matching all of them |

A line under the tabs reports the state of the current run: **"Last updated: … • Showing X of Y suggestions, scored from Z candidates."**

### Filters

The **Filters** button opens the user filters: **Language**, **Genre**, **Year range**, and a minimum **taste match** slider. Your filters persist between visits. Changing them doesn't re-run anything — the page *finds more* content matching your filters from what's already been scored.

### View Modes

| Mode | Description |
|------|-------------|
| **Grid View** | Poster cards with badges |
| **List View** | Detailed rows with metadata and scores |

---

## Suggestion Cards

| Element | Description |
|---------|-------------|
| **Rank badge** | Position in the current list (numbered, like all rank badges in Aperture) |
| **Source badge** | Where the suggestion came from (Trending, Popular, …) |
| **Match %** | How well it scored against your taste |
| **Requested chip** | Your request status, once requested |

Click a card to open the TMDb detail modal; hover to request it.

---

## Where Suggestions Come From

Your admin configures which sources feed the pool; each suggestion carries a badge naming its source:

| Source | Description |
|--------|-------------|
| **TMDb Recommended** | Based on content you've watched |
| **Similar Titles** | Based on titles related to what you watch |
| **TMDb Popular** | Popular/trending meeting quality thresholds |
| **Trending / Popular / Trakt Pick** | Trakt charts and personalized picks, if Trakt is connected |
| **MDBList** | Curated external lists |
| **Streaming charts** | JustWatch streaming charts (the Streaming tab) |

---

## AI Scoring

Each candidate is scored against **your taste profile** — the clusters built from your watch history and ratings. The blend weighs similarity to your taste heaviest, with popularity, recency, and the strength of the source signal making up the rest; your admin can tune the balance. The **Match %** on each card is that blend.

The detail modal shows the components: the overall **AI match score**, the raw **Similarity**, and where the title ranks for you ("Taste match: #14 of 520").

---

## Detail View

Click any card for the full TMDb picture:

- Backdrop, year, runtime, genres, vote count
- **Top 8 cast** with photos and character names; director/creator
- An embedded **trailer** player
- Person names link to their Aperture pages; a **Request** button is right there

---

## Requesting Content

If your admin has configured Seerr and enabled requests for your account:

1. **Hover** a card and click **Request** (or use the Request button in the detail modal)
2. A confirmation appears, and the card's chip shows the request status

| Status | Meaning |
|--------|---------|
| **Requested** | Submitted, awaiting approval |
| **Approved** | Approved and on its way |
| **Declined** | Declined |

Later stages — **Processing**, **Partially available**, **Available** — show on the [My Requests](my-requests.md) page, which tracks everything you've asked for. If you don't see the Request button, requests aren't enabled for your account.

---

## Refreshing Suggestions

- **Scheduled** — the discovery job runs on a schedule (typically daily); a banner shows when it's currently **generating new suggestions**, and Refresh is disabled while it runs.
- **Manual** — **Refresh** re-runs discovery for your account: new candidates are fetched from the sources and scored against your latest activity.
- **Expanding** — with filters applied, the page can fetch *more* candidates matching them ("Finding more content matching your filters…").

---

## What Gets Excluded

The pool already excludes:

- Content already in your library
- Content you've watched

One honest caveat: **declined and failed requests are not excluded** — a declined title can resurface in a later run.

---

## Tips

### Improving Discovery

- Rate more content — the taste match is only as good as your profile
- Connect [Trakt](trakt-integration.md) for its personalized sources
- Watch and rate broadly so the similarity signal has something to work with

### Using It Well

- Set a **min taste match** filter to see only strong matches
- Check the **Streaming** tab for what's charting right now
- Track everything you've asked for under [My Requests](my-requests.md)

---

**Next:** [My Requests](my-requests.md)
