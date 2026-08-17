import test from 'node:test'
import assert from 'node:assert/strict'

import {
  decideAnalysisFloor,
  isListingDomain,
  MIN_GROUNDING_CHUNKS,
  MIN_SUBSTANTIVE_SOURCES,
  MIN_SUBSTANTIVE_SOURCE_CHARS,
  type RetrievalEvidence,
  type RetrievedSource,
} from './sourceFloor.js'

const longText = 'A'.repeat(1200)

/** N healthy documents from places people write. */
const goodSources = (n: number): RetrievedSource[] =>
  Array.from({ length: n }, (_, i) => ({
    domain: `journal${i}.example.org`,
    chars: MIN_SUBSTANTIVE_SOURCE_CHARS * 3,
  }))

/** Self-hosted retrieval: whole documents, so domain and size are known. */
const crw = (sources: RetrievedSource[]): RetrievalEvidence => ({ mode: 'crw', sources })

/** Native grounding: only a chunk count is ever disclosed. */
const grounded = (chunkCount: number): RetrievalEvidence => ({ mode: 'grounding', chunkCount })

test('a substantial answer over real sources is kept', () => {
  assert.deepEqual(
    decideAnalysisFloor({ text: longText, grade: 'substantial', evidence: crw(goodSources(4)) }),
    { store: true }
  )
})

test("the model's own 'almost-nothing' outranks any amount of retrieval", () => {
  // Volume measures obscurity, the grade measures depth: a widely-listed
  // blockbuster returns plenty of pages carrying no analytical writing at all.
  assert.deepEqual(
    decideAnalysisFloor({ text: longText, grade: 'almost-nothing', evidence: crw(goodSources(12)) }),
    { store: false, reason: 'thin_sources' }
  )
})

test('too few documents declines as thin sources', () => {
  assert.deepEqual(
    decideAnalysisFloor({
      text: longText,
      grade: 'substantial',
      evidence: crw(goodSources(MIN_SUBSTANTIVE_SOURCES - 1)),
    }),
    { store: false, reason: 'thin_sources' }
  )
})

test('exactly the minimum is enough — the bar errs toward keeping', () => {
  // A decline is stored and retires the title until the prompt version moves;
  // a mediocre keep can be re-run behind a higher floor. The asymmetry is the
  // whole reason this threshold is low.
  assert.deepEqual(
    decideAnalysisFloor({
      text: longText,
      grade: 'substantial',
      evidence: crw(goodSources(MIN_SUBSTANTIVE_SOURCES)),
    }),
    { store: true }
  )
})

test('stub pages do not count as documents', () => {
  // Six fetches that each returned a nav shell or a consent wall is a failed
  // retrieval, not six sources.
  const stubs: RetrievedSource[] = Array.from({ length: 6 }, (_, i) => ({
    domain: `journal${i}.example.org`,
    chars: MIN_SUBSTANTIVE_SOURCE_CHARS - 1,
  }))
  assert.deepEqual(decideAnalysisFloor({ text: longText, grade: 'substantial', evidence: crw(stubs) }), {
    store: false,
    reason: 'thin_sources',
  })
})

test('plenty of text from nothing but listing sites is not sourcing', () => {
  // The failure that only became visible with in-house retrieval: for an
  // obscure title a metasearch returns IMDb, JustWatch and some "where to
  // watch" SEO. High volume, zero criticism — and a count-based floor reads it
  // as healthy.
  const listings: RetrievedSource[] = [
    { domain: 'imdb.com', chars: 9000 },
    { domain: 'www.justwatch.com', chars: 7000 },
    { domain: 'tv.apple.com', chars: 4000 },
  ]
  assert.deepEqual(
    decideAnalysisFloor({ text: longText, grade: 'substantial', evidence: crw(listings) }),
    { store: false, reason: 'thin_sources' }
  )
})

test('one real source among listings is enough to keep', () => {
  // The rule fires only when EVERY substantive source is a listing, because a
  // false positive here retires a title permanently.
  const mixed: RetrievedSource[] = [
    { domain: 'imdb.com', chars: 9000 },
    { domain: 'sensesofcinema.com', chars: 4000 },
  ]
  assert.deepEqual(decideAnalysisFloor({ text: longText, grade: 'substantial', evidence: crw(mixed) }), {
    store: true,
  })
})

