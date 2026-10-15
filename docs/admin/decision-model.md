# Decision Model

An optional second opinion on why a title was recommended. Under each recommendation, the insights panel shows the watched titles closest to it, headed either **Why We Think You'll Like This** or, when they are only nearby, **Closest Titles in Your Library**. Without a decision model that choice is made from embedding similarity alone. With one, a small yes/no model is asked whether each of those titles is a real reason for the pick (the same director or creator, the same franchise, a shared subject, situation, tone or style), and its answer decides the heading and what the explanation writer is told. Nothing depends on it: when it is off, unreachable or slow, the similarity threshold decides exactly as before.

## Where It Lives

Admin console → **AI models** → **Decision model** (`/admin/ai/decision-model`). The chip reads **On**, **Off**, or **Not ready** (switched on but missing something; a warning says what).

## What It Is

A decision model answers typed yes/no questions with a probability and writes no text. Any model served through the TypeSafe System One API works, for example the Jev or Kev models on OpenRouter, or a server you run yourself such as Ollaya. It is an integration rather than an AI role, so it does not appear on the AI roles page.

## Configuration

| Field | Default | Notes |
|-------|---------|-------|
| **Judge recommendation evidence with a decision model** | Off | The main switch. Affects the evidence heading and the explanations written from it. |
| **Also weed the title-analysis retrieval** | Off | A second, separate use, only available while the main switch is on. See [Weeding Title-Analysis Sources](#weeding-title-analysis-sources). |
| **Where to send it** | OpenRouter | **OpenRouter** uses the OpenRouter API key already set on an AI role, and its calls appear on the [Spend](ai-spend.md) page. **Self-hosted** sends to your own server, costs nothing and is not metered. |
| **Server URL** | — | Self-hosted only. The server root, for example `http://host.docker.internal:11435`; `/v1/systemone` is added for you. |
| **API key** | — | Self-hosted only, and only if the server asks for one. Leave blank to keep the saved key. |
| **Model** | — | Pick from the list or type an id. Use a **versioned** id such as `typesafe/jev-1.13`, never an alias, so verdicts from two models are never mixed. The list loads with the page for OpenRouter; for a self-hosted server, press the refresh button after entering its URL. |
| **Timeout per call** | 20 s (2–120) | A slow answer counts as no answer, and that pick keeps the similarity threshold |
| **Calls at once** | 4 (1–16) | A recommendation run asks once per recommendation, a few dozen calls at most |

## Testing

- **Test** sends two fixed pairs through the model: *Dune* as the reason for *Dune: Part Two*, and *Thirteen Lives* as the reason for *Dune: Part Two*. It passes only if the model tells them apart; a model that answers about 50% to everything "works" and is not worth using. With **Also weed the title-analysis retrieval** on, it also sends the source filter's real request, as large as your retrieval settings allow, and reports whether the model separated a review from a podcast note and answered every document.
- **Benchmark** runs labelled pairs through three judges on your own library: the similarity threshold, a free rule (same director or same franchise counts as a reason), and the model. The pairs are a built-in reference set plus every pair you label below, each asked twice. It reports how often each judge was right, and separately on the pairs that share no director or franchise, which are the only ones where the model can earn more than the free rule. It stores nothing and takes up to 45 seconds.

Both use the settings on the card whether or not they are saved.

## Applying It

Verdicts are written as recommendations are generated. To apply them to the recommendations people already have without re-scoring anything, run **Refresh recommendation explanations** (`refresh-recommendation-explanations`, the **Open in Jobs** button). That job skips viewers with AI explanations switched off; they get verdicts at their next regular run.

Picks from reserved slots (taste twin, interest, acclaimed) are never judged, because their heading never depends on the evidence. A pick uses the model's verdicts only when every one of its evidence titles has one; otherwise the threshold decides.

If the model refuses the key or the model id (401, 402, 403 or 404), a run stops asking it at once; after three failures in a row it stops too. Either way the remaining picks fall back to the threshold, and nothing fails.

## Reading the Results

**Verdicts compared with the similarity threshold** counts, on each viewer's newest recommendations, how often the model agreed with the threshold, called something a reason that the threshold did not, and rejected one the threshold accepted. If the stored verdicts come from more than one model, a warning says so: the counts then pool two models and measure neither.

**Clear stored verdicts** puts every heading back on the similarity threshold. Turning the switch off only stops new verdicts; the ones already stored stay with their recommendations until those are regenerated or cleared, because the explanations were written to match them. Clear before comparing a second model, then run the refresh job.

### Label the Disagreements

Once any verdict is stored, the card lists every pair where the threshold, the free rule and the model do not all agree, one watched title offered as the reason for one recommendation. Mark each **Reason**, **Not a reason** or **Arguable**. What each judge said is shown only after you answer, and the list is in a fixed shuffled order, so nothing sways the label. Labels are kept per pair across runs and survive clearing the verdicts, and **Benchmark** asks the model about them again. Because these pairs were chosen for being disagreements, the tally compares the judges with each other; it is not an accuracy rate.

## Checking the Written Explanations

The verdicts decide what the explanation writer is told; this checks what it then wrote. **Check explanations now** runs `check-recommendation-explanations`, which asks the model four questions about each explanation on the current recommendations:

| Check | Flags an explanation that… |
|-------|----------------------------|
| Context title claimed as the reason | Presents a nearby-only title as the reason for the pick |
| Link not supported by the data | Claims a connection the data does not show |
| Fact not in the data | States a fact about the title it was not given |
| Spoiler | Gives the ending away |

It changes nothing viewers see, runs whether or not evidence judging is switched on, and skips explanations already checked with the same model. Accept, reject or mark unsure the explanations listed below it (the checks stay hidden until you answer) to see whether its flags can be trusted: flagging what you rejected is the point, flagging what you accepted is a false alarm.

## Weeding Title-Analysis Sources

With **Also weed the title-analysis retrieval** on, before each [title analysis](crw.md) is written the model is asked which of the retrieved pages carry writing about the title, and the ones that carry none are dropped: a promo for a video or podcast, a forum thread, a listings page. It runs after every free filter, as one call per title, and errs toward keeping:

- a page goes only if the model is at most 25% sure it is worth reading;
- it never leaves fewer than 4 pages, or too few substantial ones to write from;
- a page it could not judge is kept, and if the call fails everything is kept.

This is a different bill from the evidence heading: that asks a few dozen questions per recommendation run, this asks one question per retrieved page for every title analysed. Every page's score, kept and dropped alike, is written to the API's log for each title, and to the [Analysis bench](analysis-bench.md) report for a bench run.

## Troubleshooting

| Symptom | Check |
|---------|-------|
| **Not ready**: "No OpenRouter API key is configured" | Add an OpenRouter key to any AI role on the [AI roles](ai-providers.md) page, or switch to a self-hosted server |
| **Not ready**: "No model is selected" | Enter a model id |
| Test warns the model "did not tell a sequel from an unrelated film" | The model answers but does not discriminate; its verdicts are unlikely to beat the threshold. Try another model. |
| The source filter test fails but the main test passes | The filter's request is larger (one question per document). The model's context may be too small for your retrieval settings; lower the results per title on [fastCRW](crw.md) or use a model with a larger context. |
| "Could not read a model list" | Type the model id instead; the list is a convenience |
| Headings did not change after switching on | Existing recommendations keep their headings until a run or the refresh job writes verdicts for them |

---

**Related:** [AI explanations](ai-explanations.md) · [Algorithm tuning](algorithm-tuning.md) · [AI spend](ai-spend.md) · [Retrieval service (fastCRW)](crw.md)
