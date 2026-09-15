/**
 * The reconcile for managed home rows. Every failure here is silent on the
 * server — a duplicated row, a viewer's own row deleted, a row wiped because a
 * source failed — so the rules are pinned rather than trusted.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import type { ContentSection } from '../media/types.js'
import { isManagedTag } from '../media/managedTags.js'
import {
  HOME_SECTION_TYPE,
  ROW_ORDER,
  TOP_PICKS_TAGS,
  buildSection,
  diffMembership,
  isHomeSectionTarget,
  isTopPicksTarget,
  orderRows,
  planMoves,
  planViewerSections,
  playlistTagName,
  recsTagName,
  sectionDiffers,
  type DesiredRow,
} from './plan.js'

const RECS: DesiredRow = {
  kind: 'recs',
  tagId: '901',
  name: 'Recommended for You',
  itemTypes: ['Movie', 'Series'],
  sortBy: 'Random',
}

const TOP_MOVIES: DesiredRow = {
  kind: 'top-picks-movies',
  tagId: '902',
  name: 'Top Picks: Movies',
  itemTypes: ['Movie'],
  sortBy: 'CommunityRating',
}

function recsSection(id: string, extra: Partial<ContentSection> = {}): ContentSection {
  return { ...buildSection(RECS), Id: id, ...extra }
}

const NONE = new Set<string>()

describe('tag names', () => {
  test('every tag this feature mints is one the mappers will filter out', () => {
    // If this failed, the next library sync would embed our own tag as a theme.
    assert.equal(isManagedTag(recsTagName('3f9a1c0b2d')), true)
    for (const tag of Object.values(TOP_PICKS_TAGS)) assert.equal(isManagedTag(tag), true)
    assert.equal(isManagedTag(playlistTagName('ab12cd34ef')), true)
  })
})

describe('diffMembership', () => {
  test('adds what is missing, removes what is extra, ignores duplicates', () => {
    assert.deepEqual(diffMembership(['a', 'b', 'c'], ['b', 'c', 'd', 'd']), { add: ['d'], remove: ['a'] })
  })

  test('an empty desired list untags everything', () => {
    assert.deepEqual(diffMembership(['a', 'b'], []), { add: [], remove: ['a', 'b'] })
  })
})

describe('isHomeSectionTarget', () => {
  test('only an enabled viewer the media server still has', () => {
    assert.equal(isHomeSectionTarget({ isEnabled: true, providerDisabled: false }), true)
    assert.equal(isHomeSectionTarget({ isEnabled: true, providerDisabled: true }), false)
    assert.equal(isHomeSectionTarget({ isEnabled: false, providerDisabled: false }), false)
  })
})

describe('isTopPicksTarget', () => {
  test('every account the media server has not disabled, enabled in Aperture or not', () => {
    assert.equal(isTopPicksTarget({ providerDisabled: false }), true)
    assert.equal(isTopPicksTarget({ providerDisabled: true }), false)
  })
})

describe('buildSection', () => {
  test('a new row is an items section querying exactly its tag, with no Id', () => {
    const section = buildSection(TOP_MOVIES)
    assert.equal(section.Id, undefined)
    assert.equal(section.SectionType, HOME_SECTION_TYPE)
    assert.deepEqual(section.Query, { TagIds: ['902'] })
    assert.deepEqual(section.ItemTypes, ['Movie'])
    assert.equal(section.SortBy, 'CommunityRating')
    assert.equal(section.SortOrder, 'Descending')
  })

  test('an update keeps the Id and everything Aperture does not own', () => {
    const existing = recsSection('s1', {
      CustomName: 'renamed in Emby',
      DisplayMode: 'thumb',
      Query: { TagIds: ['901'], IsPlayed: false },
    })
    const section = buildSection(RECS, existing)
    assert.equal(section.Id, 's1')
    assert.equal(section.DisplayMode, 'thumb')
    assert.equal(section.CustomName, 'Recommended for You')
    assert.deepEqual(section.Query, { TagIds: ['901'], IsPlayed: false })
  })
})

describe('sectionDiffers', () => {
  test('item type order is not a difference', () => {
    assert.equal(sectionDiffers(recsSection('s1', { ItemTypes: ['Series', 'Movie'] }), buildSection(RECS)), false)
  })
})

describe('planViewerSections', () => {
  test('a viewer with no rows gets every desired row created', () => {
    const plan = planViewerSections({
      existing: [],
      managedTagIds: new Set(['901', '902']),
      desired: [RECS, TOP_MOVIES],
      preserveTagIds: NONE,
    })
    assert.equal(plan.creates.length, 2)
    assert.deepEqual(plan.updates, [])
    assert.deepEqual(plan.deletes, [])
    assert.ok(plan.creates.every((section) => section.Id === undefined))
  })

  test('an up-to-date row is left alone and reported as existing', () => {
    const plan = planViewerSections({
      existing: [recsSection('s1')],
      managedTagIds: new Set(['901']),
      desired: [RECS],
      preserveTagIds: NONE,
    })
    assert.deepEqual([plan.creates, plan.updates, plan.deletes], [[], [], []])
    assert.equal(plan.existingIds.get('901'), 's1')
  })

  test('a row renamed in Emby is updated in place, never recreated', () => {
    const plan = planViewerSections({
      existing: [recsSection('s1', { CustomName: 'mine now' })],
      managedTagIds: new Set(['901']),
      desired: [RECS],
      preserveTagIds: NONE,
    })
    assert.deepEqual(plan.creates, [])
    assert.equal(plan.updates.length, 1)
    assert.equal(plan.updates[0].Id, 's1')
  })

  test('duplicates of one row collapse to the first', () => {
    const plan = planViewerSections({
      existing: [recsSection('s1'), recsSection('s2')],
      managedTagIds: new Set(['901']),
      desired: [RECS],
      preserveTagIds: NONE,
    })
    assert.deepEqual(plan.deletes, ['s2'])
    assert.equal(plan.existingIds.get('901'), 's1')
  })

  test('a managed row no longer wanted is removed, including one whose tag has vanished', () => {
    const plan = planViewerSections({
      existing: [recsSection('s1'), { Id: 's9', SectionType: 'items', Query: { TagIds: ['903'] } }],
      managedTagIds: new Set(['901', '903']),
      desired: [],
      preserveTagIds: NONE,
    })
    assert.deepEqual(plan.deletes.sort(), ['s1', 's9'])
  })

  test("the viewer's own sections are never touched", () => {
    const plan = planViewerSections({
      existing: [
        { Id: 'mine1', SectionType: 'latestmedia' },
        { Id: 'mine2', SectionType: 'items', Query: { TagIds: ['555'] } },
        { SectionType: 'items', Query: { TagIds: ['901'] } },
      ],
      managedTagIds: new Set(['901']),
      desired: [],
      preserveTagIds: NONE,
    })
    assert.deepEqual([plan.creates, plan.updates, plan.deletes], [[], [], []])
  })

  test('a row whose contents could not be worked out is preserved, not emptied', () => {
    const plan = planViewerSections({
      existing: [recsSection('s1')],
      managedTagIds: new Set(['901']),
      desired: [],
      preserveTagIds: new Set(['901']),
    })
    assert.deepEqual(plan.deletes, [])
  })
})

describe('planMoves', () => {
  test('moves one at a time in reverse so the rows land in display order', () => {
    assert.deepEqual(planMoves(['r', 'm', 's'], 2), [
      { id: 's', index: 2 },
      { id: 'm', index: 2 },
      { id: 'r', index: 2 },
    ])
  })

  test('the personal row leads', () => {
    assert.equal(ROW_ORDER[0], 'recs')
  })
})

function playlistRow(tagId: string, name: string): DesiredRow {
  return { kind: 'playlist', tagId, name, itemTypes: ['Movie', 'Series'], sortBy: 'Random' }
}

describe('playlist rows', () => {
  test('several playlist rows are told apart by tag, not by kind', () => {
    const noir = playlistRow('701', 'Noir')
    const zombies = playlistRow('702', 'Zombies')
    const plan = planViewerSections({
      existing: [{ ...buildSection(noir), Id: 'sa' }],
      managedTagIds: new Set(['701', '702']),
      desired: [noir, zombies],
      preserveTagIds: NONE,
    })
    assert.equal(plan.existingIds.get('701'), 'sa')
    assert.equal(plan.creates.length, 1)
    assert.deepEqual(plan.creates[0].Query, { TagIds: ['702'] })
  })

  test('display order is recommendations, Top Picks, then playlists by name', () => {
    const ordered = orderRows([playlistRow('p2', 'Zombies'), TOP_MOVIES, playlistRow('p1', 'Noir'), RECS])
    assert.deepEqual(
      ordered.map((row) => row.tagId),
      ['901', '902', 'p1', 'p2']
    )
  })
})
