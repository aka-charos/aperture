/**
 * The search query and the header that has to agree with it.
 *
 * Both read `distinctOriginalTitle`, and the failure this pins is silent in
 * both directions: a query missing the original title quietly retrieves and
 * analyses a different film, while one that adds a name the row already
 * carries spends a search term on nothing.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  ANALYSIS_PROMPT_VERSION,
  buildAnalysisQuery,
  buildAnalysisPrompt,
  distinctOriginalTitle,
  extractPromptSources,
  questionIdsFor,
  BENCH_PROMPT_VARIANTS,
  BENCH_PROMPT_VERSIONS,
  DRAFT_PROMPT_VERSION,
  editionFor,
  promptChoiceKey,
  promptChoiceLabel,
  libraryVariantFor,
  resolveBenchPromptChoices,
  resolveBenchPromptVersions,
  variantFor,
} from './prompt.js'
import { ARCHIVED_PROMPT_EDITIONS } from './promptEditions.js'
import type { AnalysisSubject } from './prompt.js'

const subject = (over: Partial<AnalysisSubject> = {}): AnalysisSubject => ({
  title: 'Sentimental Value',
  year: 2025,
  mediaType: 'movie',
  reception: {},
  ...over,
})

test('no original title, the query is unchanged', () => {
  const q = buildAnalysisQuery(subject())
  assert.equal(q, 'Sentimental Value 2025 film review')
})

test('a different original title rides beside the localized one, before the year', () => {
  const q = buildAnalysisQuery(subject({ originalTitle: 'Affeksjonsverdi' }))
  assert.equal(
    q,
    'Sentimental Value Affeksjonsverdi 2025 film review'
  )
})

test('a series query keeps its kind', () => {
  const q = buildAnalysisQuery(
    subject({ title: 'Dark', originalTitle: 'Dunkel', mediaType: 'series' })
  )
  assert.ok(q.startsWith('Dark Dunkel 2025 TV series '), q)
})

test('the same name spelled the same way is not repeated', () => {
  assert.equal(distinctOriginalTitle(subject({ originalTitle: 'Sentimental Value' })), null)
})

// The three ways a row carries an original title that is not a second name:
// the sync copies the localized one verbatim, the provider stores it in caps,
// or the two differ only by the accents an engine folds away anyway.
test('case and accents alone are not a different name', () => {
  assert.equal(distinctOriginalTitle(subject({ originalTitle: 'SENTIMENTAL VALUE' })), null)
  assert.equal(
    distinctOriginalTitle(subject({ title: 'Amelie', originalTitle: 'Amélie' })),
    null
  )
  assert.equal(
    distinctOriginalTitle(subject({ title: 'Amélie', originalTitle: 'Amelie' })),
    null
  )
})

test('surrounding whitespace is not a different name', () => {
  assert.equal(distinctOriginalTitle(subject({ originalTitle: '  Sentimental Value ' })), null)
})

test('absent, null and empty all read as no original title', () => {
  assert.equal(distinctOriginalTitle(subject()), null)
  assert.equal(distinctOriginalTitle(subject({ originalTitle: null })), null)
  assert.equal(distinctOriginalTitle(subject({ originalTitle: '   ' })), null)
})

// A subtitle variant IS worth searching for, unlike the assistant's
// titlesOverlap, which folds one into the other because it is answering a
// different question - see the note on distinctOriginalTitle.
test('a longer original title is kept', () => {
  assert.equal(
    distinctOriginalTitle(
      subject({ title: 'Amélie', originalTitle: "Le Fabuleux Destin d'Amélie Poulain" })
    ),
    "Le Fabuleux Destin d'Amélie Poulain"
  )
})

test('a non-Latin original title is kept', () => {
  assert.equal(
    distinctOriginalTitle(subject({ title: 'Drive My Car', originalTitle: 'ドライブ・マイ・カー' })),
    'ドライブ・マイ・カー'
  )
})

/**
 * The version-8 and version-9 corrections, pinned because nothing else can see
 * them.
 *
 * Each one exists because an abstract rule was already present and did not
 * catch the behaviour - so these are not paraphrases of a rule above them, they
 * are the specific sentence that does the work, and an edit that tidies one
 * away restores a fault this file has already paid for. The assertions are
 * fragments rather than whole strings on purpose: the surrounding rule is free
 * to be rewritten, the clause is not free to disappear.
 */
const questionOrder = (p: string) =>
  [...p.matchAll(/^\d+\. \[([a-z]+)\]/gm)].map((match) => match[1])

test('version 9 reads before, during, after: context, work, making, reception', () => {
  assert.deepEqual(questionOrder(buildAnalysisPrompt(subject(), { mode: 'grounding' })), [
    'tradition',
    'work',
    'circumstances',
    'reception',
  ])
  assert.deepEqual(
    questionOrder(buildAnalysisPrompt(subject({ mediaType: 'series' }), { mode: 'grounding' })),
    ['tradition', 'work', 'structure', 'circumstances', 'reception']
  )
})

