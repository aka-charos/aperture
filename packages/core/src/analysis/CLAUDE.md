# Title analysis: prompt versions, bench, retrieval filters

Loaded when working in `analysis/`. Terse rules; evidence in [F-124](../../../../docs/aperture-forensics.md#f-124) (full pre-split text at its end), [F-116](../../../../docs/aperture-forensics.md#f-116), [F-122](../../../../docs/aperture-forensics.md#f-122), [F-168](../../../../docs/aperture-forensics.md#f-168). Read the F-entry before reverting or arguing with a rule.

## Versions (`prompt.ts`, `promptEditions.ts`)

- `ANALYSIS_PROMPT_VERSION` = current; `ANALYSIS_STALE_BELOW` = staleness floor (≤ current; both `titles.ts` SQL callers + `isAnalysisStale` bind it). Move floor only when old prose is unusable (vocabulary, spoiler/accuracy, output contract), never for style/naming/length. Floor > current ⇒ library rewrites itself forever. Declines no longer clear on a bump. Test pins literal numbers, not just relative.
- Question order v9+: `tradition`(Context) → `work` → [`structure`] → `circumstances`(Making) → `reception`. `intent`/`dispute` retired, NOT deleted: stay in `AnalysisQuestionId` + web mirrors (`TitleAnalysis.tsx`, `tool-ui/types.ts`) because stored maps carry them; `questionIdsFor` omits them. `questionIdsFor`/`parseParagraphMap` take the version.
- An edition = questions + rules only; header, source block, TASK, retrieval-mode rule, output contract are shared and `prompt.test.ts` pins that for every carried version.
- Archived editions are generated from the BUILT edition, never retyped, never edited. Current edition inserted into the registry last; no archived edition carries the current number.
- Draft: `DRAFT_EDITION`/`DRAFT_PROMPT_VERSION` (= current+1) is bench-only; library job, route, map vocabulary use current. Built from named replacements (`draftQuestions`, `draftRules`, matched by exact id/text, throw at module load on miss). Draft text may change; runs store their text in `analysis_comparison_runs.prompts`.
- Promotion checklist: dump all prompts (versions × media types × retrieval modes) before; archive N from the built edition; move texts span-for-span into constants; bump version; `DRAFT_EDITION = null`; dump after — unchanged versions byte-identical. Repoint tests: version-N test → `editionFor(N)`; draft test → read by number (a `if (DRAFT_PROMPT_VERSION == null) return` guard goes vacuously green); comparison baselines → `editionFor(previous)`, never `ANALYSIS_PROMPT_VERSION`.
- Promotion freezes the text: fix any movie/series asymmetry first (tradition, making, reception have separate texts per media type since v16) and pin both media types in tests.
- Editing the live version in place is allowed but `prompt_version` then can't separate rows.
- Other 14 locales keep older `section.*` translations (`i18n:sync` never overwrites); new section keys show English until translated.

## Variants (`promptVariants.ts`)

- Second prompt for one version, string id, same ids/header/contract as base. `PROMPT_VARIANTS` empty is a supported state.
- `title_analysis.prompt_variant` (`0180`) stores what actually wrote the row; `analysis_comparison_results.prompt_variant` (`0179`) on the bench.
- `libraryVariantFor` (pure): refuses a variant whose base ≠ current, never throws, unknown id → null → version's own prompt. Settings route validates through it only when the PATCH sets the value. `promptChoiceLabel` formats a stored label from the string (no lookup). Switching variant retires nothing.

## Bench (`compare.ts`, `comparisonReport.ts`)

- `startComparison(promptVersions)` retrieves ONCE, one prompt per version, every model answers every version, grouped by model. `replayComparison` takes `promptVersions` too. The library job never passes a version.
- `AnalysisSource.fetchedChars`/`strippedChars` reach the retrieval log and report: whether a slot went on an article or a menu.
- Per-question allocation is the `t/w/c/r` column; `split` (`scattered`) checks contiguity only.
- `replayComparison` (`0171` `replay_of`) retrieves nothing: documents come back via `extractPromptSources`, split on recorded `title — domain` labels, never `[n]` alone (pages carry footnote markers); unfound entry = empty doc `buildSourceBlock` skipped; round trip pinned byte-identical. Same-version replay allowed = noise floor. Subject header rebuilt from current library. Baseline `ON DELETE SET NULL`.
- Same-version replay noise exceeds most version deltas ⇒ never decide a prompt change on a two-answer bench; measure on the library (`scripts/probe-critic-spill.sql`, `scripts/probe-ending-disclosure.sql`). Bench a historically-grounded AND a formally-grounded title; absences are invisible to every signal.
- `LENGTH_CAPS` per version (table, not a parse); test asserts each figure appears in that edition's rules; `wordsTolerance` applies to words only, never paragraphs. "!" = exceeded.
- A rejected answer prints `[UNUSABLE]` even when it has prose.
- `structure.ts` `MAX_PARAGRAPHS` (30) is checked first and rotates: gross overrun = broken generation, `finishReason` is still `stop`.

## Signals (`proseSignals.ts`)

- Instrument, never validator: nothing rejects, retries or scores on it. A habit gets a pattern only once seen in output.
- Zero ≠ clean: a flat assertion has no hedge, and a clean `named` can sit on a misattribution. Signals count habits, not accuracy; read attributions against the documents.
- `named` is read against the version's own naming rule (ban, ceiling, permission); it is a count, not a verdict.
- Label-based counts (told twice, spill, `rec/work`) print a dash without a usable map.
- spill excludes `the viewer` / `a viewer` (prompt asks for singular viewer); plural kept.
- `pointsAtSources` must match the prompt's own noun ("documents").
- Other columns: `inlineLabels` (bracketed question ids left in prose), praise (quality words outside reception), awards, `longest-w`.
- named: `writerNamesFromSources` (trailing segment after dash/pipe, raw tail kept, surname only when tail capitalised throughout, case-sensitive) + `namesFromDocuments` (bylines, `/critic/`-filed links, aggregator `Name Pub Mon D, YYYY`, site name split `RogerEbert.com`→`Roger Ebert`) + `PUBLICATIONS` + shapes that can name a writer but not a maker (`X of Y notes`, `the reviewer at Y`). Never bare surname + reporting verb (fires on makers).
- **Reword the prompt ⇒ re-read the signals.** Three were blinded or inverted that way.

## Retrieval filters (above the budget, in this order)

`dropLowValueSources` → `cleanSources` (so `isOffTopic` counts on uncleaned text) → budget.

- `blockedPage.ts`: drop only short (≤2000) AND wall phrase; every page walled ⇒ throw (scraper refused, not a title fact).
- `sourceQuality.ts`: domain list = pages a person read; no-sentence page dropped (one sentence keeps it); <3 prose lines + 20+ standalone links dropped; count LINES, never link density (Wikipedia is >50% link chars); `isProseLine` excludes headings and link-only lines; `isLinkOnlyLine` strips `[`/`]`; `MIN_USEFUL_CHARS` names empty fetches; `isOffTopic` = mentions per `CHARS_PER_TITLE_MENTION`, includes original title, skips titles <5 letters, runs last. Fails open: never drop everything. Shapes, not hosts (no `reddit.com` entry).
- `sourceCleanup.ts`: strip markup before line tests (`stripImages`, `stripEmptyLinks`, `stripCountLinks` (keeps the line), `stripSolicitationLines` on VISIBLE text, every pattern naming its object, `BARE_FURNITURE`); menu = run measured in links, filler bridges, a sentence never, cut only to the last link; partly-link lines count via `menuLinkCount`; plot strip only `Plot`/`Synopsis`/`Storyline`; `FURNITURE_HEADING` excludes Audience/User Reviews; widget line = no sentence + ≥3 run-together words. Never empties a document.
- `duplicateSources.ts`: title key needs ≥20 letters after removing film names/year; `keepOnePerDomain` = host minus `www`.
- Thin retrieval makes the model COPY ⇒ answer is more retrieval, never declining; `MIN_SUBSTANTIVE_SOURCES` (2) deliberately low.
- Don't trade document count for smaller slices: the model's material sits mid-document (not head-biased), so shorter slices cut what it uses.
- Measuring retrieval→output derivation: word containment / longest shared word-run. Never IDF (it scores the writer's own paraphrase words as signal).

## Writing prompt rules (measured)

- Ceilings are obeyed, flat bans are not. Prefer a number to a prohibition.
- Max, not floor: a floor causes padding. Words may run a little over; paragraphs may not.
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
- Questions are read after the documents, rules before: when they disagree the question wins. Read questions against rules before shipping (F-168).
- A small local model failing the output contract is a `fallbackModels` problem, not a prompt-length one.
