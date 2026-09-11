# Embedding Models

Configure which AI model generates the vectors behind similarity, recommendations, search, and the Media Graph — and manage the vector storage that results.

![Admin Settings - AI/LLM](../images/admin/admin-settings-ai-llm.png)

## Where It Lives

- The **Embeddings** role card: Admin console → **AI models** → **Providers & roles** (`/admin/ai/roles`)
- Storage management: **AI models** → **Embeddings** (`/admin/ai/embeddings`)

## Changing Models Is Additive, Not Destructive

Point the Embeddings role at a different model and Aperture **starts a new vector set alongside the old ones** — nothing is deleted, and switching back to a previous model reuses its stored vectors. Each set shows coverage stats; old sets can be deleted individually to reclaim space.

Supported vector widths: **256, 384, 512, 768, 1024, 1536, 2560, 3072, 4096** — each with movie, series, and episode tables. Custom embedding models are supported with a manual dimension entry; the **Test** button measures the real vector width and tells you whether a matching table exists.

## The Post-Change Sequence

After switching models, run (in order, via [Jobs](jobs-overview.md)):

1. `generate-movie-embeddings`
2. `generate-series-embeddings` (embeds **series and episodes**)
3. `refresh-embedding-centering`
4. `rebuild-taste-profiles` — profiles are points in the *old* vector space until rebuilt
5. `generate-movie-recommendations` / `generate-series-recommendations`

The Embeddings page states the same sequence.

## Episode Embeddings

A toggle on the Embeddings page controls **episode-level vectors** (used by the assistant's episode search). Episodes are the largest embedding tables on a real library; the page shows storage stats, and disabling and deleting are separate actions.

## Legacy Tables

A **Legacy embeddings** section appears only when pre-multi-dimension tables exist, offering a single **"Drop Legacy Tables"** action to reclaim their space.

---

**Related:** [AI providers](ai-providers.md) · [Movie jobs](movie-jobs.md) · [Series jobs](series-jobs.md)