// Retired from the questions, kept in the union for stored rows - see the note
// on AnalysisQuestionId. A map written now must not be able to claim either.
test('version 9 asks neither intent nor dispute, and the map vocabulary agrees', () => {
  for (const mediaType of ['movie', 'series'] as const) {
    const ids = questionIdsFor(mediaType)
    assert.ok(!ids.includes('intent') && !ids.includes('dispute'), ids.join(','))
    assert.ok(ids.includes('reception'), ids.join(','))
  }
})

test('influence moved from the lineage question to reception', () => {
  const p = buildAnalysisPrompt(subject(), { mode: 'grounding' })
  assert.ok(!p.includes('what did it influence?'), p)
  assert.ok(p.includes('what it went on to influence to the reception question'), p)
  assert.ok(p.includes('what did it go on to influence?'), p)
})

// The two measured failures of the dispute question: an invented split, and
// "leave it open" carried out as a sentence announcing that it is open.
test('reception asks for consensus where there is one and forbids announcing openness', () => {
  const p = buildAnalysisPrompt(subject(), { mode: 'grounding' })
  assert.ok(p.includes('If critics largely agree, say what they agree on.'), p)
  assert.ok(p.includes('with no sentence remarking that the question stays open'), p)
  assert.ok(p.includes('is not a disagreement about it'), p)
  assert.ok(p.includes('no verdict of your own'), p)
})

test('the making question holds intent to what someone actually said', () => {
  const p = buildAnalysisPrompt(subject(), { mode: 'grounding' })
  assert.ok(p.includes('Neither is an intention read back off the finished work'), p)
  assert.ok(p.includes('Neither is how it was received'), p)
  assert.ok(
    p.includes('Ask whether the finished work would be different if this had not happened.'),
    p
  )
  assert.ok(p.includes('filming locations listed for their own sake'), p)
})

test('the work question refuses credit lists and reveals', () => {
  const p = buildAnalysisPrompt(subject(), { mode: 'grounding' })
  assert.ok(p.includes('even with a sentence about its effect attached'), p)
  assert.ok(p.includes('never what it turns out to be'), p)
})

// Version 8's list of banned phrasings was met with synonyms, so the principle
// is what is pinned now, with the measured synonyms named beneath it.
test('attribution is a principle: facts plainly, views with a holder', () => {
  const p = buildAnalysisPrompt(subject(), { mode: 'grounding' })
  assert.ok(p.includes('state facts, what is on screen and what it does to the viewer plainly'), p)
  assert.ok(p.includes('Never state such a view as your own'), p)
  assert.ok(p.includes('"is described as"'), p)
  assert.ok(p.includes('"is said to"'), p)
  assert.ok(p.includes('"the sources carry"'), p)
})

test('paragraphs open on substance and a fact is told once', () => {
  const p = buildAnalysisPrompt(subject(), { mode: 'grounding' })
  assert.ok(p.includes('its first sentence says something about the film itself'), p)
  // Version 15: GLM paraphrased this example three times.
  assert.ok(!p.includes('"The circumstances of its making"'), p)
  assert.ok(p.includes('Say each fact once, under the question it belongs to'), p)
})

// Kept from version 8: the half of rule 3 that had to go stays gone, and the
// adjacency constraint that replaced it stays.
test('a question may take several paragraphs, but keeps them together', () => {
  const p = buildAnalysisPrompt(subject(), { mode: 'grounding' })
  assert.ok(!p.includes('Do not write one paragraph per question'), p)
  assert.ok(p.includes('Give a question as many paragraphs as the sources support'), p)
  assert.ok(
    p.includes('do not scatter one question across paragraphs that are not next to each other'),
    p
  )
})

test('the size of the source block does not license length', () => {
  const p = buildAnalysisPrompt(subject(), { mode: 'grounding' })
  assert.ok(p.includes('Length follows the work, not the amount of source text'), p)
  assert.ok(p.includes('A long source block is not a reason to write more'), p)
})

// The bump is what retires every stored row, so it is the half of the change
// that actually reaches readers - a corrected prompt with a stale version
// number silently applies to nothing already written.
test('the prompt version carries the version-15 corrections', () => {
  assert.ok(ANALYSIS_PROMPT_VERSION >= 15, String(ANALYSIS_PROMPT_VERSION))
})

/**
 * Version 11, from Terminator 2 benched under 9 and the version-10 draft. Each
 * fragment is the clause answering one measured fault - see the notes on the
 * constants in ./prompt.ts.
 */
test('context opens on the kind of work, and a single-work comparison is a critic view', () => {
  const p = buildAnalysisPrompt(subject(), { mode: 'grounding' })
  assert.ok(p.includes('not on who directed, wrote or stars in it'), p)
  assert.ok(p.includes('and not on the tags or mood keywords a listing site attaches'), p)
  assert.ok(p.includes("is a critic's view unless a maker said it, and a critic's view belongs to the reception answer"), p)
  // The spoiler test still applies wherever the comparison ends up.
  assert.ok(p.includes('Wherever a comparison appears, it is only safe when it does not carry the ending'), p)
  assert.ok(p.includes('How it was made and what its makers decided belong to the making question'), p)
  // v9's invitation to production, and v10's pull toward single works, stay gone.
  assert.ok(!p.includes('what was it responding to'), p)
  assert.ok(!p.includes('what earlier works'), p)
})

