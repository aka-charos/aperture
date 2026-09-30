/**
 * Who gets which home row. The sync writes from this answer and the settings
 * page shows it, so a wrong answer is either a row on someone's TV they turned
 * off, or a page telling them a row is there when it is not.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { PLACEMENT_FEATURES } from './placement.js'
import {
  VIEWER_SWITCHABLE_FEATURES,
  isSwitchableFeature,
  resolveRowStates,
  type RowStateConfig,
  type RowStateInput,
  type RowStateViewer,
} from './rowStates.js'
import { DEFAULT_HOME_SECTIONS_CONFIG } from './settings.js'

const ALL_ON: RowStateConfig = {
  enabled: true,
  topPicksEnabled: true,
  topPicksWithoutAccess: true,
  recommendationsEnabled: true,
  friendsEnabled: true,
  playlistsEnabled: true,
}

const VIEWER: RowStateViewer = {
  isEnabled: true,
  providerDisabled: false,
  recommendationsEnabled: true,
  hasMovies: true,
  hasSeries: true,
}

function states(overrides: Partial<Omit<RowStateInput, 'config' | 'viewer'>> & {
  config?: Partial<RowStateConfig>
  viewer?: Partial<RowStateViewer>
} = {}) {
  return resolveRowStates({
    config: { ...ALL_ON, ...overrides.config },
    topPicksListEnabled: overrides.topPicksListEnabled ?? true,
    viewer: { ...VIEWER, ...overrides.viewer },
    switches: overrides.switches,
  })
}

describe('resolveRowStates', () => {
  test('a viewer who never touched a switch gets every row the operator offers', () => {
    const result = states()
    for (const feature of PLACEMENT_FEATURES) assert.deepEqual(result[feature], { status: 'on' }, feature)
  })

  test('only an explicit false switches a row off; true and absent are on', () => {
    const result = states({ switches: new Map([['recs-movies', false], ['friends', true]]) })
    assert.deepEqual(result['recs-movies'], { status: 'off' })
    assert.deepEqual(result.friends, { status: 'on' })
    assert.deepEqual(result['top-picks-movies'], { status: 'on' })
  })

  test('with home rows switched off, nothing reaches anyone, whatever they chose', () => {
    const result = states({ config: { enabled: false }, switches: new Map([['recs-movies', true]]) })
    for (const feature of PLACEMENT_FEATURES) {
      assert.deepEqual(result[feature], { status: 'unavailable', reason: 'feature-off' }, feature)
    }
  })

  test("the operator's off outranks the viewer's, so the page names the operator", () => {
    const result = states({ config: { recommendationsEnabled: false }, switches: new Map([['recs-movies', false]]) })
    assert.deepEqual(result['recs-movies'], { status: 'unavailable', reason: 'admin-off' })
  })

  test('the friends row is off server-wide by default, as it was before it existed', () => {
    const result = resolveRowStates({
      config: { ...DEFAULT_HOME_SECTIONS_CONFIG, enabled: true },
      topPicksListEnabled: true,
      viewer: VIEWER,
      switches: undefined,
    })
    assert.deepEqual(result.friends, { status: 'unavailable', reason: 'admin-off' })
    assert.deepEqual(result['recs-movies'], { status: 'on' })
  })

  test('an account without access gets Top Picks only, and only while the operator allows it', () => {
    const allowed = states({ viewer: { isEnabled: false } })
    assert.deepEqual(allowed['top-picks-movies'], { status: 'on' })
    for (const feature of ['recs-movies', 'recs-series', 'friends', 'playlists'] as const) {
      assert.deepEqual(allowed[feature], { status: 'unavailable', reason: 'no-access' }, feature)
    }
    const refused = states({ viewer: { isEnabled: false }, config: { topPicksWithoutAccess: false } })
    assert.deepEqual(refused['top-picks-movies'], { status: 'unavailable', reason: 'no-access' })
  })

  test('an account the media server disabled gets nothing at all', () => {
    const result = states({ viewer: { providerDisabled: true } })
    for (const feature of PLACEMENT_FEATURES) {
      assert.deepEqual(result[feature], { status: 'unavailable', reason: 'no-access' }, feature)
    }
  })

  test('recommendation rows follow the viewer: recommendations off, then which libraries they can open', () => {
    assert.deepEqual(states({ viewer: { recommendationsEnabled: false } })['recs-series'], {
      status: 'unavailable',
      reason: 'recommendations-off',
    })
    const noSeries = states({ viewer: { hasSeries: false } })
    assert.deepEqual(noSeries['recs-series'], { status: 'unavailable', reason: 'no-library' })
    assert.deepEqual(noSeries['recs-movies'], { status: 'on' })
  })

  test('Top Picks rows need the Top Picks lists themselves', () => {
    assert.deepEqual(states({ topPicksListEnabled: false })['top-picks-series'], {
      status: 'unavailable',
      reason: 'top-picks-off',
    })
  })

  test('playlists have no row switch: each playlist is chosen on its own', () => {
    assert.deepEqual(states({ switches: new Map([['playlists', false]]) }).playlists, { status: 'on' })
  })
})

describe('VIEWER_SWITCHABLE_FEATURES', () => {
  test('every switchable kind is a placement feature, and playlists are not switchable', () => {
    for (const feature of VIEWER_SWITCHABLE_FEATURES) {
      assert.ok((PLACEMENT_FEATURES as readonly string[]).includes(feature), feature)
    }
    assert.equal(isSwitchableFeature('playlists'), false)
    assert.equal(isSwitchableFeature('friends'), true)
    assert.equal(isSwitchableFeature('nonsense'), false)
  })
})
