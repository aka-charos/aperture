/**
 * The home screen a viewer is shown before anything is written. It has to
 * match what the writes will do, or the page promises a layout the TV does not
 * show — so it is pinned against the rule the writes follow: rows move only
 * when created or when their placement changed.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import type { ContentSection } from '../media/types.js'
import {
  DEFAULT_FEATURE_PLACEMENT,
  PLACEMENT_FEATURES,
  placementChain,
  placementKey,
  type FeaturePlacement,
  type PlacementFeature,
} from './placement.js'
import { projectHomeScreen, type WantedRow } from './preview.js'

const DEFAULTS = Object.fromEntries(
  PLACEMENT_FEATURES.map((feature) => [feature, { ...DEFAULT_FEATURE_PLACEMENT }])
) as Record<PlacementFeature, FeaturePlacement>

function own(id: string, name: string = id, type: string = id): ContentSection {
  return { Id: id, Name: name, SectionType: type }
}

function tagRow(id: string, tagId: string, name: string): ContentSection {
  return { Id: id, CustomName: name, SectionType: 'items', Query: { TagIds: [tagId] } }
}

const appliedTop = (...features: PlacementFeature[]) =>
  new Map(features.map((feature) => [feature, placementKey(placementChain(DEFAULTS[feature], null))]))

const ids = (rows: ReturnType<typeof projectHomeScreen>) => rows.map((row) => row.id)

describe('projectHomeScreen', () => {
  test('a row switched on but not there yet appears, where its placement puts it, marked pending', () => {
    const rows = projectHomeScreen({
      sections: [own('smalllibrarytiles', 'My Media'), own('resume', 'Continue Watching')],
      managedTagIds: new Set(),
      wanted: [{ key: 'new:friends', feature: 'friends', name: 'Recommended by Friends' }],
      defaults: DEFAULTS,
      overrides: undefined,
      applied: undefined,
    })
    assert.deepEqual(ids(rows), ['pending:new:friends', 'smalllibrarytiles', 'resume'])
    assert.equal(rows[0].pending, true)
    assert.equal(rows[0].name, 'Recommended by Friends')
    assert.equal(rows[1].feature, null)
  })

  test('a row of ours that is no longer wanted is gone; the viewer’s own rows never are', () => {
    const rows = projectHomeScreen({
      sections: [tagRow('a1', '901', 'Recommended Movies'), own('smalllibrarytiles', 'My Media')],
      managedTagIds: new Set(['901']),
      wanted: [],
      defaults: DEFAULTS,
      overrides: undefined,
      applied: undefined,
    })
    assert.deepEqual(ids(rows), ['smalllibrarytiles'])
  })

  test('a row whose placement has not changed stays where the viewer dragged it', () => {
    const wanted: WantedRow[] = [{ key: '901', feature: 'recs-movies', name: 'Recommended Movies' }]
    const sections = [own('smalllibrarytiles', 'My Media'), own('resume'), tagRow('a1', '901', 'Recommended Movies')]
    const kept = projectHomeScreen({
      sections,
      managedTagIds: new Set(['901']),
      wanted,
      defaults: DEFAULTS,
      overrides: undefined,
      applied: appliedTop('recs-movies'),
    })
    assert.deepEqual(ids(kept), ['smalllibrarytiles', 'resume', 'a1'])

    // Nothing recorded as applied is a placement that changed: the row goes where the default puts it.
    const moved = projectHomeScreen({
      sections,
      managedTagIds: new Set(['901']),
      wanted,
      defaults: DEFAULTS,
      overrides: undefined,
      applied: undefined,
    })
    assert.deepEqual(ids(moved), ['a1', 'smalllibrarytiles', 'resume'])
  })

  test('a viewer override is what places a row', () => {
    const rows = projectHomeScreen({
      sections: [own('smalllibrarytiles', 'My Media'), own('resume')],
      managedTagIds: new Set(),
      wanted: [{ key: 'new:recs-series', feature: 'recs-series', name: 'Recommended Series' }],
      defaults: DEFAULTS,
      overrides: new Map([['recs-series', { mode: 'after', position: 0, anchor: { id: 'smalllibrarytiles', type: 'smalllibrarytiles', name: 'My Media' } }]]),
      applied: undefined,
    })
    assert.deepEqual(ids(rows), ['smalllibrarytiles', 'pending:new:recs-series', 'resume'])
  })

  test('every library’s Latest row is one entry, as Emby’s own editor shows it', () => {
    const rows = projectHomeScreen({
      sections: [
        own('latestmedia_1', 'Latest Movies', 'latestmedia'),
        own('latestmedia_2', 'Latest TV', 'latestmedia'),
        own('resume'),
      ],
      managedTagIds: new Set(),
      wanted: [],
      defaults: DEFAULTS,
      overrides: undefined,
      applied: undefined,
    })
    assert.deepEqual(ids(rows), ['latestmedia', 'resume'])
    assert.equal(rows[0].group, true)
  })

  test('a duplicate section on one tag is shown once, as the write keeps one', () => {
    const rows = projectHomeScreen({
      sections: [tagRow('a1', '901', 'Recommended Movies'), tagRow('a2', '901', 'Recommended Movies'), own('resume')],
      managedTagIds: new Set(['901']),
      wanted: [{ key: '901', feature: 'recs-movies', name: 'Recommended Movies' }],
      defaults: DEFAULTS,
      overrides: undefined,
      applied: appliedTop('recs-movies'),
    })
    assert.deepEqual(ids(rows), ['a1', 'resume'])
  })
})
