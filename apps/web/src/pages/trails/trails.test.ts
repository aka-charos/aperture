import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  TRAIL_KINDS,
  extendTrail,
  filterQuery,
  hereCaption,
  pairKey,
  rarityText,
  readTrailsUrl,
  sharedWithOthers,
  stepCaption,
  stepTrail,
  titleRefFor,
  trailPathFor,
  writeTrailsUrl,
} from './labels'

const A = 'movie:00000000-0000-4000-8000-000000000001'
const B = 'series:00000000-0000-4000-8000-000000000002'
const C = 'movie:00000000-0000-4000-8000-000000000003'

test('a step names the role when both titles give the same one, else both in order', () => {
  assert.deepEqual(stepCaption({ kind: 'person', rolesFrom: ['cinematographer'], rolesTo: ['cinematographer'] }), {
    key: 'trails.caption.same',
    role: 'cinematographer',
  })
  assert.deepEqual(stepCaption({ kind: 'person', rolesFrom: ['lead', 'writer'], rolesTo: ['director'] }), {
    key: 'trails.caption.differs',
    from: 'lead',
    to: 'director',
  })
  assert.deepEqual(stepCaption({ kind: 'franchise', rolesFrom: ['franchise'], rolesTo: ['franchise'] }), {
    key: 'trails.caption.franchise',
  })
  assert.deepEqual(stepCaption({ kind: 'keyword', rolesFrom: ['keyword'], rolesTo: ['keyword'] }), {
    key: 'trails.caption.keyword',
  })
})

test('a thread says what its entity is in the starting title', () => {
  assert.deepEqual(hereCaption('person', ['director', 'writer']), { key: 'trails.here.role', role: 'director' })
  assert.deepEqual(hereCaption('company', ['network']), { key: 'trails.here.role', role: 'network' })
  assert.deepEqual(hereCaption('keyword', ['keyword']), { key: 'trails.here.keyword' })
})

test('rarity is stated as a count, with two titles said plainly', () => {
  assert.deepEqual(rarityText(2), { key: 'trails.rarity.onlyTwo' })
  assert.deepEqual(rarityText(7), { key: 'trails.rarity.count', count: 7 })
})

test('the URL holds the trail and the filters, drops malformed refs and repeats, and caps the trail', () => {
  const state = readTrailsUrl(
    new URLSearchParams({
      mode: 'common',
      from: A,
      trail: `${A},movie:42,${B},${A},${C}`,
      unwatched: '1',
      kinds: 'keyword,nonsense,person',
    }),
    2
  )
  assert.deepEqual(state, { trail: [B, C], hideWatched: true, kinds: ['person', 'keyword'] })
  assert.deepEqual(readTrailsUrl(writeTrailsUrl(state)), state)
  assert.equal(writeTrailsUrl({ trail: [], hideWatched: false, kinds: [] }).toString(), '')
  // Every kind chosen reads as no filter, so it is written as none.
  assert.equal(writeTrailsUrl({ trail: [], hideWatched: false, kinds: [...TRAIL_KINDS] }).toString(), '')
  assert.equal(filterQuery({ hideWatched: true, kinds: ['franchise'] }), '&unwatched=1&kinds=franchise')
  assert.equal(filterQuery({ hideWatched: false, kinds: [] }), '')
})

test('stepping back onto the trail cuts it there, and a long trail drops its oldest', () => {
  assert.deepEqual(stepTrail([A, B], C), [A, B, C])
  assert.deepEqual(stepTrail([A, B, C], B), [A, B])
  const long = Array.from({ length: 12 }, (_, i) => `movie:00000000-0000-4000-8000-${String(i + 10).padStart(12, '0')}`)
  const next = stepTrail(long, A, 12)
  assert.equal(next.length, 12)
  assert.equal(next[next.length - 1], A)
  assert.equal(next[0], long[1])
})

test('a walked trail is appended in order, within the cap', () => {
  assert.deepEqual(extendTrail([A], [B, C]), [A, B, C])
  assert.deepEqual(extendTrail([A], [B, C], 2), [B, C])
  assert.equal(pairKey(A, B), `${A}>${B}`)
})

test('a link from a detail page starts a trail at that title, and reads back the same', () => {
  const ref = titleRefFor('movie', '00000000-0000-4000-8000-00000000000A')
  assert.equal(ref, 'movie:00000000-0000-4000-8000-00000000000a')
  const path = trailPathFor(ref!)
  assert.equal(path, '/trails?trail=movie%3A00000000-0000-4000-8000-00000000000a')
  const state = readTrailsUrl(new URLSearchParams(path.slice(path.indexOf('?') + 1)))
  assert.deepEqual(state.trail, [ref])
  assert.equal(titleRefFor('series', 'not-a-uuid'), null)
})

test('following from on top of the Trails page keeps the filters and restarts the trail', () => {
  const current = writeTrailsUrl({ trail: [B, C], hideWatched: true, kinds: ['person'] })
  const path = trailPathFor(A, current)
  const state = readTrailsUrl(new URLSearchParams(path.slice(path.indexOf('?') + 1)))
  assert.deepEqual(state, { trail: [A], hideWatched: true, kinds: ['person'] })
})

test('a detail page counts the OTHER titles sharing a thread, never "these two"', () => {
  assert.deepEqual(sharedWithOthers(2), { key: 'trails.detail.sharedWith', count: 1 })
  assert.deepEqual(sharedWithOthers(9), { key: 'trails.detail.sharedWith', count: 8 })
})
