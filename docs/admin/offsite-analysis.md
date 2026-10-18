# Offsite Analysis

Write film analyses with a model on **another machine**: Aperture prepares the prompts, you run them somewhere faster (LM Studio on a laptop, for example), and the answers come back as an import.

## Where It Lives

Admin console → **AI models** → **Offsite analysis** (`/admin/ai/offsite-analysis`).

## How It Works

Writing an analysis has two halves. **Retrieval** (searching and fetching the sources) needs this server and the [fastCRW](crw.md) service. The **model call** does not, so it can run anywhere.

1. **Prepare a batch** here. Aperture picks the next pending titles in the same order the **Generate Title Analysis** job uses (current recommendations first), fetches each title's sources and builds its prompt, exactly as the job would. This takes about a minute per title, in the background.
2. **Download** the batch file and the **runner script**, and run them on the other machine.
3. **Import** the results file. Each answer goes through the same checks as an analysis written here: the output format, the paragraph map, and the source floor that decides between storing it and storing a decline.

Only one batch is prepared at a time, and a batch holds up to 500 titles. Grounding mode is refused, as on the [Analysis bench](analysis-bench.md): there the model searches for itself, so there is no prompt to send anywhere.

## Titles Are Held While a Batch Is Out

While a batch is **open**, its unanswered titles are skipped by the Generate Title Analysis job and by the next batch, so nothing is paid for twice. A batch stays open for **14 days**, until you press **Release titles**, or until you delete it.

Released or expired batches can still be imported. If a title was analysed another way after the batch was made (by the job, or by someone pressing Analyse on its page), the newer analysis stays and the import reports it as **Already analysed another way**.

## Running It on a Mac With LM Studio

1. Install Node.js 18 or newer: `brew install node`.
2. In LM Studio, load the model with a **context length of at least 32,768**. A prompt is about 20,000 tokens, and LM Studio's default context is much smaller. From a terminal: `lms load <model> --context-length 32768`.
3. Start LM Studio's local server (**Developer** tab → **Start server**, port 1234).
4. Put the batch file and `run-offsite-analysis.mjs` in one folder and run:

   ```
   node run-offsite-analysis.mjs aperture-analysis-xxxxxxxx.jsonl --model <model id>
   ```

   Leave out `--model` to see the models the server lists. Add `--limit 2` for a quick test before committing to the whole batch.

5. Upload the `.results.jsonl` file the runner wrote (next to the batch file) on the Offsite analysis page.

### Runner options

| Option | Default | What it does |
|--------|---------|--------------|
| `--model <id>` | (required) | The model, as the server lists it |
| `--out <file>` | `<batch>.results.jsonl` | Where answers are written |
| `--base-url <url>` | `http://localhost:1234/v1` | Any OpenAI-compatible server |
| `--api-key <key>` | none | Sent as a Bearer token |
| `--concurrency <n>` | 1 | Requests at a time. One GPU usually does best with 1 |
| `--limit <n>` | all | Run only the first n unanswered titles |
| `--stall-seconds <n>` | 600 | Give up on a request after this long with no data |
| `--max-tokens <n\|none>` | the batch's | Override the output ceiling |
| `--temperature <n\|none>` | the batch's | Override the temperature |

The batch carries the **Title Analysis** role's output ceiling and sampling settings, so the other machine runs under the same limits as a run here.

### Stopping and resuming

Every answer is written the moment its title finishes. Press Ctrl+C at any time: only the title in progress is lost. Run the same command again and it skips titles the results file already answers, and retries any that failed. You can also import a partial results file and keep going.

Requests are **streamed**, so a slow model is never cut off by a timeout on the request as a whole; the runner only gives up on a server that sends nothing at all for `--stall-seconds`.

## What the Import Reports

| Outcome | Meaning |
|---------|---------|
| **Stored** | The analysis is in the library |
| **Declined (sources too thin)** | Read fine, and the source floor declined it, exactly as a run here would |
| **Rejected** | The answer broke the output format (no paragraph map, cut off at the ceiling, a preamble instead of an answer). The title stays in the batch: download it again and rerun it, perhaps with another model or a larger context |
| **Failed on the other machine** | The runner wrote an error instead of an answer. It stays in the batch, and a rerun retries it |
| **Already analysed another way** | Something else analysed the title after the batch was made |
| **Already imported** | That answer was imported before |
| **Prompt version too old** | The batch was built under a prompt older than the one the library still accepts |

A normal run retries a model that breaks the format and then falls back to the next model. Offsite there is nobody to ask, so a rejected answer is reported and left for you to run again.

## The Files

**The batch file** is JSON Lines, one title per line:

```json
{"custom_id":"…","format":"aperture-analysis-offsite/1","media_type":"movie","title":"Suspiria","year":1977,"prompt_version":18,"prompt_variant":null,"max_tokens":8000,"temperature":null,"top_p":null,"prompt":"…"}
```

**The results file** is one line per title:

```json
{"custom_id":"…","model":"qwen3-30b-a3b","text":"…the model's raw reply…","finish_reason":"stop","usage":{"completion_tokens":1290},"elapsed_ms":84210}
```

or `{"custom_id":"…","error":"…"}` when no answer came back. `text` is the raw reply, reasoning blocks included: Aperture strips them on import. Any tool can write this file; the runner is just the easy way.
