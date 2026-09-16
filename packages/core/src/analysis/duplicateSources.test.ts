/**
 * One page per title, but never at the cost of a different page.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { dropDuplicateTitles } from './duplicateSources.js'

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
