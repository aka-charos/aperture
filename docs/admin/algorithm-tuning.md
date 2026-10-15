# Algorithm Tuning

Configure the recommendation algorithm: weights, run size, when runs skip, and the reserved slots that guarantee certain kinds of picks.

## Where It Lives

Admin console → **Recommendations** → **Algorithm & weights** (`/admin/recommendations/algorithm`) — organized as **Selection / Weights / When to regenerate / Reserved slots**, with separate **Movies** and **TV Series** cards.

## Weights

Four factors, defaults **40 / 20 / 20 / 20** for both media types:

| Weight | What it scales |
|--------|----------------|
| **Similarity** | Closeness to the user's taste profile |
| **Genre Discovery** (novelty) | Reward for less-watched genres around a familiar anchor |
| **Rating** | Community/critic quality signal |
| **Diversity** | Variety across the final selection (applied at selection, via MMR, never to the score) |

The first three are blended by their **shares**, so they do not have to add up to 100%; 0.4/0.2/0.2 and 0.8/0.4/0.4 are the same blend. The chip beside them shows those shares. Diversity is separate because it only shapes which of the scored titles are picked.

There is deliberately **no popularity weight and no recency weight**. Two further controls bend the final score:

- **Preference nudge** (default 0.5, Off = 0): how far a user's franchise, genre and stated-interest affinities move a title's score toward the top
- **Decade preference** (default Off): favours the decades a user watches more than the library would predict

Users can turn on their own weights and watch history depth in their settings; everything else on this page is admin-only.

## Selection Size

- **Recs Per User** (`selectedCount`) — default **20** per media type (guidance: 20–30 movies, 10–15 series). Reserved slots come out of this number, not on top of it
- **Max Candidates** (`maxCandidates`) — how many titles retrieval returns for scoring; the slider tops out at your library size, which is the most that can ever be scored
- **Watch History Depth** — default **200**; builds a stand-in taste profile for a user who has no taste profile yet. Ranking does not use it, and neither does the evidence under each pick, which searches up to 5,000 titles of the user's history

## When to Regenerate

A **scheduled** run skips a user when nothing changed:

- **New titles before regenerating** — at least 12 new movies / 6 new series since the last run
- **Maximum days between runs** — 35 days, after which a run regenerates regardless

A new watch or rating, a change to the user's own preferences or taste profile, and a change to a scoring setting on this page each count as a change too. Manual runs (per-user, or **Run** in Jobs) always execute. Changing only these two thresholds does not by itself regenerate anyone.

## Reserved Slots

Guaranteed pick types, all spending from the same per-user budget; the card shows how the budget splits, and each slider's maximum is what the others leave:

| Slot | Default | Meaning |
|------|---------|---------|
| **Reserved for stated interests** | 3 | Titles matching interests the user wrote in their settings |
| **Borrowed from a taste twin** | 4 | Titles watched by a viewer whose history overlaps the user's far more than chance. **How close a match must be** sets the bar (higher is stricter) |
| **Reserved for acclaimed titles** | 0 (off) | Widely acclaimed titles the user would otherwise not be shown: rating at least 8.3 from at least 50,000 votes, both editable |

A reserved pick is still ordered by the user's own scores, so each user gets different ones. Its explanation and its insights panel say which slot it came from. A taste twin is never named, except to a user connected to them.

Changes apply to the next run. To apply them to everyone now, run the recommendation jobs from [Jobs](movie-jobs.md).

---

**Related:** [AI explanations](ai-explanations.md) · [Decision model](decision-model.md) · [Movie jobs](movie-jobs.md) · [Text generation models](text-models.md)