/**
 * Version 12, from Terminator 2 under 10 and 11 and two version-11 library
 * rows: reception had become the longest section and a list of bylines nobody
 * knows, and the work answer had lost what its choices achieve.
 */
test('the work answer says what its choices achieve, and quality stays out', () => {
  const p = buildAnalysisPrompt(subject(), { mode: 'grounding' })
  assert.ok(p.includes('if a document says it, that effect is the answer'), p)
  assert.ok(p.includes('whether it is good belongs to the reception question'), p)
  assert.ok(!p.includes('What one critic reads into a choice belongs to the reception answer'), p)
})

test('reception is the shortest answer and says each point once', () => {
  const p = buildAnalysisPrompt(subject(), { mode: 'grounding' })
  assert.ok(p.includes('This is the shortest answer: at most two short paragraphs'), p)
  assert.ok(p.includes('never longer than the answer about what the work is doing'), p)
  assert.ok(p.includes('not a sentence for each critic who did'), p)
  assert.ok(p.includes('Leave out one that is only about the re-release or its format'), p)
  assert.ok(p.includes('in terms a critic used'), p)
})

/**
 * Version 13, from Kontroll under 11 and 12 and a version-12 library row (The
 * Zero Years): names are gone, writers' views stay in reception, and weak
 * pages are weighed as what they are.
 */
test('nobody is named', () => {
  const p = buildAnalysisPrompt(subject(), { mode: 'grounding' })
  assert.ok(p.includes('Never name a critic, scholar, reviewer or publication'), p)
  // v12 still named a critic a general reader would recognise.
  assert.ok(!p.includes('only when a general reader would recognise it'), p)
  assert.ok(!p.includes('needs their name'), p)
  assert.ok(!p.includes('not in every sentence'), 'the licence version 9 gave must stay gone')
})

test("the craft answers speak in the analysis's own voice; readings and verdicts go to reception", () => {
  const p = buildAnalysisPrompt(subject(), { mode: 'grounding' })
  assert.ok(p.includes("The context, work and making answers speak in your own voice"), p)
  assert.ok(p.includes('it belongs in the reception answer, marked as a critic'), p)
  assert.ok(p.includes('is a reading, and readings belong to the reception question too'), p)
  assert.ok(p.includes('and only one that shaped how the film was received'), p)
  // v12's rule that made every effect need a holder.
  assert.ok(!p.includes('A view written as a plain sentence is still a view'), p)
})

test('weak pages give reception one sentence at most', () => {
  const p = buildAnalysisPrompt(subject(), { mode: 'grounding' })
  assert.ok(p.includes('take no reading of the work from them and no claim about where it sits'), p)
  assert.ok(p.includes("Ordinary viewers' reactions get one sentence at most"), p)
})

test('the work, making and reception answers carry the other measured corrections', () => {
  const p = buildAnalysisPrompt(subject(), { mode: 'grounding' })
  assert.ok(p.includes('no "sharp", "powerful", "masterful" or "career-best"'), p)
  assert.ok(p.includes('say how a comedy is funny or how a thriller builds suspense'), p)
  assert.ok(p.includes('A list of who held which job is not an answer either'), p)
  assert.ok(p.includes('Neither is what its makers or collaborators went on to do afterwards'), p)
  assert.ok(p.includes('A fault a review argues in detail is worth more than a summary'), p)
})

test('a paragraph develops one point instead of listing facts', () => {
  const p = buildAnalysisPrompt(subject(), { mode: 'grounding' })
  assert.ok(p.includes('Each paragraph makes one point and develops it'), p)
  assert.ok(p.includes('is notes, not prose'), p)
  assert.ok(!p.includes('if a sentence carries two ideas, make it two sentences'), p)
})

test("a critic's guess at intent is not the maker speaking", () => {
  const p = buildAnalysisPrompt(subject(), { mode: 'grounding' })
  assert.ok(p.includes("a critic's guess at what the maker wanted is not a statement by the maker"), p)
})

/**
 * Version 14, from Terminator 2 under 12 and 13 with a second model, and from
 * Withnail & I and The Wretches Are Still Singing under 13.
 */
test('documents are weighed by who is speaking, and a wrong fact discounts a page', () => {
  const p = buildAnalysisPrompt(subject(), { mode: 'grounding' })
  assert.ok(p.includes('Weigh what each document says by who is saying it'), p)
  assert.ok(p.includes('a critic quoted on any other page still counts as one'), p)
  assert.ok(p.includes("an aggregator's summary of what critics think"), p)
  assert.ok(p.includes('Never repeat the genre labels, tags or mood keywords a listing, store or streaming page attaches'), p)
  assert.ok(p.includes('A document that gets a checkable fact wrong'), p)
  assert.ok(p.includes('says nothing it could not say about any film'), p)
  assert.ok(!p.includes('Weigh the documents by what they are'), 'v13 weighed the kind of page')
})

