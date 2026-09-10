# AI Algorithm

The **AI Algorithm** tab lets you retune how recommendations are scored for your account — the four weights, how watched content is treated, and what happens to titles you disliked.

![User Settings - AI Algorithm](../../images/user-settings/user-settings-ai-algorithm.png)

## Accessing

Click your **avatar** in the top bar and pick **AI Algorithm**.

---

## Custom Algorithm Weights

The **master toggle** at the top decides whose weights run:

- **Off** — recommendations use the admin-configured server defaults (the sliders don't render)
- **On** — *Using Custom Weights*; your sliders take over

With the toggle on, the tab splits into **Movies** and **TV Series** sub-tabs — weights are per media type.

## The Four Weights

| Weight | Default | What it does |
|--------|---------|--------------|
| **Similarity** | 40% | How strongly to favour titles close to your taste profile — usually the one to keep highest |
| **Genre Discovery** | 20% | Rewards a familiar anchor plus a genre you rarely watch — partly new, not as strange as possible |
| **Community Rating** | 20% | How much to favour highly-rated titles. This score never changes, so a high value makes your list repeat itself |
| **Diversity** | 20% | How hard to push for variety across genres in the final list |

- Sliders run 0–1 in 0.05 steps, shown as percentages
- **Only the ratio between them matters** — they're normalised automatically, so they don't need to sum to 100%
- **Changes save automatically** and take effect when your recommendations are next [regenerated](../recommendations.md)
- **Reset to Defaults** returns everything to the admin's values

### When to Adjust What

| You want | Touch |
|----------|-------|
| Comfortable, "more like what I love" picks | **Similarity** up |
| To break out of a genre rut | **Genre Discovery** up, **Similarity** down a step |
| Prestige-heavy lists | **Community Rating** up — accepting repetition, since well-rated titles don't change |
| A list that isn't five thrillers in a row | **Diversity** up |
| Fewer "critically acclaimed but joyless" picks | **Community Rating** down |

One weight at a time: regenerate, look at the list, then decide.

## Recent Watch History Limit

A slider (10–200 items) controlling how much recent history feeds the *"because you watched…"* note on each pick. Your taste profile always reads your full history — this does **not** change what gets recommended.

## Include Watched Content

| Setting | Effect |
|---------|--------|
| **New Content Only** | Only titles you haven't fully watched or started (5%+ progress) |
| **Include Watched** | Recommendations may include things you've already seen |

Use **Include Watched** deliberately — e.g. to have a series you're partway through surface with the next season's context, or when you re-watch favourites and want them ranked. Anything you've *finished* still tends to sink: the taste profile already knows it.

## Disliked Content Handling

What to do with titles you rated 1–3:

| Option | Effect |
|--------|--------|
| **Exclude Completely** (recommended) | Disliked content never appears in recommendations |
| **Penalize But Allow** | It may still appear if it strongly matches other preferences |

Choose **Penalize** when a low rating meant "not for me" rather than "this is bad" — a 2-rated slasher can still be the right pick alongside a horror-heavy brief. Beneath the choice, **Your Disliked Content** lists everything you've rated 1–3, split into Movies and TV Series. Each entry can be re-rated (adjust the stars) or cleared (✕ returns it to the unrated pool) — useful when a rating was a mistake rather than a verdict.

---

## Tips

- **Start small** — nudge one weight, regenerate, and see the difference before touching the rest
- **Similarity up** for comfort viewing; **Genre Discovery up** to break out of a rut
- **Community Rating up** risks repetition by design — it can only favour what's already well-rated

---

**Next:** [Watcher Identity](watcher-identity.md)
