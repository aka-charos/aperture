/**
 * One page per title, but never at the cost of a different page.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { dropDuplicateTitles, keepOnePerDomain } from './duplicateSources.js'

const page = (title: string, domain: string, text: string) => ({ title, domain, text })
const FILM = ['Control', 'Kontroll', '2003']

test('the same chapter from two sites is kept once, the longer copy in the first place', () => {
  const chapter = 'Inhabiting the Post-Communist (Kontroll. Nimród Antal, 2003)'
  const { kept, dropped } = dropDuplicateTitles(
    [
      page('Nimród Antal’s Kontroll (2003) - East European Film Bulletin', 'eefb.org', 'Review.'),
      page(chapter, 'academia.edu', 'Short abstract.'),
      page('The Politics of Post-Socialist Colour', 'framescinemajournal.com', 'Essay.'),
      page(chapter, 'link.springer.com', 'A longer abstract and references.'),
    ],
    FILM
  )
  assert.deepEqual(
    kept.map((source) => source.domain),
    ['eefb.org', 'link.springer.com', 'framescinemajournal.com']
  )
  assert.deepEqual(dropped.map((source) => source.domain), ['academia.edu'])
})

test('case and spacing do not make a title different', () => {
  const { kept } = dropDuplicateTitles(
    [
      page('Inhabiting the Post-Communist  (Kontroll)', 'a.org', 'One.'),
      page('inhabiting the post-communist (kontroll)', 'b.org', 'Two.'),
    ],
    FILM
  )
  assert.equal(kept.length, 1)
})

// The asymmetric half: two different reviews sharing a bare title must both
// survive, since dropping one loses a source nobody would notice was lost.
test('a title that is only the film name is never treated as a duplicate', () => {
  const { kept, dropped } = dropDuplicateTitles(
    [
      page('Control (2003) - Review', 'one.com', 'First review.'),
      page('Control (2003) - Review', 'two.com', 'A different review.'),
      page('Kontroll', 'three.com', 'Third.'),
      page('Kontroll', 'four.com', 'Fourth.'),
    ],
    FILM
  )
  assert.equal(kept.length, 4)
  assert.equal(dropped.length, 0)
})

test('an empty title is never a duplicate, and distinct titles pass untouched', () => {
  const sources = [
    page('', 'a.org', 'One.'),
    page('', 'b.org', 'Two.'),
    page('A long essay about subway cinema in Budapest', 'c.org', 'Three.'),
  ]
  const { kept, dropped } = dropDuplicateTitles(sources, FILM)
  assert.deepEqual(kept, sources)
  assert.deepEqual(dropped, [])
})

/**
 * The second Requiem bench spent four of eleven slots on two hosts - imdb.com
 * twice and rogerebert.com twice - and one of those four had already been shown
 * to be worthless. The first page from a host is the best-ranked one it
 * offered, since the order here is relevance order with criticism ahead of it.
 */
test('a second page from a host already represented is dropped', () => {
  const sources = [
    { domain: 'rogerebert.com', title: 'Requiem for a Dream movie review', text: 'A review.' },
    { domain: 'en.wikipedia.org', title: 'Requiem for a Dream - Wikipedia', text: 'An article.' },
    { domain: 'www.rogerebert.com', title: 'Darren Aronofsky Movies and TV Shows', text: 'An index.' },
    { domain: 'imdb.com', title: 'Metacritic reviews - IMDb', text: 'Quotes.' },
    { domain: 'imdb.com', title: 'Requiem for a Dream (2000) - IMDb', text: 'A menu.' },
  ]
  const { kept, dropped } = keepOnePerDomain(sources)
  assert.deepEqual(
    kept.map((k) => k.title),
    [
      'Requiem for a Dream movie review',
      'Requiem for a Dream - Wikipedia',
      'Metacritic reviews - IMDb',
    ]
  )
  assert.deepEqual(dropped, [{ domain: 'www.rogerebert.com' }, { domain: 'imdb.com' }])
})

/**
 * The host is the key, not the registrable domain: telling framerated.co.uk
 * from bbc.co.uk needs a public-suffix list, and two subdomains of one site are
 * two different articles.
 */
test('subdomains are different hosts, and www is not one', () => {
  const sources = [
    { domain: 'en.wikipedia.org', title: 'A', text: 'x' },
    { domain: 'simple.wikipedia.org', title: 'B', text: 'y' },
    { domain: 'framerated.co.uk', title: 'C', text: 'z' },
    { domain: 'bbc.co.uk', title: 'D', text: 'w' },
  ]
  assert.equal(keepOnePerDomain(sources).kept.length, 4)
  assert.equal(
    keepOnePerDomain([
      { domain: 'www.imdb.com', title: 'A', text: 'x' },
      { domain: 'imdb.com', title: 'B', text: 'y' },
    ]).kept.length,
    1
  )
})
