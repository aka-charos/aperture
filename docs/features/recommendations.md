# My Recommendations

The My Recommendations page shows AI-generated picks personalized to your taste, based on your watch history, ratings, and profile.

![Recommendations Page](../images/features/recommendations.png)

## Accessing Recommendations

Navigate to **Recommendations** in the sidebar (sparkle icon).

---

## Page Layout

### Tabs

Switch between content types:

- **Movies** — your movie picks
- **TV Series** — your series picks

Each tab shows a count chip, and a run line underneath: **"Last updated: … • 24 picks from 1,180 candidates."**

### View Modes

Toggle between display modes:

| Mode | Description |
|------|-------------|
| **Grid View** | Poster grid with rank badges |
| **List View** | Detailed rows with score bars |

### Regenerate

The **Regenerate** button re-runs recommendations for you, right now — no need to wait for the scheduled job or ask an admin. It syncs your latest watch history first, then scores and ranks; it can take a little while.

---

## Reading a Pick

- **Rank badge** — a numbered badge (#1, #2, …), the same badge that's burned into the poster overlays of your AI Picks library in your media server
- **Match score** — "Match Score: 87%" against your taste
- **Score bars** (list view) — **Similarity**, **Novelty**, and **Rating** shown separately
- **Reason line** — a short "why this made your list" note
- **Watch trailer / View on TMDb** — quick actions on each pick
- **Watched badge** — anything you've already seen, so it can't surprise you (picked titles exclude it; anything showing here was watched after the run)

A few picks aren't driven by the scores at all: some come from **someone here with taste like yours** (a taste twin — never named), some from **interests you've stated** in your profile, and some are **critically acclaimed** titles the run reserves a slot for. The reason line says which.

---

## Understanding a Pick in Depth

Click any pick to open its detail page, where the insights panel breaks the match down:

- **How We Calculated Your Match** — **Taste Match** (similarity to your history), **Discovery** (novelty against what you usually watch), and **Quality** (community and critic ratings), with each factor's weight share, blended, then adjusted by your franchise and genre preferences
- **Evidence** — "Based on your history with similar movies:" the specific titles that pulled it in
- **Variety In Your List** — how much this pick differs from the others chosen with it; it shapes the order of your list, not the match
- **AI explanation** — "Why *Aperture* picked this for you", if your admin enabled it

See [Movie Details](movie-detail.md) for the full panel.

---

## How Recommendations Are Generated

### Input

The pipeline considers your watch history, your ratings, your [Watcher Identity](user-settings/watcher-identity.md) — genre weights, franchise affinities, stated interests — and community/critic ratings. Your watch history is synced immediately before every run, so recently watched titles are excluded properly.

### Scoring Weights

Each candidate is scored with configurable weights:

| Factor | Default | Description |
|--------|---------|-------------|
| **Similarity** | 40% | Match to your taste profile |
| **Novelty** | 20% | How much it expands your horizons |
| **Rating** | 20% | Community and critic scores |
| **Diversity** | 20% | Variety across your final list |

You can customize these (or switch to your own weights entirely) in [AI Algorithm Settings](user-settings/ai-algorithm.md). Only the ratio between them matters — they're normalized automatically.

### Exclusions

Content is excluded if:

- You've already watched it — played, or progressed at least 5% into it
- It's in a library your admin excluded
- You've favorited it — it's still scored for transparency, but never picked (you've already found it)

How **disliked** titles are treated — excluded entirely, or penalized but allowed — is your choice in [AI Algorithm Settings](user-settings/ai-algorithm.md).

---

## Recommendations in Your Media Server

Your picks also appear as libraries in Emby/Jellyfin:

- Default names: "*YourName*'s AI Picks - Movies" and "- TV Series"
- Sorted by recommendation rank; poster overlays carry the rank badge
- You can rename them per user under [Preferences](user-settings/preferences.md) → AI Library Names

See [Virtual Libraries](virtual-libraries.md) for how these are built.

---

## Improving Recommendations

- **Rate more content** — ratings are the strongest taste signal; use the full 1–10 scale
- **Be honest about dislikes** — low ratings teach the model what to avoid
- **State your interests** — the Specific Interests card in [Watcher Identity](user-settings/watcher-identity.md) feeds picks directly
- **Tune the weights** — more similarity for comfort, more novelty for discovery
- **Check your identity** — genre and franchise weights should read like you

---

**Next:** [Top Picks](top-picks.md)
