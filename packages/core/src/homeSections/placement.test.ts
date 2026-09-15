/**
 * Where managed rows land. A wrong index is silent on the server — the row just
 * appears somewhere else, on someone else's TV — so the arithmetic is pinned
 * against a real account's layout and against Emby's measured Move behaviour.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  collapseExpandedRows,
  groupsAreContiguous,
  placementChain,
  placementKey,
  planPlacement,
  planPlacementMoves,
  resolvePlacementIndex,
  sanitizeFeaturePlacement,
  sanitizePlacement,
  type FeaturePlacement,
  type HomeScreenRow,
  type Placement,
  type PlacementFeature,
  type PlacementMove,
} from './placement.js'

/** Emby's Move, as measured: out of the list, back in at the index. */
function replay(ids: readonly string[], moves: readonly PlacementMove[]): string[] {
  const list = [...ids]
  for (const move of moves) {
    list.splice(list.indexOf(move.id), 1)
    list.splice(Math.min(move.index, list.length), 0, move.id)
  }
  return list
}

function own(id: string, sectionType: string = id): HomeScreenRow {
  return { id, sectionType, feature: null, name: id }
}

function ours(id: string, feature: PlacementFeature, name: string = id): HomeScreenRow {
  return { id, sectionType: 'items', feature, name }
}

const MY_MEDIA = { id: 'smalllibrarytiles', type: 'userviews', name: 'My Media' }

const top: Placement = { mode: 'top', position: 0, anchor: null }
const bottom: Placement = { mode: 'bottom', position: 0, anchor: null }
const position = (n: number): Placement => ({ mode: 'position', position: n, anchor: null })
const after = (anchor: Placement['anchor']): Placement => ({ mode: 'after', position: 0, anchor })
const before = (anchor: Placement['anchor']): Placement => ({ mode: 'before', position: 0, anchor })

/** One account's layout as the server returned it, with Aperture's row 4th. */
function liveLayout(): HomeScreenRow[] {
  return [
    own('smalllibrarytiles', 'userviews'),
    own('resume'),
    own('resumeaudio'),
    ours('397a4d25', 'playlists', 'Dark realities'),
    own('onnow'),
    own('latestmoviereleases'),
    own('latestmedia_111621', 'latestmedia'),
    own('latestmedia_7149', 'latestmedia'),
    { id: '2598807d', sectionType: 'boxset', feature: null, name: 'Fractured Headspace' },
  ]
}

function place(rows: HomeScreenRow[], chains: Array<[PlacementFeature, Placement[]]>) {
  const plan = planPlacement(rows, new Map(chains))
  const stored = collapseExpandedRows(rows).map((row) => row.id)
  assert.deepEqual(replay(stored, plan.moves), plan.order, 'the moves must produce the order')
  return plan
}

/** One account's layout with several libraries' Latest rows, as the read returns them. */
function withLatestMedia(): HomeScreenRow[] {
  return [
    own('smalllibrarytiles', 'userviews'),
    own('resume'),
    own('resumeaudio'),
    own('onnow'),
    own('latestmoviereleases'),
    own('latestmedia_111621', 'latestmedia'),
    own('latestmedia_7149', 'latestmedia'),
    own('latestmedia_65792', 'latestmedia'),
    own('latestmedia_7', 'latestmedia'),
    ours('397a4d25', 'playlists', 'Dark realities'),
  ]
}

const LATEST_TV_SHOWS = { id: 'latestmedia_65792', type: 'latestmedia', name: 'Latest TV Shows' }

