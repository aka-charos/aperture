# Algorithm Tuning

Configure the recommendation algorithm: weights, run size, when runs skip, and the reserved slots that guarantee certain kinds of picks.

![Admin Settings - AI Recommendations](../images/admin/admin-settings-ai-recommendations.png)

## Where It Lives

Admin console → **Recommendations** → **Algorithm & weights** (`/admin/recommendations/algorithm`) — organized as **Selection / Weights / When to regenerate / Reserved slots**, with separate **Movies** and **TV Series** cards.

## Weights

Four factors, defaults **40 / 20 / 20 / 20** for both media types:

| Weight | What it scales |
|--------|----------------|
| **Similarity** | Cosine closeness to the user's taste clusters |
| **Novelty** ("Genre Discovery") | Reward for less-watched genres around a familiar anchor |
| **Rating** | Community/critic quality signal |
| **Diversity** | Variety across the final selection (applied at selection, via MMR) |

There is deliberately **no popularity weight and no recency weight**. The recency-adjacent control is **Decade preference** (`eraWeight`), one input to the **preference nudge** (see below). The **preference strength** (default 0.5) sets how hard a user's genre and franchise affinities bend the final blend.

Users can override the four weights and their recent-watch limit in their own settings; everything on this page is admin-only.

## Selection Size

- **Recommendations per user** (`selectedCount`) — default **20** per media type (guidance: 20–30 movies, 10–15 series)
- **Candidate pool** (`maxCandidates`) — default **50,000**, the ANN retrieval pool scored per run
- **Recent watch limit** — default **200**; feeds only the evidence trail ("because you watched…"), **not ranking**

## When to Regenerate

A scheduled run **skips** a user when nothing changed:

- **New-candidate threshold** — at least 12 new movies / 6 new series since the last run
- **Max run age** — 35 days, after which a run regenerates regardless

Manual runs (per-user or the **Run** button) always execute.

## Reserved Slots

Guaranteed pick types, all spending from the same per-user budget:

| Slot | Meaning |
|------|---------|
| **Interest slots** | Titles matching the user's stated interests |
| **Taste-twin slots** | Titles a taste twin watched (with a similarity threshold) |
| **Acclaimed slots** | Critically acclaimed titles (min rating 8.3, min 50k votes) |

---

**Related:** [AI explanations](ai-explanations.md) · [Movie jobs](movie-jobs.md) · [Text generation models](text-models.md)
