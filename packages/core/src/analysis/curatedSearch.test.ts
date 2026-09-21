import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CURATED_CRITICISM_SITES,
  CURATED_TERMS,
  CURATED_QUERY_MAX_CHARS,
  buildCuratedQueries,
  distributeCuratedResults,
  mergeSearchResults,
} from './curatedSearch.js'

const r = (domain: string, url?: string) => ({ domain, url: url ?? `https://${domain}/a` })


test('every curated site is a bare host, never a URL', () => {
  for (const site of CURATED_CRITICISM_SITES) {
    assert.ok(!site.includes('://'), `${site} carries a scheme`)
    assert.ok(!site.startsWith('www.'), `${site} carries a www prefix`)
    assert.ok(!site.endsWith('/'), `${site} carries a trailing slash`)
  }
  assert.equal(new Set(CURATED_CRITICISM_SITES).size, CURATED_CRITICISM_SITES.length)
})

test('THE CONTRACT: every general result survives, criticism is added to them', () => {
  // The first version capped the merged list and cut the general search in
  // half to make room. Nothing the criticism search finds may cost a general
  // result - that is the whole difference between an addition and a swap.
  const general = [r('en.wikipedia.org'), r('imdb.com'), r('letterboxd.com')]
  const curated = [r('rogerebert.com'), r('mubi.com')]
  const merged = mergeSearchResults(curated, general)
  assert.equal(merged.length, 5)
  for (const g of general) {
    assert.ok(
      merged.some((m) => m.domain === g.domain),
      `${g.domain} survived`
    )
  }
})

test('criticism is ordered first, so a repeated title resolves in its favour', () => {
  const merged = mergeSearchResults([r('sensesofcinema.com')], [r('en.wikipedia.org')])
  assert.deepEqual(
    merged.map((m) => m.domain),
    ['sensesofcinema.com', 'en.wikipedia.org']
  )
})

test('an empty curated search leaves the general results exactly as they were', () => {
  const general = [r('en.wikipedia.org'), r('imdb.com')]
  assert.deepEqual(mergeSearchResults([], general), general)
})

test('a page found by both searches occupies one slot, not two', () => {
  const both = r('rogerebert.com', 'https://rogerebert.com/reviews/x')
  const merged = mergeSearchResults([both], [{ ...both }, r('en.wikipedia.org')])
  assert.deepEqual(
    merged.map((m) => m.domain),
    ['rogerebert.com', 'en.wikipedia.org']
  )
})

test('one article in two spellings is one page', () => {
  // Two searches routinely return the same article with and without the
  // scheme, the www, or the trailing slash.
  const merged = mergeSearchResults(
    [r('mubi.com', 'https://mubi.com/en/notebook/posts/x')],
    [
      r('mubi.com', 'http://www.mubi.com/en/notebook/posts/x/'),
      r('mubi.com', 'https://mubi.com/en/notebook/posts/other'),
    ]
  )
  assert.equal(merged.length, 2, 'the restated URL is dropped, the other page is not')
})

test('a result with no URL is deduplicated by domain', () => {
  const merged = mergeSearchResults(
    [{ domain: 'mubi.com', url: null }],
    [{ domain: 'MUBI.com' }, { domain: 'en.wikipedia.org' }]
  )
  assert.equal(merged.length, 2)
})

// The base query these lengths were measured against, so the test fails if the
// budget is ever raised past what DuckDuckGo was observed to accept.
const BASE = 'Requiem for a Dream 2000 film analysis criticism production history themes style'

test('MEASURED: every query fits inside what an engine accepts', () => {
  // DuckDuckGo refused 692 chars ("Search query entered was too long") and
  // refused 555; it answered 420 with the Roger Ebert review. A query over the
  // limit comes back as an EMPTY RESULT SET, not an error, so this is the
  // difference between the feature working and it reporting "nothing found"
  // on every title in the library.
  for (const q of buildCuratedQueries(BASE)) {
    assert.ok(q.length <= CURATED_QUERY_MAX_CHARS, `${q.length} chars is over budget`)
  }
  assert.ok(CURATED_QUERY_MAX_CHARS < 500, 'stays under the observed DuckDuckGo limit')
})

test('a long title still produces queries that fit', () => {
  // buildAnalysisQuery appends an original title for roughly a third of films,
  // so the base is not a fixed length - sitting just under the limit would
  // work on short titles and fail silently on long ones.
  const long = `${BASE} ${'Le Fabuleux Destin d Amelie Poulain '.repeat(3)}`
  for (const q of buildCuratedQueries(long)) {
    assert.ok(q.length <= CURATED_QUERY_MAX_CHARS || q.split(' OR ').length === 1)
  }
})

test('every curated site is asked about, across the queries', () => {
  const all = buildCuratedQueries(BASE).join(' ')
  for (const site of CURATED_CRITICISM_SITES) {
    assert.ok(all.includes(`site:${site}`), `${site} is never searched`)
  }
})

test('each query carries the base query and the term block', () => {
  const queries = buildCuratedQueries(BASE)
  assert.ok(queries.length > 1, 'twenty sites do not fit in one query')
  for (const q of queries) {
    assert.ok(q.startsWith(BASE), 'the title leads every query')
    for (const term of CURATED_TERMS) assert.ok(q.includes(term))
    // Two groups per query, or the engine reads the OR as spanning both.
    assert.equal(q.match(/\(/g)?.length, 2)
  }
})

test('the allowance totals exactly what was asked for', () => {
  // ceil() per query would scrape six pages to fill four slots, and crwSearch
  // scrapes what it finds, so that is two pages paid for and discarded.
  for (const [total, queries] of [
    [4, 3],
    [4, 2],
    [1, 3],
    [10, 4],
  ]) {
    const out = distributeCuratedResults(total, queries)
    assert.equal(out.length, queries)
    assert.equal(
      out.reduce((a, b) => a + b, 0),
      total,
      `${total} across ${queries}`
    )
  }
  assert.deepEqual(distributeCuratedResults(4, 3), [2, 1, 1], 'the remainder goes first')
  assert.deepEqual(distributeCuratedResults(0, 3), [], 'switched off asks nothing')
})