describe('Latest Media is one row', () => {
  test("every library's Latest row collapses into one row where the group first appears", () => {
    const collapsed = collapseExpandedRows(withLatestMedia())
    assert.deepEqual(
      collapsed.map((row) => row.id),
      ['smalllibrarytiles', 'resume', 'resumeaudio', 'onnow', 'latestmoviereleases', 'latestmedia', '397a4d25']
    )
    assert.equal(collapsed[5].group, true)
  })

  test('an anchor on one library\'s Latest row is stored as the whole group', () => {
    const { placement } = sanitizePlacement({ mode: 'after', anchor: LATEST_TV_SHOWS }, 'p')
    assert.deepEqual(placement?.anchor, { id: 'latestmedia', type: 'latestmedia', name: 'Latest Media' })
    assert.equal(placementKey([after(LATEST_TV_SHOWS)]), placementKey([after({ id: 'latestmedia', type: 'latestmedia', name: null })]))
  })

  test('nothing lands between two libraries: before and after mean the whole block', () => {
    const rows = withLatestMedia()
    const afterPlan = place(rows, [['playlists', [after(LATEST_TV_SHOWS)]]])
    assert.deepEqual(afterPlan.order.slice(-2), ['latestmedia', '397a4d25'])
    const beforePlan = place(rows, [['playlists', [before(LATEST_TV_SHOWS)]]])
    assert.deepEqual(beforePlan.order.slice(-3), ['latestmoviereleases', '397a4d25', 'latestmedia'])
    assert.deepEqual(beforePlan.moves, [{ id: '397a4d25', index: 5 }])
  })

  test("a position counts the block once, the way Emby's Home Screen editor numbers it", () => {
    const plan = place(withLatestMedia(), [['playlists', [position(6)]]])
    assert.deepEqual(plan.moves, [])
    const earlier = place(withLatestMedia(), [['playlists', [position(5)]]])
    assert.deepEqual(earlier.moves, [{ id: '397a4d25', index: 5 }])
  })

  test('a row sitting between two libraries is detected', () => {
    assert.equal(groupsAreContiguous(withLatestMedia()), true)
    const rows = withLatestMedia()
    const split = [...rows.slice(0, 6), rows[9], ...rows.slice(6, 9)]
    assert.equal(groupsAreContiguous(split), false)
  })
})

describe('sanitizePlacement', () => {
  test('an anchor placement needs an anchor id', () => {
    assert.equal(sanitizePlacement({ mode: 'after' }, 'p').errors.length, 1)
    const { placement } = sanitizePlacement({ mode: 'after', anchor: { id: ' resume ', type: 'resume' } }, 'p')
    assert.deepEqual(placement, { mode: 'after', position: 0, anchor: { id: 'resume', type: 'resume', name: null } })
  })

  test('what the mode does not use is dropped, so equal behaviour is stored equally', () => {
    const { placement } = sanitizePlacement({ mode: 'top', position: 7, anchor: { id: 'resume' } }, 'p')
    assert.deepEqual(placement, top)
  })

  test('a position out of range is refused, not clamped', () => {
    assert.equal(sanitizePlacement({ mode: 'position', position: 51 }, 'p').placement, null)
    assert.equal(sanitizePlacement({ mode: 'position', position: -1 }, 'p').placement, null)
    assert.equal(sanitizePlacement({ mode: 'sideways' }, 'p').placement, null)
  })

  test('an admin fallback defaults to the bottom and validates its position', () => {
    const { placement } = sanitizeFeaturePlacement({ mode: 'after', anchor: { id: 'resume' } }, 'p')
    assert.equal(placement?.fallbackMode, 'bottom')
    assert.equal(sanitizeFeaturePlacement({ mode: 'top', fallbackMode: 'position' }, 'p').placement, null)
    assert.equal(sanitizeFeaturePlacement({ mode: 'top', fallbackMode: 'middle' }, 'p').placement, null)
  })
})

describe('placementChain and placementKey', () => {
  const adminAnchor: FeaturePlacement = { ...after(MY_MEDIA), fallbackMode: 'position', fallbackPosition: 2 }

  test('an admin anchor falls back to the admin fallback', () => {
    assert.deepEqual(placementChain(adminAnchor, null), [after(MY_MEDIA), position(2)])
  })

  test('an override that cannot miss ignores the admin default entirely', () => {
    assert.deepEqual(placementChain(adminAnchor, bottom), [bottom])
  })

  test('an override anchor that misses falls back to the admin default', () => {
    const mine = after({ id: 'abc', type: 'items', name: 'Mine' })
    assert.deepEqual(placementChain(adminAnchor, mine), [mine, after(MY_MEDIA), position(2)])
  })

  test('renaming an anchor does not change the key, so nobody is moved by it', () => {
    const renamed = after({ ...MY_MEDIA, name: 'Min media' })
    assert.equal(placementKey([after(MY_MEDIA)]), placementKey([renamed]))
    assert.notEqual(placementKey([after(MY_MEDIA)]), placementKey([before(MY_MEDIA)]))
  })
})