test('a statement needs the maker', () => {
  const p = buildAnalysisPrompt(subject(), { mode: 'grounding' })
  assert.ok(p.includes('That needs the maker as the speaker'), p)
  assert.ok(p.includes('without quoting them is giving its own description'), p)
})

test('critics are counted as the documents count them, and every holder is a person', () => {
  const p = buildAnalysisPrompt(subject(), { mode: 'grounding' })
  assert.ok(p.includes('Count critics the way the documents do'), p)
  assert.ok(p.includes('whether they are in separate documents or one document reports them'), p)
  assert.ok(p.includes('two remarks by the same critic are one critic'), p)
  assert.ok(p.includes('and so is a claim another document argues against'), p)
  assert.ok(p.includes('The holder is always a person'), p)
  assert.ok(p.includes('"has been credited with"'), p)
  assert.ok(p.includes('"one source credits"'), p)
  // v13's proxy, which forbade a correct plural and allowed a false one.
  assert.ok(!p.includes('only when more than one document holds the view'), p)
})

test('reception takes one reading and one comparison, and drops a re-release review quietly', () => {
  const p = buildAnalysisPrompt(subject(), { mode: 'grounding' })
  assert.ok(p.includes('Give at most one reading of what the film means, in a sentence of its own'), p)
  assert.ok(p.includes("A critic's comparison with one earlier work may take a sentence of its own"), p)
  assert.ok(p.includes('without saying that you did'), p)
  assert.ok(p.includes('say that it was written at the re-release'), p)
  // The v13 sentence both models misread, in opposite directions.
  assert.ok(!p.includes('and say so when a view of the film itself dates from one'), p)
})

test('money is not a making answer, and a changed ending is ending discussion', () => {
  const p = buildAnalysisPrompt(subject(), { mode: 'grounding' })
  assert.ok(p.includes('That it would not exist at all does not count'), p)
  assert.ok(p.includes('who paid for it, rights deals and fees'), p)
  assert.ok(p.includes('a published screenplay included'), p)
  assert.ok(p.includes('That a maker changed the ending, the tone it closes on'), p)
})

/**
 * Version 15, from The Wretches Are Still Singing replayed under 13 and 14 on
 * the same documents: every answer carried an effect no document described.
 */
test('the work answer names the choice first and adds an effect only from a document', () => {
  const p = buildAnalysisPrompt(subject(), { mode: 'grounding' })
  assert.ok(p.includes('Name the choices that matter to what it is doing. For each one, look for what a document says it does to the viewer'), p)
  assert.ok(p.includes('if none does, name the choice and stop - never supply an effect yourself'), p)
  assert.ok(p.includes('"so that", "which gives", "lets it" or "the result is"'), p)
  // 14's order, demand first and condition after, is what both models followed.
  assert.ok(!p.includes('Name a choice, then say what it achieves'), p)
})

test('the opening may describe the kind of work; only a listing site\'s tags stay out', () => {
  const p = buildAnalysisPrompt(subject(), { mode: 'grounding' })
  assert.ok(!p.includes('a string of genre labels'), p)
  assert.ok(p.includes('a listing, store or streaming page attaches'), p)
})

/**
 * Replay reads the documents back out of a stored prompt, and the only proof
 * that it read them correctly is that they rebuild the identical block. The
 * fixture carries the three things that would break a naive reader: a skipped
 * empty document, a footnote marker that looks like the next document's number,
 * and a line reading TASK inside a page.
 */
test('a stored prompt gives back the documents it was built from, byte for byte', () => {
  const sources = [
    { title: 'Possession (1981 film)', domain: 'en.wikipedia.org', url: 'https://w/p', text: 'Opening.\n\n[2] Żuławski, A. (1981). A footnote.\n\nTASK\n\nMore.' },
    { title: 'Empty page', domain: 'blank.example', text: '   ' },
    { title: 'Review', domain: 'rogerebert.com', url: 'https://r/e', text: 'A review with [3] in it.' },
    { title: '', domain: 'bfi.org.uk', text: 'No title on this one.' },
  ]
  const s = subject({ title: 'Possession', year: 1981 })
  const prompt = buildAnalysisPrompt(s, { mode: 'crw', sources })

  const recovered = extractPromptSources(prompt, sources)
  assert.ok(recovered, 'nothing recovered')
  assert.deepEqual(
    recovered.map((r) => r.domain),
    ['en.wikipedia.org', 'rogerebert.com', 'bfi.org.uk']
  )
  assert.equal(recovered[0].text, sources[0].text)
  assert.equal(recovered[0].url, 'https://w/p')
  assert.equal(buildAnalysisPrompt(s, { mode: 'crw', sources: recovered }), prompt)
})

