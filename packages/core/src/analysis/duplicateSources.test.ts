/**
 * One page per title, but never at the cost of a different page.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  dropDuplicateContent,
  dropDuplicateTitles,
  keepOnePerDomain,
} from './duplicateSources.js'

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

/**
 * The Kontroll case the title test was written for, republished under a
 * different headline so the title cannot see it. Each site wraps it in its own
 * furniture, which is the reason the header gives for not comparing whole
 * texts - and exactly what shingles ignore.
 */
test('a page whose text is inside another page is a duplicate, wrapper or no', () => {
  const chapter = Array.from(
    { length: 40 },
    (_, i) =>
      `The film places its camera inside the apartment and holds there for a long ${i} beat before cutting away.`
  ).join(' ')
  // academia.edu carries the chapter AND a page of unrelated related papers, so
  // it is the longer of the two and the one kept.
  const related = Array.from(
    { length: 20 },
    (_, i) => `Related paper number ${i} on an entirely unconnected subject in another discipline.`
  ).join(' ')
  const sources = [
    { domain: 'publisher.example', title: 'Inhabiting the Post-Communist', text: 'Buy this book. ' + chapter },
    { domain: 'academia.edu', title: 'A completely different headline', text: chapter + ' ' + related },
  ]
  const { kept, dropped } = dropDuplicateContent(sources)
  assert.deepEqual(kept.map((k) => k.domain), ['academia.edu'])
  assert.deepEqual(dropped, [{ domain: 'publisher.example', duplicateOf: 'academia.edu' }])
})

/**
 * NOT A DE-OVERLAP. Measured on Requiem for a Dream: metacritic.com and IMDb's
 * Metacritic mirror carried five and ten critic quotes with ONE in common,
 * because each page had been truncated at a different point. They look like
 * duplicates by name and by source and are complementary in fact - the mirror
 * was the densest criticism in the retrieval.
 */
test('two pages excerpting the same pool differently both survive', () => {
  const quote = (n: number) =>
    `Critic number ${n} wrote that the film brings a new urgency to its subject and never lets the viewer settle.`
  const metacritic = [quote(1), quote(2), quote(3), quote(4), quote(5)].join('\n\n')
  const mirror = [quote(5), quote(6), quote(7), quote(8), quote(9), quote(10)].join('\n\n')
  const { kept, dropped } = dropDuplicateContent([
    { domain: 'metacritic.com', title: 'Reviews', text: metacritic },
    { domain: 'imdb.com', title: 'Metacritic reviews', text: mirror },
  ])
  assert.equal(kept.length, 2)
  assert.deepEqual(dropped, [])
})

test('two reviews of one film are not duplicates', () => {
  const a =
    'Requiem for a Dream is a 2000 film by Darren Aronofsky. The closeups fill the screen with pills and the sound is exaggerated throughout every sequence.'
  const b =
    'Requiem for a Dream is a 2000 film by Darren Aronofsky. Its three seasonal movements mark how far each of the four characters has fallen by the end.'
  assert.equal(dropDuplicateContent([
    { domain: 'a.example', title: 'A', text: a },
    { domain: 'b.example', title: 'B', text: b },
  ]).kept.length, 2)
})
