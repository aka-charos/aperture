# AI Explanations

Configure whether AI-generated explanations appear with recommendations.

## Where It Lives

Admin console → **Recommendations** → **Explanations** (`/admin/recommendations/explanations`).

## The Two Switches

| Switch | Effect |
|--------|--------|
| **Include AI Explanations** | The global default: each recommended title gets a "Why *Aperture* picked this for you" note in the detail page's insights panel. With legacy library output on, it is also written at the top of the title's description in the generated libraries (the NFO `<plot>`, with a credit line). Turning it off also skips the model call that writes them |
| **Allow Per-User Overrides** | Grants users the right to choose their own preference in User Settings |

## The Three-Tier Chain

The effective setting for a user resolves as: **global default → your per-user grant → the user's own choice**.

- Grant the override permission in the **AI Override** column of the [Users](user-permissions.md) page or on the user's detail page; without it, the user sees the effective value and can't change it
- With the permission granted, the user's pick (**Explain each pick**, on the Recommendations tab of their settings; see [Recommendations settings](../features/user-settings/recommendations.md#your-picks)) wins

## What Explanations Cost and When They Appear

Explanations are generated in batches of 10 during `generate-movie/series-recommendations`, by the [Text Generation](text-models.md) role. Two operational facts matter:

- **Changes apply from the next run onward** — the UI says so, and it means it
- **Turning the setting back on does not backfill** — runs generated while explanations were off keep empty explanation fields forever; use the manual **`refresh-recommendation-explanations`** job (cancellable) to write them for the newest completed run without re-scoring

## Checking What They Say

An explanation is written from the pick's own data and the titles in the user's history closest to it. When a [decision model](decision-model.md) is configured, it decides whether those titles are presented as the reason or only as context, and the writer is told which. The same card can check the finished explanations for unsupported claims, invented facts and spoilers (`check-recommendation-explanations`); that check changes nothing viewers see.

---

**Related:** [Decision model](decision-model.md) · [Text generation models](text-models.md) · [Algorithm tuning](algorithm-tuning.md) · [User management](user-management.md)
