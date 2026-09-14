# Analysis Bench

Pick one title, run up to **8 models** against it side by side, and choose which model should hold the **Title Analysis** role — with the sources held constant so every difference is the model.

## Where It Lives

Admin console → **AI models** → **Analysis bench** (`/admin/ai/analysis-bench`).

## The Workflow

1. **Pick a title** — searchable (2+ characters, top matches)
2. **Pick the models** — checkboxes grouped by provider (up to 8, ordered). Cloud providers are always listed; **local providers are live-probed** for their installed models. Unconfigured or unreachable providers are shown as such
3. **Run** — the run starts in the background (**202 + run id**; the UI polls every 4 s). A local model can take **~45 minutes**; a **Stop** control cooperatively cancels

## The Control That Makes It Fair

The server **retrieves the sources once** and hands every model a **byte-identical prompt**. Differences in the outputs are attributable to the models, not to different search results. Grounding mode is **refused outright** — the bench only runs when retrieval mode is the self-hosted service ([fastCRW](crw.md)), because Gemini's native search would retrieve per-model.

The bench runs the **real generation path** (retries, pacing, contract checks) but **writes nothing to `title_analysis`** — it's a sandbox. Each model catches its own failure: results come back ok / error / unusable, never one model's failure killing the run.

## The Report

- Per-model **status chips** (success / error / unusable / pending) and a "N of M models done" progress bar
- The full comparison as **one verbatim plain-text block**, with a header stating the control conditions — sources count, retrieved characters, prompt version — and **failures printed, never omitted**
- The **full prompt** is included at the end, so you can see exactly what every model answered
- **Copy** to clipboard or **download** as `.txt`
- **Earlier comparisons** are listed (stored in their own tables) with the prompt version each answered, and are deletable
- A **signals table** above the answers, and a signals line under each one, count habits the prompt asks the model to avoid: paragraphs and the longest paragraph in sentences, pointing at "the sources", views with no holder ("is described as"), "rather than", announcing a question stays open, and paragraphs that open by restating their question. They are counts to compare, not a pass mark — each pattern also matches innocent prose

## Replaying Under a Newer Prompt

The bench compares **models** within one run. To compare **prompt versions**, open an earlier run and press **Replay under prompt vN**:

- The **same models** answer the **same source documents**, read back out of that run's stored prompt, under the prompt this build carries. **Nothing is retrieved again**, so a difference in the answers comes from the prompt, not from different pages
- The report prints this run's answers, then the earlier run's in a **BASELINE** section, and the signals table puts each model's two answers on adjacent rows
- Replaying under the **same** version is allowed and useful: it shows how much a model's answer moves between identical calls, which is what any version difference has to be larger than
- The title header (directors, ratings) is rebuilt from the library as it is now; the documents are what stay fixed

A replay needs a deployed build carrying the newer prompt. Deploying that build also retires every stored analysis written under the older version, so run the baseline benches **before** pulling the new image.

## When to Use It

Changing the Title Analysis model, evaluating a new local model, or settling "is the paid model actually better on our library?" — one real title, one real retrieval, N answers. After a prompt change, replay the benches you ran before it.

---

**Related:** [fastCRW](crw.md) · [AI providers](ai-providers.md) · [Title analysis (user doc)](../features/title-analysis.md)
