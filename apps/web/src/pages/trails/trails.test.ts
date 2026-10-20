import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_TRAIL_LENGTH,
  hereCaption,
  rarityText,
  readTrailsUrl,
  stepCaption,
  stepTrail,
  threadsPathFor,
  titleRefFor,
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

test('the URL keeps every mode\'s selection, drops malformed refs and repeats, and caps the lists', () => {
  const state = readTrailsUrl(
    new URLSearchParams({
      mode: 'common',
      from: A.toUpperCase().replace('MOVIE', 'movie'),
      to: 'movie:42',
      trail: `${A},${B},${A}`,
      titles: `${A},${B},${C}`,
    }),
    2
  )
  assert.equal(state.mode, 'common')
  assert.equal(state.from, A)
  assert.equal(state.to, null)
  assert.deepEqual(state.trail, [A, B])
  assert.deepEqual(state.titles, [B, C])
  assert.equal(readTrailsUrl(writeTrailsUrl(state), 8).titles.join(), [B, C].join())
  assert.equal(readTrailsUrl(new URLSearchParams({ mode: 'nonsense' }), 8).mode, 'route')
  assert.equal(writeTrailsUrl({ mode: 'route', from: null, to: null, trail: [], titles: [] }).toString(), 'mode=route')
})

test('stepping back onto the trail cuts it there, and a long trail drops its oldest', () => {
  assert.deepEqual(stepTrail([A, B], C), [A, B, C])
  assert.deepEqual(stepTrail([A, B, C], B), [A, B])
  const long = Array.from({ length: MAX_TRAIL_LENGTH }, (_, i) => `movie:00000000-0000-4000-8000-${String(i + 10).padStart(12, '0')}`)
  const next = stepTrail(long, A)
  assert.equal(next.length, MAX_TRAIL_LENGTH)
  assert.equal(next[next.length - 1], A)
  assert.equal(next[0], long[1])
})

test('a link from a detail page opens Follow a thread on that title, and reads back the same', () => {
  const ref = titleRefFor('movie', '00000000-0000-4000-8000-00000000000A')
  assert.equal(ref, 'movie:00000000-0000-4000-8000-00000000000a')
  const path = threadsPathFor(ref!)
  assert.equal(path, '/trails?mode=threads&trail=movie%3A00000000-0000-4000-8000-00000000000a')
  const state = readTrailsUrl(new URLSearchParams(path.slice(path.indexOf('?') + 1)), 8)
  assert.equal(state.mode, 'threads')
  assert.deepEqual(state.trail, [ref])
  assert.equal(titleRefFor('series', 'not-a-uuid'), null)
})