test('a prompt with no documents recovers nothing rather than an empty list', () => {
  const prompt = buildAnalysisPrompt(subject(), { mode: 'grounding' })
  assert.equal(extractPromptSources(prompt, [{ title: 'x', domain: 'y' }]), null)
  assert.equal(extractPromptSources('not a prompt', []), null)
})

test('the prompt names the original title, and only when there is one', () => {
  const withOriginal = buildAnalysisPrompt(subject({ originalTitle: 'Affeksjonsverdi' }), {
    mode: 'grounding',
  })
  assert.ok(withOriginal.includes('Original title: Affeksjonsverdi'), withOriginal.slice(0, 200))

  const without = buildAnalysisPrompt(subject(), { mode: 'grounding' })
  assert.ok(!without.includes('Original title:'), without.slice(0, 200))
})

/**
 * Archived editions, which the bench runs beside the current prompt.
 *
 * The claim that makes a multi-version bench sound is that two versions built
 * from one retrieval differ below the TASK line and nowhere else. That is
 * pinned here against the real archived editions, not asserted in a comment.
 */
const benchSources = [{ title: 'Doc', domain: 'd.com', text: 'Body.' }]
const aboveTask = (p: string) => p.slice(0, p.lastIndexOf('\nTASK\n'))
const contract = (p: string) => p.slice(p.indexOf('Output format.'))

test('the bench carries the archived versions and the current one, current newest', () => {
  assert.ok(BENCH_PROMPT_VERSIONS.includes(7) && BENCH_PROMPT_VERSIONS.includes(8))
  const released = BENCH_PROMPT_VERSIONS.filter((version) => version !== DRAFT_PROMPT_VERSION)
  assert.equal(released[released.length - 1], ANALYSIS_PROMPT_VERSION)
  if (DRAFT_PROMPT_VERSION != null) {
    assert.equal(DRAFT_PROMPT_VERSION, ANALYSIS_PROMPT_VERSION + 1)
  }
  // An archived copy carrying the current number would silently stand in for it.
  for (const edition of ARCHIVED_PROMPT_EDITIONS) {
    assert.ok(edition.version < ANALYSIS_PROMPT_VERSION, `archived ${edition.version}`)
  }
})

test('every edition shares the documents, header and output contract exactly', () => {
  const now = buildAnalysisPrompt(subject({ originalTitle: 'Affeksjonsverdi' }), {
    mode: 'crw',
    sources: benchSources,
  })
  for (const version of BENCH_PROMPT_VERSIONS) {
    for (const mediaType of ['movie', 'series'] as const) {
      const p = buildAnalysisPrompt(subject({ originalTitle: 'Affeksjonsverdi', mediaType }), {
        mode: 'crw',
        sources: benchSources,
        version,
      })
      const current = buildAnalysisPrompt(subject({ originalTitle: 'Affeksjonsverdi', mediaType }), {
        mode: 'crw',
        sources: benchSources,
      })
      assert.equal(aboveTask(p), aboveTask(current), `v${version} ${mediaType} above TASK`)
      assert.equal(contract(p), contract(now), `v${version} ${mediaType} contract`)
    }
  }
})

test('an archived edition asks its own questions', () => {
  const v8 = buildAnalysisPrompt(subject(), { mode: 'crw', sources: benchSources, version: 8 })
  assert.deepEqual(questionOrder(v8), ['work', 'tradition', 'intent', 'circumstances', 'dispute'])
  assert.ok(v8.includes('Never refer to the source documents as a thing'), v8)
  assert.ok(!v8.includes('[reception]'), v8)

  const v7 = buildAnalysisPrompt(subject(), { mode: 'crw', sources: benchSources, version: 7 })
  assert.deepEqual(questionOrder(v7), questionOrder(v8))
  assert.ok(!v7.includes('Never refer to the source documents as a thing'), 'v8 added that clause')
  assert.notEqual(v7, v8)
})

test('no version means the current edition, byte for byte', () => {
  assert.equal(
    buildAnalysisPrompt(subject(), { mode: 'crw', sources: benchSources }),
    buildAnalysisPrompt(subject(), { mode: 'crw', sources: benchSources, version: ANALYSIS_PROMPT_VERSION })
  )
})

test('the map vocabulary follows the version it is asked about', () => {
  assert.ok(questionIdsFor('movie', 8).includes('dispute'))
  assert.ok(questionIdsFor('series', 8).includes('structure'))
  assert.ok(!questionIdsFor('movie').includes('dispute'))
})

test('bench versions: current by default, deduplicated oldest first, unknown refused', () => {
  assert.deepEqual(resolveBenchPromptVersions(), [ANALYSIS_PROMPT_VERSION])
  assert.deepEqual(resolveBenchPromptVersions([]), [ANALYSIS_PROMPT_VERSION])
  assert.deepEqual(resolveBenchPromptVersions([ANALYSIS_PROMPT_VERSION, 8, ANALYSIS_PROMPT_VERSION, 7]), [
    7,
    8,
    ANALYSIS_PROMPT_VERSION,
  ])
  assert.throws(() => resolveBenchPromptVersions([3]), /not available/)
  assert.throws(() => resolveBenchPromptVersions([8.5]), /not a prompt version/)
  assert.throws(() => buildAnalysisPrompt(subject(), { mode: 'crw', version: 3 }), /not available/)
})

