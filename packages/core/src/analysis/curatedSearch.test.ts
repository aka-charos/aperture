import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CURATED_CRITICISM_SITES,
  CURATED_TERMS,
  buildCuratedQuery,
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
