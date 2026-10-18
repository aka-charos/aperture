import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { prepareChatPages, trimPageText } from './crwChatSearch.js'
import type { CrwSearchResultItem } from './crw.js'

const ARTICLE =
  'If you liked Heat, these crime films share its patient, procedural cool. ' +
  'Thief follows a safecracker who plans one last job with the same care Mann gives every heist. ' +
  'Collateral moves the duel between a professional and a man in his way into one Los Angeles night. ' +
  'The Insider trades the guns for a boardroom and keeps the pressure every bit as high. ' +
  'Each of them is built on characters who are defined by how well they do their work.\n\n' +
  'Ronin, from the same decade, is the closest in spirit, with car chases that feel engineered rather than staged. ' +
  'The Town borrows the bank-robbery structure and sets it in Boston with a crew bound by loyalty.'

function result(domain: string, markdown: string): CrwSearchResultItem {
  return { title: `${domain} page`, url: `https://${domain}/x`, domain, markdown }
}

describe('prepareChatPages', () => {
  it('keeps a real article and drops a bot wall', () => {
    const { pages, dropped } = prepareChatPages([
      result('films.example', ARTICLE),
      result('walled.example', 'Just a moment...\nPerforming security verification'),
    ])
    assert.deepEqual(pages.map((p) => p.domain), ['films.example'])
    assert.deepEqual(dropped, [{ domain: 'walled.example', reason: 'walled' }])
  })

  it('contributes nothing when every page is worthless, instead of failing open', () => {
    const { pages, dropped } = prepareChatPages([
      result('empty.example', ''),
      result('short.example', 'Loading'),
    ])
    assert.equal(pages.length, 0)
    assert.equal(dropped.length, 2)
  })

  it('keeps a list made only of linked titles, flattened to the titles', () => {
    // The shape `hasNoProse` and the navigation strip would remove: no
    // sentence anywhere, every line a link. For a recommendation it IS the answer.
    const list = Array.from(
      { length: 10 },
      (_, i) => `${i + 1}. [Film number ${i + 1} (198${i})](https://lists.example/film/${i + 1})`
    ).join('\n')
    const { pages, dropped } = prepareChatPages([result('lists.example', list)])
    assert.deepEqual(dropped, [])
    assert.equal(pages.length, 1)
    assert.match(pages[0].text, /^1\. Film number 1 \(1980\)$/m)
    assert.doesNotMatch(pages[0].text, /https?:\/\//)
  })

  it('drops a hand-listed low-value domain', () => {
    const { pages, dropped } = prepareChatPages([result('arcplot.com', ARTICLE)])
    assert.equal(pages.length, 0)
    assert.deepEqual(dropped, [{ domain: 'arcplot.com', reason: 'listed-domain' }])
  })

  it('trims each page to the character budget', () => {
    const { pages } = prepareChatPages([result('films.example', ARTICLE)], 300)
    assert.ok(pages[0].text.length <= 301)
  })
})

describe('trimPageText', () => {
  it('leaves a short page alone', () => {
    assert.equal(trimPageText('Short page.', 100), 'Short page.')
  })

  it('cuts at a paragraph end when one keeps at least half', () => {
    const text = `${'a'.repeat(70)}\n\n${'b'.repeat(70)}`
    assert.equal(trimPageText(text, 100), 'a'.repeat(70))
  })

  it('cuts at a sentence end when there is no paragraph break', () => {
    const text = `${'a'.repeat(60)}. ${'b'.repeat(60)}`
    assert.equal(trimPageText(text, 100), `${'a'.repeat(60)}.`)
  })

  it('falls back to a marked hard cut', () => {
    const text = 'x'.repeat(200)
    assert.equal(trimPageText(text, 100), `${'x'.repeat(100)}…`)
  })
})
