import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  DRAFT_MAX_BLOCKS,
  buildDraftContent,
  describeDraftForModel,
  draftAnalysisParts,
  draftCardFields,
  draftTitleRefs,
  inlineNodes,
  insertProblem,
  type DraftTitleInfo,
} from './draft.js'
import { DEFAULT_TITLE_FIELDS, NEWSLETTER_MAX_TITLES, readNewsletterDocument, titleKey } from './document.js'

const MOVIE_ID = '11111111-1111-4111-8111-111111111111'
const SERIES_ID = '22222222-2222-4222-8222-222222222222'

const known = new Map<string, DraftTitleInfo>([
  [titleKey({ mediaType: 'movie', id: MOVIE_ID }), { title: 'Heat', year: 1995, posterUrl: '/p/heat.jpg' }],
  [titleKey({ mediaType: 'series', id: SERIES_ID }), { title: 'Dark', year: 2017, posterUrl: null }],
])

test('inline styling: bold, italic, http(s) links; other markers stay literal', () => {
  assert.deepEqual(inlineNodes('a **b** *c* _d_ [e](https://x.test/y)'), [
    { type: 'text', text: 'a ' },
    { type: 'text', text: 'b', marks: [{ type: 'bold' }] },
    { type: 'text', text: ' ' },
    { type: 'text', text: 'c', marks: [{ type: 'italic' }] },
    { type: 'text', text: ' ' },
    { type: 'text', text: 'd', marks: [{ type: 'italic' }] },
    { type: 'text', text: ' ' },
    { type: 'text', text: 'e', marks: [{ type: 'link', attrs: { href: 'https://x.test/y' } }] },
  ])
  // A link that is not http(s) keeps its label and loses the link.
  assert.deepEqual(inlineNodes('[click](javascript:alert(1))'), [{ type: 'text', text: 'click' }])
  // An address holding brackets, as Wikipedia film titles do, is not cut at the first `)`.
  assert.deepEqual(inlineNodes('See [Heat](https://en.wikipedia.org/wiki/Heat_(1995_film)).'), [
    { type: 'text', text: 'See ' },
    {
      type: 'text',
      text: 'Heat',
      marks: [{ type: 'link', attrs: { href: 'https://en.wikipedia.org/wiki/Heat_(1995_film)' } }],
    },
    { type: 'text', text: '.' },
  ])
  // An unclosed marker and snake_case words are plain text.
  assert.deepEqual(inlineNodes('**open and snake_case_name'), [{ type: 'text', text: '**open and snake_case_name' }])
  // Bold inside a link label carries both marks.
  assert.deepEqual(inlineNodes('[**big**](https://x.test)'), [
    {
      type: 'text',
      text: 'big',
      marks: [{ type: 'link', attrs: { href: 'https://x.test/' } }, { type: 'bold' }],
    },
  ])
})

test('blocks become the nodes the editor inserts, and read back as the email would', () => {
  const result = buildDraftContent(
    [
      { kind: 'heading', text: 'This month' },
      { kind: 'paragraph', text: 'First **para**.\n\nSecond, with a\nline break.' },
      { kind: 'bullets', items: ['one', '', null, 'two'] },
      { kind: 'numbered', items: ['first'] },
      { kind: 'quote', text: 'A line' },
      { kind: 'rule' },
      { kind: 'subheading', text: 'Picks\nacross lines' },
      { kind: 'title', titleId: MOVIE_ID, mediaType: 'movie' },
    ],
    known
  )
  assert.equal(result.problem, null)
  assert.deepEqual(result.dropped, [])
  assert.deepEqual(
    result.content.map((n) => n.type),
    ['heading', 'paragraph', 'paragraph', 'bulletList', 'orderedList', 'blockquote', 'horizontalRule', 'heading', 'titleCard']
  )
  assert.deepEqual(result.content[7].content, [{ type: 'text', text: 'Picks across lines' }])
  assert.deepEqual(result.content[2].content?.map((n) => n.type), ['text', 'hardBreak', 'text'])
  assert.equal(result.content[3].content?.length, 2)
  assert.deepEqual(result.content[8].attrs, {
    mediaType: 'movie',
    id: MOVIE_ID,
    title: 'Heat',
    year: 1995,
    posterUrl: '/p/heat.jpg',
    fields: [...DEFAULT_TITLE_FIELDS],
    analysisParts: [],
  })
  const parts = readNewsletterDocument({ type: 'doc', content: result.content })
  assert.deepEqual(
    parts.map((p) => p.type),
    ['heading', 'paragraph', 'paragraph', 'list', 'list', 'quote', 'rule', 'heading', 'titleRef']
  )
  assert.deepEqual(result.titles, [{ mediaType: 'movie', id: MOVIE_ID, title: 'Heat' }])
})

