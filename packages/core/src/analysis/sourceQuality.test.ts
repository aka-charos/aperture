import assert from 'node:assert/strict'
import { test } from 'node:test'

import { dropLowValueSources, isNavigationPage } from './sourceQuality.js'

const prose = (lines: number) =>
  Array.from(
    { length: lines },
    (_, i) =>
      `The film's ${i} choice is described at length here, and the paragraph runs on for a while.`
  ).join('\n\n')

const source = (domain: string, text = prose(6)) => ({ domain, text })

test('a listed domain is dropped, with its subdomains and none of its lookalikes', () => {
  const { kept, dropped } = dropLowValueSources([
    source('arcplot.com'),
    source('www.shapes.inc'),
    source('en.wikipedia.org'),
    source('notarcplot.com'),
    source('sensesofcinema.com'),
  ])
  assert.deepEqual(
    kept.map((s) => s.domain),
    ['en.wikipedia.org', 'notarcplot.com', 'sensesofcinema.com']
  )
  assert.deepEqual(dropped, [
    { domain: 'arcplot.com', reason: 'listed-domain' },
    { domain: 'www.shapes.inc', reason: 'listed-domain' },
  ])
})

/**
 * The measured page: 8,607 characters of site navigation - Singapore
 * influencer marketing, FRM course fees - and not one sentence about the film,
 * which is 13% of the retrieval budget spent on a menu.
 */
test('a page that is mostly stand-alone links is a menu', () => {
  const menu = Array.from(
    { length: 30 },
    (_, i) => `[![](https://example.com/thumb-${i}.png)](https://example.com/post-${i} "Post ${i}")`
  ).join('\n')
  assert.equal(isNavigationPage(menu), true)
  assert.equal(isNavigationPage(`${menu}\n\n${prose(2)}`), true, 'a little prose does not rescue it')
})

/**
 * THE TRAP THIS IS SHAPED AROUND. Wikipedia's markdown is more than half link
 * CHARACTERS - every proper noun in every sentence is one - so a link-density
 * measure drops the best document in the set. What separates a menu is that its
 * links stand alone on their own lines.
 */
test('a prose page dense with inline links is not a menu', () => {
  const encyclopedia = Array.from(
    { length: 12 },
    () =>
      'It was directed by [Darren Aronofsky](https://en.wikipedia.org/wiki/Darren_Aronofsky "Darren Aronofsky") and written with [Hubert Selby Jr.](https://en.wikipedia.org/wiki/Hubert_Selby_Jr. "Hubert Selby Jr."), based on his [1978 novel](https://en.wikipedia.org/wiki/Requiem "novel").'
  ).join('\n\n')
  assert.equal(isNavigationPage(encyclopedia), false)
  // A short list of links is not enough on its own, for blockedPage's reason:
  // losing a real article to a heuristic costs more than keeping a menu.
  assert.equal(isNavigationPage('[one](https://a.example)\n[two](https://b.example)'), false)
})

test('nothing is dropped when dropping would leave nothing', () => {
  const only = [source('arcplot.com'), source('shapes.inc')]
  const { kept, dropped } = dropLowValueSources(only)
  assert.equal(kept.length, 2, 'a thin retrieval is the floor’s decision, not this module’s')
  assert.deepEqual(dropped, [])
})

test('an empty retrieval is left alone rather than reported as dropped', () => {
  assert.deepEqual(dropLowValueSources([]), { kept: [], dropped: [] })
})