describe('resolvePlacementIndex', () => {
  test("a position counts the viewer's own rows, never Aperture's", () => {
    // Position 3 on the live account is "after Continue Listening", whatever of ours sits above.
    const rows = [ours('tp', 'top-picks-movies'), ...liveLayout().filter((row) => row.feature === null)]
    assert.equal(rows[resolvePlacementIndex(rows, [position(3)]) - 1].id, 'resumeaudio')
  })

  test('an anchor is found by id, first occurrence when an account has it twice', () => {
    const rows = [own('resume'), own('smalllibrarytiles', 'userviews'), own('onnow'), own('smalllibrarytiles', 'userviews')]
    assert.equal(resolvePlacementIndex(rows, [after(MY_MEDIA)]), 2)
    assert.equal(resolvePlacementIndex(rows, [before(MY_MEDIA)]), 1)
  })

  test('an anchor missing by id is found by type on an account showing it under a sibling id', () => {
    const rows = [own('resume'), own('librarybuttons', 'userviews')]
    assert.equal(resolvePlacementIndex(rows, [after(MY_MEDIA)]), 2)
  })

  test('a generic container type never stands in for a missing anchor', () => {
    const rows = [own('resume'), { ...own('someone-elses-row'), sectionType: 'items' }]
    const custom = { id: 'gone', type: 'items', name: 'Deleted row' }
    assert.equal(resolvePlacementIndex(rows, [after(custom), top]), 0)
  })

  test('a missing anchor falls through to the next placement, and an exhausted chain is the bottom', () => {
    const rows = [own('resume'), own('onnow')]
    assert.equal(resolvePlacementIndex(rows, [after(MY_MEDIA), position(1)]), 1)
    assert.equal(resolvePlacementIndex(rows, [after(MY_MEDIA)]), 2)
  })

  test('a position beyond the list is the bottom', () => {
    assert.equal(resolvePlacementIndex([own('resume')], [position(40)]), 1)
  })
})

describe('planPlacement', () => {
  test("the live account: a playlist row moved from 4th to just after My Media", () => {
    const plan = place(liveLayout(), [['playlists', [after(MY_MEDIA)]]])
    assert.deepEqual(plan.order.slice(0, 3), ['smalllibrarytiles', '397a4d25', 'resume'])
    assert.deepEqual(plan.moves, [{ id: '397a4d25', index: 1 }])
  })

  test('a row already in place is not moved', () => {
    const plan = place(liveLayout(), [['playlists', [position(3)]]])
    assert.deepEqual(plan.moves, [])
  })

  test('only the features being placed move; another feature stays where the viewer dragged it', () => {
    const rows = [own('smalllibrarytiles'), ours('tp', 'top-picks-movies'), own('resume'), ours('rm', 'recs-movies')]
    const plan = place(rows, [['recs-movies', [top]]])
    assert.deepEqual(plan.order, ['rm', 'smalllibrarytiles', 'tp', 'resume'])
    assert.ok(plan.moves.every((move) => move.id === 'rm'))
  })

  test('features resolving to one spot stack in feature order, including rows that did not move', () => {
    const rows = [ours('tp', 'top-picks-movies'), own('smalllibrarytiles'), own('resume'), ours('rs', 'recs-series'), ours('rm', 'recs-movies')]
    const plan = place(rows, [
      ['recs-series', [top]],
      ['recs-movies', [top]],
    ])
    assert.deepEqual(plan.order, ['tp', 'rm', 'rs', 'smalllibrarytiles', 'resume'])
  })

  test('playlist rows move as one group, by name', () => {
    const rows = [ours('z', 'playlists', 'Zombies'), own('smalllibrarytiles', 'userviews'), ours('n', 'playlists', 'Noir'), own('resume')]
    const plan = place(rows, [['playlists', [after(MY_MEDIA)]]])
    assert.deepEqual(plan.order, ['smalllibrarytiles', 'n', 'z', 'resume'])
  })

  test('bottom puts rows after everything, Aperture rows of earlier features included', () => {
    const rows = [ours('rm', 'recs-movies'), own('resume'), ours('tp', 'top-picks-movies')]
    const plan = place(rows, [['recs-movies', [bottom]]])
    assert.deepEqual(plan.order, ['resume', 'tp', 'rm'])
  })
})

describe('planPlacementMoves', () => {
  test('never moves a row it was not given', () => {
    const current = ['a', 'x', 'b', 'y', 'c']
    const target = ['x', 'a', 'b', 'c', 'y']
    const moves = planPlacementMoves(current, target, new Set(['x', 'y']))
    assert.deepEqual(replay(current, moves), target)
    assert.ok(moves.every((move) => move.id === 'x' || move.id === 'y'))
  })

  test('refuses an order it could only reach by moving the viewer\'s own rows', () => {
    assert.throws(() => planPlacementMoves(['a', 'b'], ['b', 'a'], new Set()))
  })
})