/**
 * Version 9 and the version-10 draft are archived, so the bench runs already
 * labelled with them stay rerunnable, and each still sends its own text.
 */
const versionPrompt = (version: number) =>
  buildAnalysisPrompt(subject(), { mode: 'crw', sources: benchSources, version })

test('versions 9 to 14 stay benchable, each as it was sent', () => {
  assert.ok([9, 10, 11, 12, 13, 14].every((version) => BENCH_PROMPT_VERSIONS.includes(version)))
  const [v9, v10, v11, v12, v13, v14, now] = [9, 10, 11, 12, 13, 14, ANALYSIS_PROMPT_VERSION].map(
    versionPrompt
  )
  assert.ok(v9.includes('not in every sentence'), 'v9 carried the naming licence')
  assert.ok(v10.includes('what earlier works, genres or movements'), 'v10 draft wording')
  assert.ok(!v10.includes('grouped by the point made'), 'v11 reception is not in v10')
  assert.ok(v11.includes('grouped by the point made'), 'v11 reception wording')
  assert.ok(v11.includes('What one critic reads into a choice belongs to the reception answer'))
  assert.ok(v12.includes('only when a general reader would recognise it'), 'v12 naming rule')
  assert.ok(!v12.includes('Weigh the documents by what they are'), 'v13 rule is not in v12')
  assert.ok(v13.includes('Weigh the documents by what they are'), 'v13 source rule')
  assert.ok(v13.includes('only when more than one document holds the view'), 'v13 plural rule')
  assert.ok(v14.includes('but only an effect a document describes'), 'v14 effect clause')
  assert.ok(v14.includes('a string of genre labels'), 'v14 opener wording')
  // v13 added a rule, which 14 and 15 kept; the archive must still hold v12's eight.
  assert.equal(v12.split('\n- ').length + 1, v13.split('\n- ').length)
  assert.equal(v13.split('\n- ').length, v14.split('\n- ').length)
  assert.equal(v14.split('\n- ').length, now.split('\n- ').length)
  assert.equal(new Set([v9, v10, v11, v12, v13, v14, now]).size, 7)
  // Same questions in the same order, so their maps share a vocabulary.
  assert.deepEqual(questionOrder(v9), questionOrder(now))
  assert.deepEqual(questionIdsFor('series', 10), questionIdsFor('series'))
})

/**
 * A DRAFT IS BENCH-ONLY. It is the newest number the bench carries and it must
 * not be what anything else resolves to: the library writer, the analysis route
 * and the paragraph map vocabulary all keep the current version, which is what
 * stops a draft from retiring the library it is being tested against.
 */
test('the draft, when there is one, sits above the current version and nowhere else', () => {
  const newest = BENCH_PROMPT_VERSIONS[BENCH_PROMPT_VERSIONS.length - 1]
  if (DRAFT_PROMPT_VERSION == null) {
    assert.equal(newest, ANALYSIS_PROMPT_VERSION)
    return
  }
  assert.equal(newest, DRAFT_PROMPT_VERSION)
  assert.equal(DRAFT_PROMPT_VERSION, ANALYSIS_PROMPT_VERSION + 1)
  // What resolves without being asked is still the current version.
  assert.equal(editionFor().version, ANALYSIS_PROMPT_VERSION)
  assert.deepEqual(resolveBenchPromptVersions(null), [ANALYSIS_PROMPT_VERSION])
  assert.deepEqual(questionIdsFor('movie'), questionIdsFor('movie', ANALYSIS_PROMPT_VERSION))
})

/**
 * Draft 16 is the compact variant with named replacements, which is a first -
 * every earlier draft varied the current version. Two things have to hold or
 * the bench cannot attribute anything to the change: the parts that were not
 * replaced are the variant's own, and the parts that were are not.
 *
 * The replacement helper throws when a base text moves, so merely building the
 * draft - which importing this module does - is half the test.
 */
