# AI Explanations

Configure whether AI-generated explanations appear with recommendations.

![Admin Settings - AI Recommendations](../images/admin/admin-settings-ai-recommendations.png)

## Where It Lives

Admin console → **Recommendations** → **Explanations** (`/admin/recommendations/explanations`).

## The Two Switches

| Switch | Effect |
|--------|--------|
| **Include AI Explanations** | The global default: each recommended title gets a "Why *Aperture* picked this for you" note — in the detail page's insights panel, on your media server, and in the NFO credit line |
| **Allow Per-User Overrides** | Grants users the right to choose their own preference in User Settings |

## The Three-Tier Chain

The effective setting for a user resolves as: **global default → your per-user grant → the user's own choice**.

- Grant the override permission on a user's [detail page](user-management.md); without it, the user sees the effective value and can't change it
- With the permission granted, the user's pick in [Preferences](../features/user-settings/preferences.md) wins

## What Explanations Cost and When They Appear

Explanations are generated in batches of 10 during `generate-movie/series-recommendations`, by the [Text Generation](text-models.md) role. Two operational facts matter:

- **Changes apply from the next run onward** — the UI says so, and it means it
- **Turning the setting back on does not backfill** — runs generated while explanations were off keep empty explanation fields forever; use the manual **`refresh-recommendation-explanations`** job (cancellable) to write them for the newest completed run without re-scoring

---

**Related:** [Text generation models](text-models.md) · [Algorithm tuning](algorithm-tuning.md) · [User management](user-management.md)
