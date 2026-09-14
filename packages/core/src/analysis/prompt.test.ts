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
} from './prompt.js'
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
  assert.equal(q, 'Sentimental Value 2025 film analysis criticism production history themes style')
})

test('a different original title rides beside the localized one, before the year', () => {
  const q = buildAnalysisQuery(subject({ originalTitle: 'Affeksjonsverdi' }))
  assert.equal(
    q,
    'Sentimental Value Affeksjonsverdi 2025 film analysis criticism production history themes style'
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
  assert.ok(p.includes('What it went on to influence belongs to the reception question.'), p)
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
  assert.ok(p.includes('never an intention read back off the finished work'), p)
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
  assert.ok(p.includes('State facts plainly.'), p)
  assert.ok(p.includes('Never turn a view into a fact'), p)
  assert.ok(p.includes('"is described as"'), p)
  assert.ok(p.includes('"the sources carry"'), p)
  assert.ok(p.includes('Judgements of quality belong in the reception answer only.'), p)
})

test('paragraphs open on substance and a fact is told once', () => {
  const p = buildAnalysisPrompt(subject(), { mode: 'grounding' })
  assert.ok(p.includes('never with a restatement of the question'), p)
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
test('the prompt version carries the version-9 corrections', () => {
  assert.ok(ANALYSIS_PROMPT_VERSION >= 9, String(ANALYSIS_PROMPT_VERSION))
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