test('the draft carries the compact variant with its measured corrections', () => {
  if (DRAFT_PROMPT_VERSION == null) return
  const draft = editionFor(DRAFT_PROMPT_VERSION)
  const compact = variantFor('compact')

  // Same question ids as its base, or parseParagraphMap discards every label.
  assert.deepEqual(
    draft.movieQuestions.map((q) => q.id),
    compact.movieQuestions.map((q) => q.id)
  )
  assert.deepEqual(
    draft.seriesQuestions.map((q) => q.id),
    compact.seriesQuestions.map((q) => q.id)
  )
  assert.equal(draft.rules.length, compact.rules.length)

  const rulesText = draft.rules.join('\n')

  // 1 and 2: the making question drops the counterfactual and names the welded
  // money case, and stops asking what the making "left on the film" up front.
  const making = draft.movieQuestions.find((q) => q.id === 'circumstances')!.text
  assert.ok(!making.includes('would be a different film'), 'counterfactual test removed')
  assert.ok(making.includes('only when a document says what it left'), 'document requirement')
  assert.ok(making.includes('despite struggles to obtain funding'), 'the welded money case')
  assert.ok(making.includes('the certificate it carried'), 'a qualifying condition is named')

  // 3: every length number is a maximum now, and the sentence cap names five.
  assert.ok(!rulesText.includes('450 to 750 words'), 'the word floor is gone')
  assert.ok(rulesText.includes('There is no minimum'), 'and is named as gone')
  assert.ok(rulesText.includes('never five'), 'the sentence cap names its failure')

  // 4: THE NAMING BAN IS GONE, on the operator's call. It had been in every
  // version since 13, failed on every model ever benched, and is house style
  // rather than correctness. What replaces it is the part that was always
  // load-bearing - name the RIGHT one, or write "a critic".
  assert.ok(rulesText.includes('You may name a critic, a scholar or the publication that ran them'))
  assert.ok(rulesText.includes('naming the wrong writer is worse than naming none'))
  assert.ok(
    !rulesText.includes('Never name a critic'),
    'the ban is not restated further down the rules'
  )
  // The base variant keeps its own ban, which is the whole point of a variant
  // and its version coexisting: both stay.
  assert.ok(compact.rules.join('\n').includes('Never name a critic'))

  // What did NOT change with it.
  for (const kept of [
    'Opinions belong in the reception answer',
    '"a reading", "an account" or "the press"',
    '"Critics" means more than one critic',
  ]) {
    assert.ok(rulesText.includes(kept), kept)
  }

  // 5: the documents rule names the phrasing that obeyed its letter.
  assert.ok(rulesText.includes('"the documents do not name"'))

  // BENCH 16: a paragraph-sized anchor, since a model cannot count 750 words,
  // and a critic's description of a maker's aim is not the maker speaking.
  assert.ok(rulesText.includes('about a hundred words'))
  assert.ok(making.includes('is the critic describing the film, not the director stating an aim'))

  // Everything NOT named above is the variant's own text, unchanged - which is
  // what lets a bench attribute a difference to the five corrections.
  const unchangedQuestions = (
    questions: readonly { id: string; text: string }[]
  ) => questions.filter((q) => q.id !== 'circumstances').map((q) => q.text)
  assert.deepEqual(unchangedQuestions(draft.movieQuestions), unchangedQuestions(compact.movieQuestions))
  assert.deepEqual(
    unchangedQuestions(draft.seriesQuestions),
    unchangedQuestions(compact.seriesQuestions)
  )
  assert.equal(
    draft.rules.filter((rule) => compact.rules.includes(rule)).length,
    compact.rules.length - 3,
    'exactly three rules replaced'
  )
})

/**
 * A VARIANT IS NOT A DRAFT and never becomes current: it is a second prompt for
 * a second class of model. Measured on Fear and Loathing in Las Vegas under
 * version 15, ornith-1.5-9b gave what the film is doing ONE paragraph and its
 * reception TWO - the one proportion the prompt states as a hard cap - and
 * dropped the performances, the sound and the cutting entirely.
 */
test('a variant varies its base version and does not displace it', () => {
  const compact = variantFor('compact')
  assert.equal(compact.base, ANALYSIS_PROMPT_VERSION)
  assert.ok(BENCH_PROMPT_VERSIONS.includes(compact.base))
  // Same question ids as the base, or every label its answers carry is
  // discarded by parseParagraphMap and every label-derived signal reads zero.
  assert.deepEqual(
    compact.movieQuestions.map((q) => q.id),
    questionIdsFor('movie')
  )
  assert.deepEqual(
    compact.seriesQuestions.map((q) => q.id),
    questionIdsFor('series')
  )
  assert.throws(() => variantFor('ornith'), /not available/)
})

test('a variant shares the documents, header and output contract with its base', () => {
  for (const mediaType of ['movie', 'series'] as const) {
    const base = buildAnalysisPrompt(subject({ originalTitle: 'Affeksjonsverdi', mediaType }), {
      mode: 'crw',
      sources: benchSources,
    })
    const compact = buildAnalysisPrompt(subject({ originalTitle: 'Affeksjonsverdi', mediaType }), {
      mode: 'crw',
      sources: benchSources,
      variant: 'compact',
    })
    assert.equal(aboveTask(compact), aboveTask(base), mediaType + ' above TASK')
    assert.equal(contract(compact), contract(base), mediaType + ' contract')
    assert.notEqual(compact, base)
  }
})

