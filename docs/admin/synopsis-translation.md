# Synopsis Translation

Machine-translates each title's plot and full synopsis, and optionally its stored film analysis, into the interface languages enabled for this instance, so a viewer reading Aperture in Greek reads the plot in Greek too. Two background jobs do the work; the detail page shows the translation, with the original one click away. Any OpenAI-compatible endpoint works, and the default is bilibili's free public Index-Translate API. This is not [Translations](translations.md), which edits Aperture's own interface text.

## Where It Lives

Admin console → **AI models** → **Synopsis translation** (`/admin/ai/synopsis-translation`). The chip reads **On**, **Off**, or **On, not ready**.

## What Viewers See

A detail page asks for the language it is displayed in. When a current translation exists, the plot and full synopsis appear translated, with **Show original** beside them; the film analysis panel does the same. With no translation for that language, the original is shown as before. A translation is used only while the text it was made from is unchanged: when the media server or an enrichment rewrites a synopsis, or an analysis is rewritten, the old translation is hidden at once and the next run translates the new text.

Only readers see translations. The assistant and recommendation explanations keep reading the original text.

## Configuration

| Field | Default | Notes |
|-------|---------|-------|
| **Translate synopses** | Off | Gates the `translate-title-synopses` job. Translations already stored are shown whether or not it is on. |
| **Model type** | Index-Translate | **Index-Translate** prompts the model exactly as Index-Translate's own client does and switches its reasoning off: use it for the free public API or a self-hosted Index-Translate (vLLM, llama.cpp, LM Studio). **Any chat model** sends a plain translation instruction, for a general chat model behind any OpenAI-compatible endpoint (LM Studio, vLLM, OpenRouter, a local Qwen). |
| **Use the free Index-Translate API** | — | Fills in the public endpoint and its model |
| **Endpoint base URL** | `https://index-translate.bilibili.com/v1` | The OpenAI-compatible root; `/v1` is added if missing |
| **API key** | — | Optional; the free API needs none. Leave blank to keep the saved key. Saving a different endpoint drops the key, so it is never sent to a server it was not entered for. |
| **Model** | `Index-Translate-35B-A3B` | The model id as the endpoint names it. The refresh button lists what the endpoint offers. |
| **Translate into** | Follow the interface languages | Every language enabled under [Language defaults](language-defaults.md), and any enabled later. Click languages to narrow the list. A language not enabled for the interface is never a target, since nobody could be shown it. |
| **Metadata is written in** | English | The language assumed for text in the Latin alphabet. See [Text in Another Alphabet](#text-in-another-alphabet). |
| **What to translate** | Both | **Plot** (the short overview) and **Full synopsis**, the latter only when it is longer than the plot |
| **Translation instructions** | — | Optional, one per line, up to 500 characters, for example "Keep character names in Latin script". For Index-Translate each line is sent as one of the constraints the model was trained to follow; for a chat model they are added to the end of the system prompt. |
| **Timeout** | 120 s (5–600) | How long the model may go **silent** (before the first word, or between words) before a request is given up. Not a limit on the whole translation, which can take minutes on a slow model. |
| **Pause between calls** | 1 s (0–120) | Be gentle with a free public service. Both jobs share this pause, so they take turns on the endpoint. |

### Film Analyses

The **Film analyses** part of the card translates each stored [title analysis](crw.md) into the same languages, with its own switch (**Translate film analyses**, off by default), its own instructions, and its own job (`translate-title-analyses`). It uses the endpoint, model, languages, timeout and pause above.

The whole analysis is sent as one request, so names and pronouns stay consistent. The translation must come back with the same number of paragraphs, because the section headings are drawn from them; if it does not, or a request is too large for the endpoint, the job retries section by section, then paragraph by paragraph.

## Testing

- **Test translation** translates a fixed sample synopsis into your first target language and reports the model and the time taken.
- **Test analysis translation** runs a three-paragraph sample through the analysis job's own path and says whether the paragraphs survived in one request or needed smaller ones.

Both are real translations made with the settings on the card, saved or not, so an endpoint can be tried before it is switched on.

## Running It

Both jobs are **manual by default**: each translation is a model call, and the default endpoint is somebody's free public service, so a schedule is something you opt into on the [Jobs](job-scheduling.md) page. Each has a per-run limit, set in its schedule:

| Job | Unit | Default per run |
|-----|------|-----------------|
| `translate-title-synopses` | Title × language pair (up to two texts each) | 300 |
| `translate-title-analyses` | Analysis × language pair | 100 |

Current recommendations are translated first. Each pair is tried once per run. A pair that fails is recorded and moved to the back of the queue, so one stubborn title cannot hold up the rest; five new failures in a row stop the run, since that usually means the endpoint itself is down. When the endpoint says it is rate-limited, the job waits and retries before counting a failure. **Stop** in the Jobs console interrupts a run even mid-request.

The card's status tables show, per language, how many movie and series pairs are pending and how many translations are stored, for synopses and analyses separately. A language you stopped translating into is marked **no longer a target**. **Clear all**, or the delete button on a language, removes stored translations; the detail pages show the original until the job runs again.

## Text in Another Alphabet

Some metadata arrives already in another language, for example a Greek plot from a Greek media-server library. The language of each text is read from its alphabet: Greek, Cyrillic, Arabic, Devanagari, Hangul, Japanese kana and Chinese characters are detected. Such a text is never "translated" into its own language, and it is translated into the **Metadata is written in** language as well, so a reader in English can read it too. Languages sharing the Latin alphabet cannot be told apart, so a French plot is treated as the configured language; the model usually translates it correctly anyway.

## Troubleshooting

| Symptom | Check |
|---------|-------|
| "Only one interface language is enabled" | Enable another under Appearance → [Language defaults](language-defaults.md); there is nothing to translate into |
| **On, not ready** | The card's warning names what is missing: an endpoint URL, a model, both texts switched off under **What to translate**, or no language to translate into |
| The same titles fail every run | Open the run in [Jobs](jobs-overview.md); the log gives each failure's reason. Failed pairs are retried last on every run. |
| The run stopped after five failures | The endpoint was unreachable or refusing requests; test it from the card |
| A detail page still shows the original | No translation exists for that page's language yet, the source text changed since it was translated, or the job has not been run |
| Analysis translations come back in pieces | The endpoint did not keep the paragraphs in one request; the job splits it up, at the cost of more requests |

---

**Related:** [Translations (interface text)](translations.md) · [Language defaults](language-defaults.md) · [Retrieval service (fastCRW)](crw.md) · [Global jobs](global-jobs.md)
