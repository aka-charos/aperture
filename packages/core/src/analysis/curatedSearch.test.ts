import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CURATED_CRITICISM_SITES,
  CURATED_TERMS,
  buildCuratedQuery,
  curatedSlots,
  mergeSearchResults,
} from './curatedSearch.js'

const r = (domain: string, url?: string) => ({ domain, url: url ?? `https://${domain}/a` })

test('the curated query is the general query plus two disjunctions', () => {
  const q = buildCuratedQuery('Possession 1981')
  assert.ok(q.startsWith('Possession 1981 '), 'the general query leads, unchanged')
  assert.ok(q.includes('site:rogerebert.com OR site:sensesofcinema.com'))
  // A path is part of the operator, not a separate term.
  assert.ok(q.includes('site:bfi.org.uk/sight-and-sound'))
  for (const term of CURATED_TERMS) assert.ok(q.includes(term), `${term} is asked for`)
  // Two groups, both parenthesised, or the engine reads the OR as spanning both.
  assert.equal(q.match(/\(/g)?.length, 2)
  assert.equal(q.match(/\)/g)?.length, 2)
})

test('every curated site is a bare host, never a URL', () => {
  for (const site of CURATED_CRITICISM_SITES) {
    assert.ok(!site.includes('://'), `${site} carries a scheme`)
    assert.ok(!site.startsWith('www.'), `${site} carries a www prefix`)
    assert.ok(!site.endsWith('/'), `${site} carries a trailing slash`)
  }
  assert.equal(new Set(CURATED_CRITICISM_SITES).size, CURATED_CRITICISM_SITES.length)
})

test('criticism is never RESERVED more than half the list', () => {
  // The general search is what carries Wikipedia, and every checkable fact in
  // an analysis comes from there. Rounding up would hand criticism the only
  // slot at a maxResults of 1, and the majority of an odd-sized list.
  for (let limit = 0; limit <= 20; limit += 1) {
    assert.ok(curatedSlots(limit) <= limit / 2, `${limit} reserves too many`)
  }
  assert.equal(curatedSlots(1), 0, 'one slot belongs to the general search')
  assert.equal(curatedSlots(6), 3)
  assert.equal(curatedSlots(7), 3)
  // A share of zero turns the second search off without special-casing it.
  assert.equal(curatedSlots(6, 0), 0)
})

test('the slots asked for are exactly the slots the merge will keep', () => {
  // One decision read twice: a request bigger than the reservation pays to
  // scrape pages the merge then discards, a smaller one makes the reservation
  // unreachable. Asking for `curatedSlots(n)` results and merging into n must
  // leave every one of them in place when the general search is full.
  for (const limit of [2, 3, 6, 9, 20]) {
    const asked = curatedSlots(limit)
    const curated = Array.from({ length: asked }, (_, i) => r(`crit${i}.com`))
    const general = Array.from({ length: limit }, (_, i) => r(`gen${i}.com`))
    const merged = mergeSearchResults(curated, general, { limit })
    assert.equal(merged.length, limit)
    assert.equal(
      merged.filter((m) => m.domain.startsWith('crit')).length,
      asked,
      `every page fetched at limit ${limit} was kept`
    )
  }
})

test('criticism takes its reserved slots and general fills the rest', () => {
  const curated = [r('rogerebert.com'), r('mubi.com'), r('cineaste.com')]
  const general = [r('wikipedia.org'), r('imdb.com'), r('letterboxd.com')]
  const merged = mergeSearchResults(curated, general, { limit: 4 })
  assert.deepEqual(
    merged.map((m) => m.domain),
    ['rogerebert.com', 'mubi.com', 'wikipedia.org', 'imdb.com']
  )
})

test('an empty curated search leaves the general results exactly as they were', () => {
  const general = [r('wikipedia.org'), r('imdb.com')]
  assert.deepEqual(mergeSearchResults([], general, { limit: 6 }), general)
})

test('either side takes the slots the other cannot fill', () => {
  const curated = [r('rogerebert.com'), r('mubi.com'), r('cineaste.com'), r('offscreen.com')]
  // Reserved is 2 of 4, but the general search only has one answer, so
  // criticism takes the rest rather than the list coming back short.
  const merged = mergeSearchResults(curated, [r('wikipedia.org')], { limit: 4 })
  assert.equal(merged.length, 4)
  assert.equal(merged.filter((m) => m.domain === 'wikipedia.org').length, 1)
})

test('a page found by both searches occupies one slot, not two', () => {
  const both = r('rogerebert.com', 'https://rogerebert.com/reviews/x')
  const merged = mergeSearchResults([both], [{ ...both }, r('wikipedia.org')], { limit: 5 })
  assert.deepEqual(
    merged.map((m) => m.domain),
    ['rogerebert.com', 'wikipedia.org']
  )
})

test('one article in two spellings is one page', () => {
  // Two searches routinely return the same article with and without the scheme,
  // the www, or the trailing slash.
  const merged = mergeSearchResults(
    [r('mubi.com', 'https://mubi.com/en/notebook/posts/x')],
    [
      r('mubi.com', 'http://www.mubi.com/en/notebook/posts/x/'),
      r('mubi.com', 'https://mubi.com/en/notebook/posts/other'),
    ],
    { limit: 5 }
  )
  assert.equal(merged.length, 2, 'the restated URL is dropped, the other page is not')
})

test('a result with no URL is deduplicated by domain', () => {
  const merged = mergeSearchResults(
    [{ domain: 'mubi.com', url: null }],
    [{ domain: 'MUBI.com' }, { domain: 'wikipedia.org' }],
    { limit: 5 }
  )
  assert.equal(merged.length, 2)
})

test('the merged list never exceeds the limit the general search used', () => {
  const many = Array.from({ length: 12 }, (_, i) => r(`crit${i}.com`))
  assert.equal(mergeSearchResults(many, many, { limit: 5 }).length, 5)
  assert.deepEqual(mergeSearchResults(many, many, { limit: 0 }), [])
})