test('the compact variant is shorter than its base, and carries what it was written for', () => {
  const base = buildAnalysisPrompt(subject(), { mode: 'crw', sources: benchSources })
  const compact = buildAnalysisPrompt(subject(), {
    mode: 'crw',
    sources: benchSources,
    variant: 'compact',
  })
  const instructions = (p: string) =>
    p.slice(p.lastIndexOf('\nTASK\n'), p.indexOf('Output format.')).length
  // Being materially shorter IS the theory: a 9B model reads the first clause
  // of a long conditional and loses the rest.
  assert.ok(
    instructions(compact) < instructions(base) * 0.8,
    instructions(compact) + ' vs ' + instructions(base)
  )
  // Each of these answers something measured on that bench.
  assert.ok(compact.includes('Write five to nine paragraphs'), 'a budget it can follow')
  // The work-paragraph FLOOR caused padding on the Requiem bench - a fifth
  // paragraph restating the second, and one run that dropped the reception
  // answer to make room. A ceiling does what the floor was meant to.
  assert.ok(compact.includes('up to four on what it is doing'), 'a ceiling, not a floor')
  assert.ok(!compact.includes('three or four on what it is doing'))
  assert.ok(compact.includes('has come to be regarded as'), 'the hedge it reached for')
  assert.ok(compact.includes("encyclopedia's own summary of what critics think"), 'weak effects')
  assert.ok(compact.includes('Count the paragraphs you have written'), 'the map count')
  assert.ok(
    compact.includes('Where a maker describes what the film does to a viewer, use it here'),
    'the effect the base routes into the making answer'
  )
  // The base is untouched by any of it.
  assert.ok(!base.includes('Write five to nine paragraphs'))
})

test('bench choices put variants after the versions they vary', () => {
  assert.deepEqual(resolveBenchPromptChoices(), [
    { version: ANALYSIS_PROMPT_VERSION, variant: null },
  ])
  assert.deepEqual(resolveBenchPromptChoices([13, 7]), [
    { version: 7, variant: null },
    { version: 13, variant: null },
  ])
  assert.deepEqual(resolveBenchPromptChoices([ANALYSIS_PROMPT_VERSION], ['compact']), [
    { version: ANALYSIS_PROMPT_VERSION, variant: null },
    { version: ANALYSIS_PROMPT_VERSION, variant: 'compact' },
  ])
  // Variants alone run alone rather than dragging the current version in.
  assert.deepEqual(resolveBenchPromptChoices([], ['compact', 'compact']), [
    { version: ANALYSIS_PROMPT_VERSION, variant: 'compact' },
  ])
  assert.throws(() => resolveBenchPromptChoices([], ['nope']), /not available/)
  assert.equal(promptChoiceKey({ version: 15, variant: null }), '15')
  assert.equal(promptChoiceKey({ version: 15, variant: 'compact' }), '15:compact')
  assert.equal(promptChoiceLabel({ version: 15, variant: null }), 'v15')
  assert.equal(promptChoiceLabel({ version: 15, variant: 'compact' }), 'v15 compact')
})

/**
 * The library writer may send a variant, and the row records which one. The
 * base check is the load-bearing half: the writer stores
 * ANALYSIS_PROMPT_VERSION beside the prose, so a variant written for an older
 * version would file that version's questions under this one's number.
 */
test('a variant may write the library only while its base is the current version', () => {
  assert.equal(libraryVariantFor('compact')?.id, 'compact')
  assert.equal(libraryVariantFor(null), null)
  assert.equal(libraryVariantFor(undefined), null)
  assert.equal(libraryVariantFor(''), null)
  // Never throws: this answers a stored setting on the path that writes the
  // library, and refusing would fail every title in the run.
  assert.equal(libraryVariantFor('nope'), null)
  // The version moved past the one it varies.
  assert.equal(libraryVariantFor('compact', ANALYSIS_PROMPT_VERSION + 1), null)
})

test('every variant is offerable: an id, a label, a note and a base the bench carries', () => {
  assert.ok(BENCH_PROMPT_VARIANTS.length > 0)
  for (const variant of BENCH_PROMPT_VARIANTS) {
    assert.match(variant.id, /^[a-z][a-z0-9-]*$/)
    assert.ok(variant.label.length > 0 && variant.note.length > 0, variant.id)
    assert.ok(BENCH_PROMPT_VERSIONS.includes(variant.base), variant.id + ' base')
  }
})

test('the retrieval query names the film and asks for a review, nothing else', () => {
  // MEASURED on DuckDuckGo: "analysis criticism production history themes
  // style" returned moviesense.io, darkfilmtheories, itsreleased and arcplot -
  // three of them on sourceQuality's own low-value domain list - because those
  // words are the section headings of a generated analysis page. "review"
  // returns Ebert, the NYT, Metacritic and Wikipedia. Adding "analysis" back
  // to "review" is enough to put moviesense.io first again.
  const query = buildAnalysisQuery(subject({ title: 'Requiem for a Dream', year: 2000 }))
  assert.equal(query, 'Requiem for a Dream 2000 film review')
  for (const word of ['analysis', 'criticism', 'themes', 'style', 'essay', 'production']) {
    assert.ok(!query.includes(word), `"${word}" pulls generated pages and essay mills`)
  }
})
