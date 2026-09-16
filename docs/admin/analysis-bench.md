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
- A **signals table** above the answers, and a signals line under each one, count habits the prompt asks the model to avoid: paragraphs and the longest paragraph in sentences, pointing at "the sources", views with no holder ("is described as"), "rather than", announcing a question stays open, paragraphs that open by restating their question, and **told twice** — phrases that appear under two different questions, printed so you can check them (names and genre words are ignored, since a person or a genre mentioned twice is not a repeated fact), and **spill** — how often a critic, scholar, reviewer or viewer is mentioned outside the Critical Reception section, where the prompt keeps them, **semi** — semicolons, which the prompt forbids — and **rec/work** — words in Critical Reception against words in Form and Style, marked "!" when reception runs longer, which the prompt also forbids. Told twice, spill and rec/work read the model's own section labels, so an answer whose labels could not be read shows a dash there rather than a zero. They are counts to compare, not a pass mark — each pattern also matches innocent prose. And zero is not clean: an opinion stated as a plain fact, with no critic named and no hedge, matches nothing here and has to be read
- Retrieval now **drops bot-check and access-wall pages** (Cloudflare challenges, "Access restricted") before they reach the prompt, so they no longer appear in the sources list or take a share of the budget. A page with the same specific title as one already kept (one book chapter fetched from two sites) is dropped too; a title that is little more than the film's name never counts as a match

## Comparing Prompt Versions

Under the model list, **Prompt versions** lists every version this build carries (currently v7 to v14, where v14 is current and v10 was a draft that never went live), with the current one ticked. Tick more than one and every ticked model answers every ticked version.

A version marked **draft — bench only** is the next prompt being tested. Only the bench can run it: the library keeps writing with the current version, and no stored analysis is retired until the draft is promoted in a later release. Bench the draft against the current version on several titles and models first — that is what it is for.

- The sources are **retrieved once** and every version's prompt is built from them, so the prompts are identical down to the TASK line and differ only in their questions and rules. A difference between two answers from one model is therefore the prompt
- The report groups each model's answers together, labels each one with its version (`deepseek-v4.1-flash · v8`, `· v9`), and puts them on adjacent rows of the signals table
- The prompt section prints the newest version in full and each older version from its TASK line, so the documents are not repeated
- The Run button counts answers: two models under two versions is four model calls
- Nothing about the library changes — analyses are always written with the current version

## Replaying an Earlier Run

For a run you already have, open it and press **Replay** — it reruns that run's models on its stored source documents under the prompt versions ticked above. **Nothing is retrieved again**. The report prints the new answers, then the earlier run's in a **BASELINE** section, paired by model in the signals table. Replaying under the **same** version shows how much a model's answer moves between identical calls, which is what any version difference has to be larger than. The title header (directors, ratings) is rebuilt from the library as it is now; the documents stay fixed.

## When to Use It

Changing the Title Analysis model, evaluating a new local model, or settling "is the paid model actually better on our library?" — one real title, one real retrieval, N answers. After a prompt change, replay the benches you ran before it.

---

**Related:** [fastCRW](crw.md) · [AI providers](ai-providers.md) · [Title analysis (user doc)](../features/title-analysis.md)
