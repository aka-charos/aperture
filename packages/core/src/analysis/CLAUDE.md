# Title analysis: writer, retrieval, prompt versions, bench

Loaded when working in `analysis/`. Terse rules; evidence in [F-064](../../../../docs/aperture-forensics.md#f-064), [F-116](../../../../docs/aperture-forensics.md#f-116), [F-117](../../../../docs/aperture-forensics.md#f-117), [F-122](../../../../docs/aperture-forensics.md#f-122), [F-124](../../../../docs/aperture-forensics.md#f-124), [F-143](../../../../docs/aperture-forensics.md#f-143), [F-147](../../../../docs/aperture-forensics.md#f-147), [F-168](../../../../docs/aperture-forensics.md#f-168). Read the F-entry before reverting or arguing with a rule. The long-form wording these rules were compressed from is in `git show 65962deb:CLAUDE.md`.

## Writer (`generate.ts`, `mode.ts`, `structure.ts`)

- Title-scoped: one analysis per title in `title_analysis`, shared by every user (explanations are user-scoped; never merge them).
- Source mode (`mode.ts`): `crw` (default; fastCRW `/v1/search` + `scrapeOptions` BEFORE the model, the `titleAnalysis` role writes) or `grounding` (Gemini searches itself; Google-only, per-project quota). `checkModeReadiness` runs inside `analyseTitle` (the choke point) and as job pre-flight. `title_analysis.retrieval_mode` records which.
- Prompt order: subject → documents → task/rules (retrieved markdown is untrusted). Ask questions, never "analyse this film".
- `analyseTitle` throws on anything possibly systemic (zero results; zero chunks in grounding) and stores only a decline it believes. The job tries each row at most once per run; `CONSECUTIVE_FAILURE_LIMIT` (5) aborts a failure storm.
- Answer fenced at both ends (`ANALYSIS_BEGIN_MARKER`); a missing marker or grade, or `finishReason === 'length'`, throws (a fact about the model, not the title).
- A usable paragraph map is part of the contract (`structure.ts`, pure, pinned): none, < 2/3 labelled, or one question over everything → retryable failure. Not required under three paragraphs. `WriteOptions.mediaType` required. `MAX_PARAGRAPHS` (30) is checked first and rotates (gross overrun = broken generation, `finishReason` still `stop`).
- A question's answer must be one findable CONTIGUOUS run: the panel heads each run, `grounding.ts` selects by label, the assistant gates by label.
- `analysisMaxOutputTokens` default 8000, 0 = no ceiling. Length is shaped in the prompt; `max_tokens` is never the lever (`findResponseProblem` rejects a truncated answer and throws).
- `POST …?force=true` (route) is admin-only and the only way to rewrite a declined row.
- Timing has two columns (`0217`, rules in `timing.ts`, pure): `retrieval_ms` = the fetching; `write_ms` = the model, retries and fallback models included, pacing waits excluded (`WriteOptions.onPaced`). Never one mixed total: only writing compares models, and an offsite import has only writing (the runner's `elapsed_ms`; retrieval NULL, as in grounding mode). NULL = not measured. A database behind the image loses the figures, not the row (`withAnalysisTiming`). The one write statement is `titleAnalysisUpsertSql` (`storeSql.ts`, pure, pinned).

## Retrieval (`retrieveSources` in `generate.ts`)

Order: general + curated search → `dropLowValueSources` → `cleanSources` (so `isOffTopic` counts on uncleaned text) → `filterSourcesByJudgment` (decision model, last) → `budgetSources`.

- Query carries BOTH names bare: `buildAnalysisQuery` appends `original_title` when `distinctOriginalTitle`; never quoted or OR-joined. The prompt header states both names too.
- Engines: `CrwConfig.searchEngines` is a cascade, one request each; `sanitizeSearchEngines` never returns empty (empty = CRW uses Google alone).
- Per-page budget `CrwConfig.pageTimeoutMs` → `scrapeOptions.timeout` (default 45s, CRW max 60s). The settings route refuses `timeoutMs < pageTimeoutMs + SEARCH_LEG_ALLOWANCE_MS`; `effectivePageTimeoutMs` shrinks a stored old pair (never below 15s).
- Curated criticism search (`curatedSearch.ts`, pure, pinned): base query + `site:` disjunction, split into queries ≤ `CURATED_QUERY_MAX_CHARS` (an over-long query returns an EMPTY result, not an error). No review-keyword AND block (`isOffTopic` tests pages instead). `distributeCuratedResults` splits `curatedMaxResults` exactly (never `ceil`). Each query logged at info with length, allowance, results.
- Curated search is purely ADDITIVE: the general search keeps all `maxResults`; criticism is appended. `CrwConfig.curatedMaxResults` is its own setting (default 4, 0 = off). The prompt is bounded by `sourceBudgetChars` (water-filled); the extra cost is scraping.
- Curated search uses one engine, no cascade, started BESIDE the general search. `criticismNeedsRerun` re-asks the answering engine when the first was walled AND empty. Queries run concurrently; one throwing costs only itself. Its outcome is never recorded against engine health. Criticism is ordered first (`dropDuplicateTitles` keeps the first). Fails open. `AnalysisSource.curated` is only ever true; the bench marks `[criticism]`.
- `blockedPage.ts`: drop only short (≤2000) AND wall phrase; every page walled ⇒ throw (scraper refused, not a title fact).
- `sourceQuality.ts`: domain list = pages a person read; no-sentence page dropped (one sentence keeps it); <3 prose lines + 20+ standalone links dropped; count LINES, never link density (Wikipedia is >50% link chars); `isProseLine` excludes headings and link-only lines; `isLinkOnlyLine` strips `[`/`]`; `MIN_USEFUL_CHARS` names empty fetches; `isOffTopic` = mentions per `CHARS_PER_TITLE_MENTION`, includes the original title, skips titles <5 letters, runs last. Fails open: never drop everything. Shapes, not hosts (no `reddit.com` entry).
- `sourceCleanup.ts`: strip markup before line tests (`stripImages`, `stripEmptyLinks`, `stripCountLinks` (keeps the line), `stripSolicitationLines` on VISIBLE text, every pattern naming its object, `BARE_FURNITURE`); menu = run measured in links, filler bridges, a sentence never, cut only to the last link; partly-link lines count via `menuLinkCount`; plot strip only `Plot`/`Synopsis`/`Storyline`; `FURNITURE_HEADING` excludes Audience/User Reviews; widget line = no sentence + ≥3 run-together words. Never empties a document.
- `duplicateSources.ts`: title key needs ≥20 letters after removing film names/year; `keepOnePerDomain` = host minus `www`.
- `AnalysisSource.fetchedChars`/`strippedChars` reach the retrieval log and the report: whether a slot went on an article or a menu.
- Thin retrieval makes the model COPY ⇒ answer is more retrieval, never declining; `MIN_SUBSTANTIVE_SOURCES` (2) deliberately low.
- Don't trade document count for smaller slices: the model's material sits mid-document, so shorter slices cut what it uses.
- Measuring retrieval→output derivation: word containment / longest shared word-run. Never IDF (it scores the writer's own paraphrase words as signal).

## Source weeding by the decision model (`sourceJudgment.ts` pure, `judgeSources.ts` calls)

- `DecisionModelConfig.filterAnalysisSources` is its own switch under `enabled`, default off. One System One request per title, one `noul` per document.
- Runs LAST, after every free filter and after `sourceCleanup.ts`: never pay for a document a free test drops.
- Drop bar `SOURCE_DROP_AT_OR_BELOW` (0.25, a confident no). Worst-first; survivors keep relevance order.
- Two floors: `MIN_SOURCES_AFTER_JUDGMENT` (4) on count, `MIN_SUBSTANTIVE_AFTER_JUDGMENT` per drop (below it `decideAnalysisFloor` stores a permanent decline). A barred document `continue`s, never `break`s.
- Unanswered documents kept; partial answers honoured. Never throws; fails open.
- Criteria: an aggregator blurb page and an encyclopedia's production/reception sections count as substance. The question asks the MEDIUM (is the substance text on the page, or audio/video/a link), not the source. A statement of standing with nobody behind it is noise. No separate precedence line.
- Request sizing: `SOURCE_SAMPLE_CHARS` (1200) ceiling; `sampleCharsFor` water-fills `SOURCE_JUDGMENT_EXCERPT_BUDGET` down to `MIN_SOURCE_SAMPLE_CHARS`. `MAX_RESULTS`/`MAX_CURATED_RESULTS` live in `lib/crw.ts`; `sourceJudgment.test.ts` asserts budget/floor ≥ their sum.
- `judgmentExcerpt` = head + middle window (60/40); whole doc under 2× the sample; slices under `MIN_SAMPLE_SLICE_CHARS` → contiguous; the jump is described in the question. Changing what the judge sees moves every score: re-argue the bar, never tune it first.
- Both title names reach the judge. `retrieveSources` passes `shouldCancel`, checked just before the call; the call has a deadline.
- Own Test: `testSourceFilter` (real request at the configured ceiling; runs only when the switch is on).
- Reports: retrieval log (every score, drops with domain/chars and URL, `floored`) and `analysis_comparison_runs.judged_sources` (`0195`; NULL = not asked), validated by `readJudgedSourceReport`; replays copy it. Card numbers ship as `SOURCE_FILTER_FACTS`.
- Open: a thin retrieval should go back for more; nothing does.

## Segments and spoilers (`segments.ts`, `prompt.ts`)

- `tradition` is the one spoiler-shaped question; the prompt is its only protection (a panel disclosure gate was removed on the operator's call). `TRADITION_QUESTION` carries the mechanical test (does knowing how the antecedent ends tell you how this ends) inside the question itself.
- `segments.ts` LABELS runs from the paragraph index: split server-side; ship resolved text + question ids, never the index.
- `toParagraphs` gets the WHOLE analysis; the caller decides `reflow` once. Consecutive identical labels merge; an unlabelled paragraph gets no heading.
- Requiring named critics was rejected.

## Versions (`prompt.ts`, `promptEditions.ts`)

- `ANALYSIS_PROMPT_VERSION` = current; `ANALYSIS_STALE_BELOW` = staleness floor (≤ current; both `titles.ts` SQL callers + `isAnalysisStale` bind it). Move the floor only when old prose is unusable (vocabulary, spoiler/accuracy, output contract), never for style/naming/length. Floor > current ⇒ the library rewrites itself forever. Declines no longer clear on a bump. The test pins literal numbers.
- Question order v9+: `tradition`(Context) → `work` → [`structure`] → `circumstances`(Making) → `reception`. `intent`/`dispute` retired, NOT deleted: they stay in `AnalysisQuestionId` + web mirrors (`TitleAnalysis.tsx`, `tool-ui/types.ts`) because stored maps carry them; `questionIdsFor` omits them. `questionIdsFor`/`parseParagraphMap` take the version.
- An edition = questions + rules only; header, source block, TASK, retrieval-mode rule and output contract are shared, and `prompt.test.ts` pins that for every carried version.
- Archived editions are generated from the BUILT edition, never retyped, never edited. The current edition is inserted into the registry last; no archived edition carries the current number.
- Draft: `DRAFT_EDITION`/`DRAFT_PROMPT_VERSION` (= current+1) is bench-only; the library job, route and map vocabulary use current. Built from named replacements (`draftQuestions`, `draftRules`, matched by exact id/text, throw at module load on a miss). Draft text may change; runs store their text in `analysis_comparison_runs.prompts`.
- Promotion checklist: dump all prompts (versions × media types × retrieval modes) before; archive N from the built edition; move texts span-for-span into constants; bump the version; `DRAFT_EDITION = null`; dump after — unchanged versions byte-identical. Repoint tests: version-N test → `editionFor(N)`; draft test → read by number (an `if (DRAFT_PROMPT_VERSION == null) return` guard goes vacuously green); comparison baselines → `editionFor(previous)`, never `ANALYSIS_PROMPT_VERSION`.
- Promotion freezes the text: fix any movie/series asymmetry first (tradition, making and reception have separate texts per media type since v16) and pin both media types in tests.
- Editing the live version in place is allowed, but `prompt_version` then can't separate rows.
- The other 14 locales keep older `section.*` translations (`i18n:sync` never overwrites); new section keys show English until translated.

## Variants (`promptVariants.ts`)

- Second prompt for one version, string id, same ids/header/contract as its base. An empty `PROMPT_VARIANTS` is a supported state.
- `title_analysis.prompt_variant` (`0180`) stores what actually wrote the row; `analysis_comparison_results.prompt_variant` (`0179`) on the bench.
- `libraryVariantFor` (pure): refuses a variant whose base ≠ current, never throws, unknown id → null → the version's own prompt. The settings route validates through it only when the PATCH sets the value. `promptChoiceLabel` formats a stored label from the string (no lookup). Switching variant retires nothing.

## Bench (`compare.ts`, `comparisonReport.ts`; routes `/api/analysis-compare/*`)

- Retrieve ONCE: every model gets the byte-identical prompt. `startComparison(promptVersions)` builds one prompt per version from that retrieval; every model answers every version, grouped by model. Grounding mode is refused (no shared control).
- It drives the real path: `runWriteAttempt` is exported from `generate.ts`, never copied. It writes nothing to `title_analysis`.
- A failing model doesn't fail the run, and its failure is printed. A rejected answer prints `[UNUSABLE]` even when it has prose.
- The deliverable is one text report (`comparisonReport.ts`, pure, pinned): control first, entries in request order, prompt last.
- `buildTitleAnalysisAttemptFor` (any provider/model; credentials from the shared store; inherits role pacing only for the same provider) ≠ `getTitleAnalysisModelAttempts` (what the role uses).
- Local providers are probed at the configured address: `discoverLocalModels` gets `resolveBenchEndpoint`'s baseUrl and key, the ones a bench run and the library writer use (`benchEndpointFrom`, pure, pinned: on the Title Analysis role's own provider its address and nothing else, its key or else the shared one; the shared ones elsewhere). The group carries the server's own reason as `error` when its reader gives one, shown in place of the generic line. Picker states: not configured / configured but silent / reachable but empty; `isDiscoverableProvider` separates "not local" from "didn't answer".
- `replayComparison` (`0171` `replay_of`) retrieves nothing and takes `promptVersions` too: documents come back via `extractPromptSources`, split on recorded `title — domain` labels, never `[n]` alone; an unfound entry = an empty doc `buildSourceBlock` skipped; the round trip is pinned byte-identical. A same-version replay is allowed = the noise floor. The subject header is rebuilt from the current library. Baseline `ON DELETE SET NULL`. Runs stored (`0169`), never pruned.
- Same-version replay noise exceeds most version deltas ⇒ never decide a prompt change on a two-answer bench; measure on the library (`scripts/probe-critic-spill.sql`, `scripts/probe-ending-disclosure.sql`). Bench a historically-grounded AND a formally-grounded title; absences are invisible to every signal.
- `LENGTH_CAPS` per version (a table, not a parse); a test asserts each figure appears in that edition's rules; `wordsTolerance` applies to words only, never paragraphs. "!" = exceeded.
- Per-question allocation is the `t/w/c/r` column; `split` (`scattered`) checks contiguity only.

## Signals (`proseSignals.ts`)

- Instrument, never validator: nothing rejects, retries or scores on it. A habit gets a pattern only once seen in output.
- Zero ≠ clean: a flat assertion has no hedge, and a clean `named` can sit on a misattribution. Signals count habits, not accuracy; read attributions against the documents.
- `named` is read against the version's own naming rule (ban, ceiling, permission); it is a count, not a verdict.
- Label-based counts (told twice, spill, `rec/work`) print a dash without a usable map.
- spill excludes `the viewer` / `a viewer` (the prompt asks for the singular viewer); plural kept.
- `pointsAtSources` must match the prompt's own noun ("documents").
- Other columns: `inlineLabels` (bracketed question ids left in prose), praise (quality words outside reception), awards, `longest-w`.
- named: `writerNamesFromSources` (trailing segment after dash/pipe, raw tail kept, surname only when the tail is capitalised throughout, case-sensitive) + `namesFromDocuments` (bylines, `/critic/`-filed links, aggregator `Name Pub Mon D, YYYY`, site name split `RogerEbert.com`→`Roger Ebert`) + `PUBLICATIONS` + shapes that can name a writer but not a maker (`X of Y notes`, `the reviewer at Y`). Never a bare surname + reporting verb (fires on makers).
- **Reword the prompt ⇒ re-read the signals.** Three were blinded or inverted that way.

## Writing prompt rules (measured)

- A question is read right before writing, a rule before ~90k chars of documents: when they disagree the question wins. Read the questions against the rules before shipping, not only the rule being edited.
- Fix a question/rule conflict by DELETING the wording the model echoes, never by adding a rule against what the prompt itself generates.
- Measure on the library before reversing a permission (a bench of two answers can't tell a leak from the permission working).
- A positional word can't be a spoiler rule (a verdict is phrased positionally); use the rule's own line: how it LANDS is a judgement, how it BEHAVES is the ending.
- Probes: check that a hit comes back as a readable sentence (`regexp_matches` returns capture groups) and validate against a trusted signal before believing a count.
- With `ANALYSIS_STALE_BELOW` below current, a fix can't be measured on old rows: force-rewrite titles that carry the fault and re-run the probes. A dominant critical reading that IS a film's solution is left for the checker.
- Ceilings are obeyed, flat bans are not. Prefer a number to a prohibition.
- Max, not floor: a floor causes padding. Words may run a little over; paragraphs may not.
- Length follows the work, not the size of the sources.
- A ban that quotes its target supplies it: name the shape, print no example.
- A rule the model can satisfy while doing the forbidden thing isn't a rule: name the failing phrasing.
- A relaxation aimed at one number travels to every number phrased like it: fence permission against prohibition INSIDE the permission.
- An example naming one wrong destination teaches that destination, not the principle.
- A rule with one exception is enforced at the exception (one permitted name became an invented attribution).
- A phrase list alone moves the habit to a synonym: state the principle, list phrasings as examples of it.
- Models follow a sentence's opening (a 9B model loses the rest of a long conditional): put the condition first.
- Never give a counterfactual test ("would it differ if…"): no document can answer it, imagination always can.
- A negative list fails when a source welds a wanted fact to an unwanted one in one clause: say what to do with the half that belongs.
- One never-earns-its-place list (`EARNS_ITS_PLACE_RULE`) governs every answer; questions name only what belongs to them. Four disagreeing lists was the v16 fault.
- When compressing prompt text, the explanation can go but every named phrasing stays: the phrasing is the mechanism (`prompt.test.ts` pins several).
- Don't re-add the causal-clause ban ("so that", "which gives"…): v16 repealed it on purpose for a licence to draw an on-screen effect out; `deliberately` is the out-of-bounds word, already covered.
- An opening naming the situation is `tradition` working, not synopsis; the breach is disclosing what happens (`SPOILER_RULE`).
- A small local model failing the output contract is a `fallbackModels` problem, not a prompt-length one.
