import test from 'node:test'
import assert from 'node:assert/strict'

import {
  decideAnalysisFloor,
  isListingDomain,
  MIN_SUBSTANTIVE_SOURCES,
  MIN_SUBSTANTIVE_SOURCE_CHARS,
  type RetrievedSource,
} from './sourceFloor.js'

const longText = 'A'.repeat(1200)

/** N healthy documents from places people write. */
const goodSources = (n: number): RetrievedSource[] =>
  Array.from({ length: n }, (_, i) => ({
    domain: `journal${i}.example.org`,
    chars: MIN_SUBSTANTIVE_SOURCE_CHARS * 3,
  }))

test('a substantial answer over real sources is kept', () => {
  assert.deepEqual(
    decideAnalysisFloor({ text: longText, grade: 'substantial', sources: goodSources(4) }),
    { store: true }
  )
})

test("the model's own 'almost-nothing' outranks any amount of retrieval", () => {
  // Volume measures obscurity, the grade measures depth: a widely-listed
  // blockbuster returns plenty of pages carrying no analytical writing at all.
  assert.deepEqual(
    decideAnalysisFloor({ text: longText, grade: 'almost-nothing', sources: goodSources(12) }),
    { store: false, reason: 'thin_sources' }
  )
})

test('too few documents declines as thin sources', () => {
  assert.deepEqual(
    decideAnalysisFloor({
      text: longText,
      grade: 'substantial',
      sources: goodSources(MIN_SUBSTANTIVE_SOURCES - 1),
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
      sources: goodSources(MIN_SUBSTANTIVE_SOURCES),
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
  assert.deepEqual(decideAnalysisFloor({ text: longText, grade: 'substantial', sources: stubs }), {
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
    decideAnalysisFloor({ text: longText, grade: 'substantial', sources: listings }),
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
  assert.deepEqual(decideAnalysisFloor({ text: longText, grade: 'substantial', sources: mixed }), {
    store: true,
  })
})

test('a short answer over good sources is the model taking the exit', () => {
  assert.deepEqual(
    decideAnalysisFloor({
      text: 'There is little of formal interest here. It is a competently made romantic comedy.',
      grade: 'reviews-only',
      sources: goodSources(5),
    }),
    { store: false, reason: 'no_distinctive_craft' }
  )
})

test('short AND unsourced is reported as the sourcing problem', () => {
  // Ordering matters: the retrieval failure is the likelier cause and the more
  // actionable report.
  assert.deepEqual(decideAnalysisFloor({ text: 'Nothing found.', grade: null, sources: [] }), {
    store: false,
    reason: 'thin_sources',
  })
})

test('a missing SOURCES line costs the signal, not the analysis', () => {
  // A smaller local model is likelier to drift on an exact output format than
  // on the writing itself, so a null grade must never be read as a decline.
  assert.deepEqual(
    decideAnalysisFloor({ text: longText, grade: null, sources: goodSources(3) }),
    { store: true }
  )
})

test('an empty response declines rather than storing blank prose', () => {
  const decision = decideAnalysisFloor({
    text: '   ',
    grade: 'substantial',
    sources: goodSources(5),
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
