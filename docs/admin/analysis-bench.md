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
- A **signals table** above the answers, and a signals line under each one, count habits the prompt asks the model to avoid (see [The Signals](#the-signals))
- When the [decision model's source filter](decision-model.md#weeding-title-analysis-sources) is on, the report prints its score for every retrieved page, worst first, and which pages it dropped, with their addresses
- Retrieval now **drops bot-check and access-wall pages** (Cloudflare challenges, "Access restricted") before they reach the prompt, so they no longer appear in the sources list or take a share of the budget. A page with the same specific title as one already kept (one book chapter fetched from two sites) is dropped too; a title that is little more than the film's name never counts as a match

### The Signals

| Column | Counts |
|--------|--------|
| **words**, **paras** | Length, marked "!" when over what that prompt version allows (a word count a little over is tolerated where the prompt says so) |
| **longest**, **longest-w** | The longest paragraph, in sentences and in words |
| **sources** | Pointing at the documents ("the sources say") instead of stating a fact |
| **named** | Critics and publications named, read from this run's own documents and printed beside the count |
| **labels** | A section label such as `[tradition]` left in the prose |
| **split** | One question's answer scattered over paragraphs that are not next to each other |
| **unattrib** | A view with no holder ("is described as", "is said to") |
| **rather**, **open**, **echoes** | "Rather than"; announcing that a question stays open; a paragraph opening by restating its question |
| **twice** | A phrase told under two different questions, printed so you can check it |
| **spill**, **praise** | Critics and viewers, and quality words, outside the Critical Reception section |
| **awards**, **semi** | Awards named; semicolons |
| **rec/work** | Words in Critical Reception against words in Form and Style, "!" when reception runs longer |
| **t/w/c/r** | Paragraphs given to Context, Form and Style, Making and Critical Reception, "!" when one is over its share |

The columns that read the model's own section labels show a dash rather than a zero when those labels could not be read, and the answer says why under its stat line: **map: none written**, or **map not read:** followed by what the model wrote. An answer the contract checks rejected is marked **[UNUSABLE]** even when it has prose. These are counts to compare, not a pass mark: each pattern also matches innocent prose, and zero is not clean — an opinion stated as a plain fact, with no critic named and no hedge, matches nothing and has to be read.

## Comparing Prompt Versions

Under the model list, **Prompt versions** lists every version this build carries (currently v7 to v18, where v18 is current and v10 was a draft that never went live), with the current one ticked. Tick more than one and every ticked model answers every ticked version.

**Variants** would be listed under them: a different set of questions and rules for the **same** version, for a model that cannot hold that version's own rules. This build carries none (the `compact` variant was folded into version 16), so the list is empty. Bench rows stored with one still read as, for example, `v15 compact`.

When a **draft** of the next version exists it is listed as **draft — bench only**. Only the bench can run it: the library keeps writing with the current version until the draft is promoted in a later release. This build has no draft.

A new prompt version does not by itself rewrite the library. Stored analyses are rewritten only when they are older than the oldest version still considered usable (currently v17), so a v17 analysis stays as it is under v18.

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
