/**
 * Intent routing: the no-LLM prefilter and the answer parser.
 *
 * These pin behaviour that shipped wrong and reached a user. A chat turn asking
 * "suggest film noir movies based on my history" was routed to 'library', which
 * removed the web-search tool from the turn entirely — so the assistant answered
 * a recommendation request with thirty films the user had already watched.
 *
 * Every case below is phrasing a person actually types. The prefilter is where
 * a bad decision is *unappealable* (no model ever sees the request), so it is
 * the part worth pinning hardest.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { prefilterIntent, parseIntent, latestUserText } from './routeIntent.js'

describe('prefilterIntent', () => {
  test('a personalized recommendation is discovery, not library', () => {
    // The exact request that regressed. It names the user's history AND asks
    // for suggestions; the suggestion is the answer, so it must reach the web
    // path — which is also the path that applies the taste brief.
    assert.equal(prefilterIntent('suggest film noir movies based on my history'), 'discovery')
    assert.equal(prefilterIntent('recommend something based on my taste'), 'discovery')
    assert.equal(prefilterIntent('what should I watch based on my history'), 'discovery')
    assert.equal(prefilterIntent('recommend a thriller from my library'), 'discovery')
  })

  test('a recommendation verb beats every library signal', () => {
    // No combination of collection words may strip the web search off a request
    // for something to watch.
    for (const text of [
      'suggest movies I have not watched',
      'recommend something, how many noir films are there',
      'find me something like my favourites',
    ]) {
      assert.equal(prefilterIntent(text), 'discovery', text)
    }
  })

  test('genuine collection questions stay library', () => {
    for (const text of [
      'what have I watched recently',
      'how many movies do I have',
      'do I have Inception',
      'what have I rated recently',
      'show me my watch history',
      'what should I continue watching',
    ]) {
      assert.equal(prefilterIntent(text), 'library', text)
    }
  })

  test('a taste statement is not a library question', () => {
    // "I like noir" describes the person, not their collection. Matching it as a
    // library signal is what let a bare pronoun hard-route past the classifier.
    assert.notEqual(prefilterIntent('I like noir, what is good'), 'library')
    assert.notEqual(prefilterIntent('I love westerns'), 'library')
    assert.notEqual(prefilterIntent('I watch a lot of horror'), 'library')
  })

  test('open-world requests are discovery', () => {
    assert.equal(prefilterIntent('best sci-fi of 2025'), 'discovery')
    assert.equal(prefilterIntent('movies like Heat'), 'discovery')
    assert.equal(prefilterIntent('what won an oscar this year'), 'discovery')
  })

  test('ambiguous requests defer to the classifier', () => {
    // null is not a failure — it is the prefilter declining to decide, which is
    // the only correct answer when both readings are live. A bare genre browse
    // ("neo noir movies") lands here too: no hint list catches it, and the
    // classifier is better at it than another regex would be.
    assert.equal(prefilterIntent('best movies I have not watched'), null)
    assert.equal(prefilterIntent('neo noir movies'), null)
    assert.equal(prefilterIntent(''), null)
  })
})

describe('parseIntent', () => {
  test('accepts a clean one-word answer with punctuation or casing', () => {
    assert.equal(parseIntent('discovery'), 'discovery')
    assert.equal(parseIntent('  Library.  '), 'library')
    assert.equal(parseIntent('"discovery"'), 'discovery')
  })

  test('reads a verbose answer that names only one intent', () => {
    assert.equal(parseIntent('This is a discovery request.'), 'discovery')
    assert.equal(parseIntent('I would classify this as library.'), 'library')
  })

  test('falls back to library when the answer is unusable', () => {
    // Deliberate: a malformed answer is a model malfunction, not a routing
    // doubt, and the discovery prompt would order a web search for a request
    // that may only have wanted a count.
    assert.equal(parseIntent(''), 'library')
    assert.equal(parseIntent('both discovery and library'), 'library')
    assert.equal(parseIntent('unrelated nonsense'), 'library')
  })
})

describe('latestUserText', () => {
  test('reads the most recent user message, ignoring assistant turns', () => {
    const messages = [
      { role: 'user', parts: [{ type: 'text', text: 'first' }] },
      { role: 'assistant', parts: [{ type: 'text', text: 'reply' }] },
      { role: 'user', parts: [{ type: 'text', text: 'second' }] },
    ]
    assert.equal(latestUserText(messages as never), 'second')
  })

  test('joins multiple text parts and skips non-text ones', () => {
    const messages = [
      {
        role: 'user',
        parts: [
          { type: 'text', text: 'noir' },
          { type: 'file', url: 'x' },
          { type: 'text', text: 'films' },
        ],
      },
    ]
    assert.equal(latestUserText(messages as never), 'noir  films')
  })

  test('returns empty string when there is no user text', () => {
    assert.equal(latestUserText([] as never), '')
    assert.equal(
      latestUserText([{ role: 'assistant', parts: [{ type: 'text', text: 'hi' }] }] as never),
      ''
    )
  })
})