test('a title the caller did not find is dropped and reported, never inserted', () => {
  const result = buildDraftContent(
    [
      { kind: 'title', titleId: '33333333-3333-4333-8333-333333333333', mediaType: 'movie' },
      { kind: 'title', titleId: MOVIE_ID, mediaType: 'series' },
      { kind: 'title', titleId: 'not-a-uuid', mediaType: 'movie' },
      { kind: 'paragraph', text: 'kept' },
    ],
    known
  )
  assert.deepEqual(result.content.map((n) => n.type), ['paragraph'])
  assert.deepEqual(result.dropped.map((d) => d.reason), ['unknownTitle', 'unknownTitle', 'unknownTitle'])
  assert.match(describeDraftForModel(result, null), /not found in the library/)
})

test('empty text, unknown kinds and runaway lists are dropped by position', () => {
  const blocks = [
    { kind: 'paragraph', text: '   ' },
    { kind: 'table', text: 'x' },
    ...Array.from({ length: DRAFT_MAX_BLOCKS }, () => ({ kind: 'paragraph', text: 'p' })),
  ]
  const result = buildDraftContent(blocks, known)
  assert.equal(result.content.length, DRAFT_MAX_BLOCKS - 2)
  assert.deepEqual(
    result.dropped.map((d) => d.reason),
    ['empty', 'unknownKind', 'tooManyBlocks', 'tooManyBlocks']
  )
})

test('card fields keep only real fields, in card order; none means the defaults', () => {
  assert.deepEqual(draftCardFields(['plot', 'nonsense', 'poster']), ['poster', 'plot'])
  assert.deepEqual(draftCardFields(['nonsense']), [...DEFAULT_TITLE_FIELDS])
  assert.deepEqual(draftCardFields([]), [...DEFAULT_TITLE_FIELDS])
})

test('analysis parts apply only to a card showing the analysis, and only parts the type has', () => {
  assert.deepEqual(draftAnalysisParts('movie', ['poster'], ['work']), [])
  assert.deepEqual(draftAnalysisParts('movie', ['analysis'], ['reception', 'nonsense', 'work']), ['work', 'reception'])
  // A retired question id reads as the part that replaced it.
  assert.deepEqual(draftAnalysisParts('movie', ['analysis'], ['dispute']), ['reception'])
})

test('title refs are valid ids only, each once, lower-cased', () => {
  assert.deepEqual(
    draftTitleRefs([
      { kind: 'title', titleId: MOVIE_ID.toUpperCase(), mediaType: 'movie' },
      { kind: 'title', titleId: MOVIE_ID, mediaType: 'movie' },
      { kind: 'title', titleId: SERIES_ID, mediaType: 'series' },
      { kind: 'title', titleId: SERIES_ID, mediaType: 'episode' },
      { kind: 'paragraph', titleId: MOVIE_ID, mediaType: 'movie' },
    ]),
    [
      { mediaType: 'movie', id: MOVIE_ID },
      { mediaType: 'series', id: SERIES_ID },
    ]
  )
})

test('more titles than a newsletter may show are dropped past the limit', () => {
  const many = new Map<string, DraftTitleInfo>()
  const blocks = Array.from({ length: NEWSLETTER_MAX_TITLES + 2 }, (_, i) => {
    const id = `44444444-4444-4444-8444-${String(i).padStart(12, '0')}`
    many.set(titleKey({ mediaType: 'movie', id }), { title: `T${i}`, year: null, posterUrl: null })
    return { kind: 'title', titleId: id, mediaType: 'movie' }
  })
  const result = buildDraftContent(blocks, many)
  assert.equal(result.titles.length, NEWSLETTER_MAX_TITLES)
  assert.equal(result.dropped.filter((d) => d.reason === 'tooManyTitles').length, 2)
  assert.equal(result.problem, null)
})

test('inserting next to what is there is checked against the limits as one document', () => {
  const card = (i: number) => ({
    type: 'titleCard',
    attrs: { mediaType: 'movie', id: `55555555-5555-4555-8555-${String(i).padStart(12, '0')}` },
  })
  const current = { type: 'doc', content: Array.from({ length: NEWSLETTER_MAX_TITLES - 1 }, (_, i) => card(i)) }
  assert.equal(insertProblem(current, [card(100)]), null)
  assert.match(insertProblem(current, [card(100), card(101)]) ?? '', /at most/)
  assert.equal(insertProblem(current, []), null)
  // Anything that is not a document counts as empty.
  assert.equal(insertProblem(null, [card(1)]), null)
  const result = buildDraftContent([{ kind: 'paragraph', text: 'x' }], known)
  assert.match(describeDraftForModel(result, null, 'too many titles'), /only Replace is offered/)
})

test('the model is told the draft is a preview, not inserted', () => {
  const result = buildDraftContent([{ kind: 'title', titleId: SERIES_ID, mediaType: 'series' }], known)
  const text = describeDraftForModel(result, 'Hello')
  assert.match(text, /NOT in the newsletter/)
  assert.match(text, /Suggested subject: Hello/)
  assert.match(text, /Dark/)
})
