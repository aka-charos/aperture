import { test } from 'node:test'
import assert from 'node:assert/strict'
import { newTitleCount, proposalFrom, reachFrom, titleCardNode, titleChoicesFrom, titleIdsIn, toolErrorFrom } from './assistantParts'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'

test('title choices read both card shapes, once each, and skip episodes and junk', () => {
  const choices = titleChoicesFrom({
    items: [
      { id: A, type: 'movie', name: 'Heat', year: 1995, image: '/p.jpg', subtitle: 'New film' },
      { id: A, type: 'movie', name: 'Heat again' },
      { id: 'e1', type: 'series', name: 'Ep', episode: { seriesId: B } },
      { id: 'x', type: 'person', name: 'Someone' },
      'nonsense',
    ],
    carousels: [{ items: [{ id: B, type: 'series', title: 'Dark', posterUrl: '/d.jpg', value: '26 episodes' }] }],
  })
  assert.deepEqual(choices, [
    { id: A, mediaType: 'movie', title: 'Heat', year: 1995, posterUrl: '/p.jpg', subtitle: 'New film' },
    { id: B, mediaType: 'series', title: 'Dark', year: null, posterUrl: '/d.jpg', subtitle: '26 episodes' },
  ])
  assert.deepEqual(titleChoicesFrom(null), [])
  assert.deepEqual(titleChoicesFrom({ contentId: A }), [])
})

test('a chosen title becomes the same node the title picker inserts', () => {
  const node = titleCardNode(
    { id: A, mediaType: 'movie', title: 'Heat', year: 1995, posterUrl: null, subtitle: null },
    ['poster', 'plot']
  )
  assert.deepEqual(node, {
    type: 'titleCard',
    attrs: { mediaType: 'movie', id: A, title: 'Heat', year: 1995, posterUrl: null, fields: ['poster', 'plot'], analysisParts: [] },
  })
})

test('a proposal is read defensively; anything else is not one', () => {
  const proposal = proposalFrom({
    proposal: {
      subject: 'Hi',
      preheader: '',
      content: [{ type: 'paragraph' }, 'junk'],
      titles: [{ id: A, mediaType: 'movie', title: 'Heat' }, { id: B }],
      dropped: [{ index: 1, reason: 'unknownTitle' }],
      problem: null,
    },
  })
  assert.deepEqual(proposal, {
    subject: 'Hi',
    preheader: null,
    content: [{ type: 'paragraph' }],
    titles: [{ id: A, mediaType: 'movie', title: 'Heat' }],
    droppedCount: 1,
    problem: null,
    insertProblem: null,
  })
  assert.equal(proposalFrom({ items: [] }), null)
})

test('reach rows and tool failures', () => {
  assert.deepEqual(reachFrom({ titles: [{ id: A, title: 'Heat', canOpen: 2, of: 3 }, { id: B }] }), {
    rows: [{ id: A, title: 'Heat', canOpen: 2, of: 3 }],
    note: null,
  })
  assert.deepEqual(reachFrom({ note: 'No send groups' }), { rows: [], note: 'No send groups' })
  assert.equal(reachFrom({ items: [] }), null)
  assert.equal(toolErrorFrom({ id: 'x', error: 'boom' }), 'boom')
  assert.equal(toolErrorFrom({ items: [] }), null)
})

test('the titles already in a document are found at any depth', () => {
  const ids = titleIdsIn({
    type: 'doc',
    content: [
      { type: 'titleCard', attrs: { mediaType: 'movie', id: A } },
      { type: 'blockquote', content: [{ type: 'titleCard', attrs: { mediaType: 'series', id: B } }] },
    ],
  })
  assert.deepEqual([...ids], [`movie:${A}`, `series:${B}`])
})

test('only titles not already in the newsletter count toward its limit', () => {
  const proposal = {
    titles: [
      { id: A, mediaType: 'movie' as const, title: 'Heat' },
      { id: B, mediaType: 'series' as const, title: 'Dark' },
    ],
  }
  assert.equal(newTitleCount(proposal, new Set([`movie:${A}`])), 1)
  assert.equal(newTitleCount(proposal, new Set()), 2)
  // Same id, other media type: a different title.
  assert.equal(newTitleCount(proposal, new Set([`series:${A}`, `series:${B}`])), 1)
})