test('a short answer over good sources is the model taking the exit', () => {
  assert.deepEqual(
    decideAnalysisFloor({
      text: 'There is little of formal interest here. It is a competently made romantic comedy.',
      grade: 'reviews-only',
      evidence: crw(goodSources(5)),
    }),
    { store: false, reason: 'no_distinctive_craft' }
  )
})

test('short AND unsourced is reported as the sourcing problem', () => {
  // Ordering matters: the retrieval failure is the likelier cause and the more
  // actionable report.
  assert.deepEqual(decideAnalysisFloor({ text: 'Nothing found.', grade: null, evidence: crw([]) }), {
    store: false,
    reason: 'thin_sources',
  })
})

test('a missing SOURCES line costs the signal, not the analysis', () => {
  // A smaller local model is likelier to drift on an exact output format than
  // on the writing itself, so a null grade must never be read as a decline.
  assert.deepEqual(
    decideAnalysisFloor({ text: longText, grade: null, evidence: crw(goodSources(3)) }),
    { store: true }
  )
})

test('an empty response declines rather than storing blank prose', () => {
  const decision = decideAnalysisFloor({
    text: '   ',
    grade: 'substantial',
    evidence: crw(goodSources(5)),
  })
  assert.equal(decision.store, false)
})

test('listing domains match on host and subdomain, never on substring', () => {
  assert.equal(isListingDomain('imdb.com'), true)
  assert.equal(isListingDomain('www.imdb.com'), true)
  assert.equal(isListingDomain('m.imdb.com'), true)
  assert.equal(isListingDomain('IMDB.COM'), true)

  // Would match a naive `includes`, and is somebody's blog.
  assert.equal(isListingDomain('notimdb.com'), false)
  assert.equal(isListingDomain('imdb.com.example.net'), false)

  assert.equal(isListingDomain('sensesofcinema.com'), false)
  assert.equal(isListingDomain(''), false)
})

test('grounded mode judges on chunk count, since it gets nothing else', () => {
  assert.deepEqual(
    decideAnalysisFloor({ text: longText, grade: 'substantial', evidence: grounded(7) }),
    { store: true }
  )
  assert.deepEqual(
    decideAnalysisFloor({
      text: longText,
      grade: 'substantial',
      evidence: grounded(MIN_GROUNDING_CHUNKS - 1),
    }),
    { store: false, reason: 'thin_sources' }
  )
})

test('the listing rule cannot fire under grounding, because domains are hidden', () => {
  // Google returns expiring redirect URLs, so there is no domain to judge. A
  // grounded answer over plenty of chunks is kept even though the same volume
  // of pure listings would be refused on the self-hosted path — the evidence
  // genuinely differs, which is why the two are not flattened into one shape.
  assert.deepEqual(
    decideAnalysisFloor({ text: longText, grade: 'substantial', evidence: grounded(20) }),
    { store: true }
  )
})

test("the model's verdict still outranks retrieval in grounded mode", () => {
  // It is very nearly the only signal there is here, which is why it is checked
  // before the mode split rather than inside either branch.
  assert.deepEqual(
    decideAnalysisFloor({ text: longText, grade: 'almost-nothing', evidence: grounded(30) }),
    { store: false, reason: 'thin_sources' }
  )
})

test('a short grounded answer is the exit, not a retrieval failure', () => {
  assert.deepEqual(
    decideAnalysisFloor({ text: 'Not much to say.', grade: 'reviews-only', evidence: grounded(9) }),
    { store: false, reason: 'no_distinctive_craft' }
  )
})

test('places that carry writing are deliberately not listings', () => {
  // Wikipedia has real production and reception sections; RT and Metacritic
  // carry critic blurbs, which is exactly what "what do critics disagree about"
  // is answered from.
  for (const domain of [
    'en.wikipedia.org',
    'rottentomatoes.com',
    'metacritic.com',
    'letterboxd.com',
  ]) {
    assert.equal(isListingDomain(domain), false, `${domain} should not be treated as a listing`)
  }
})
