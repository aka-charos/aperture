# Retrieval Evaluation

An offline harness that measures the **retrieval half of the recommender** against a held-out slice of each viewer's history. It **reads only — it changes nothing** — and exists so embedding-model and seed-list changes can be compared instead of vibes-tested.

## Where It Lives

Admin console → **Recommendations** → **Evaluation** (`/admin/recommendations/evaluation`) — a seeds section and an archived-results section. The work itself is the manual-only **`evaluate-recommender`** job, run from **Operations → Jobs**.

## The Instrument, and Its Limits

The metrics are a **floor check, never a target**: median percentile headline, NDCG and weighted recall at cutoffs 20/100/500, per user and per history bucket, against **random** and **rating-only** baselines. Tuning the recommender *to maximise these numbers* would make it worse — the neighbour dump below is the instrument to actually judge on.

What it measures: a taste centroid from the training half of each viewer's history, the cosine-ranked library, and where the held-out titles land. Variants: **raw** and **mean-centred** embeddings, plus the two baselines — and it measures **every stored embedding set in one run**, so two models can be compared on a shared answer key.

## Seeds

The seed titles are what gets looked up in the embedding space:

- Default: each viewer's **most-watched titles** — deliberately conservative, since that's where two embedding spaces agree and differences are understated
- **Seed titles** box (one per line, prefix match, accents ignored) with **Check titles** (shows exactly what each seed matched — title + year, or "no match") and **Suggest titles** (watched titles, one per country, least-voted first — click to add)
- Saved to the instance; the page says when defaults are in use
- Movies only — the job is hardcoded to the movie space

## The Neighbour Dump

The primary instrument: for each seed, the **actual nearest neighbours** raw vs centred, with same-country share. Read this to see *what a model thinks is similar* before trusting any score.

## Archived Results

Every run is stored (the job log trims its middle, so the archive is the record): run date, **embedding set/model**, pool size, viewers qualified, seed list used — with per-run **CSV exports**:

- **Download figures (CSV)** — percentiles, NDCG/recall at all cutoffs, per variant, with provenance columns
- **Download neighbours (CSV)** — the full dump, per seed and variant

"Download everything" is the primary action because the real use is **pivoting across runs** — model vs model, seed list vs seed list. Mind the pool-size comparability warning above the table.

---

**Related:** [Embedding models](embedding-models.md) · [Algorithm tuning](algorithm-tuning.md) · [Jobs overview](jobs-overview.md)
