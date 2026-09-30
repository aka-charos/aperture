/**
 * Legacy library output rules. A wrong answer here is either libraries written
 * after an operator switched them off, or the removal job deleting the wrong
 * folder — so each rule is pinned at its edge.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  LEGACY_LIBRARY_JOBS,
  REMOVE_LEGACY_LIBRARIES_JOB,
  frozenLibraryStillPermitted,
  generatedLocationSegments,
  isDisposableTopPicksContainer,
  legacyJobBlockedReason,
  parseLegacyLibraryOutputSetting,
  personalOutputFolders,
  personalOutputRoot,
  planGeneratedLibraryRemoval,
  sharedOutputFolder,
  type GeneratedLibraryRow,
} from './legacyOutputRules.js'

describe('parseLegacyLibraryOutputSetting', () => {
  test('absent reads as ON, so instances from before the switch keep their libraries', () => {
    assert.equal(parseLegacyLibraryOutputSetting(null), true)
    assert.equal(parseLegacyLibraryOutputSetting(undefined), true)
  })

  test("only an explicit 'false' turns it off", () => {
    assert.equal(parseLegacyLibraryOutputSetting('false'), false)
    assert.equal(parseLegacyLibraryOutputSetting('true'), true)
    assert.equal(parseLegacyLibraryOutputSetting(''), true)
  })
})

describe('legacyJobBlockedReason', () => {
  test('every legacy job is blocked while the output is off, and none while it is on', () => {
    for (const job of LEGACY_LIBRARY_JOBS) {
      assert.equal(legacyJobBlockedReason(job, false), 'legacyLibraryOutputOff')
      assert.equal(legacyJobBlockedReason(job, true), null)
    }
  })

  test('the removal job is blocked while the output is on — the next sync would undo it', () => {
    assert.equal(legacyJobBlockedReason(REMOVE_LEGACY_LIBRARIES_JOB, true), 'legacyLibraryOutputOn')
    assert.equal(legacyJobBlockedReason(REMOVE_LEGACY_LIBRARIES_JOB, false), null)
  })

  test('the home rows sync and the Top Picks auto-request are not legacy output', () => {
    for (const job of ['sync-home-sections', 'auto-request-top-picks', 'generate-movie-recommendations']) {
      assert.equal(legacyJobBlockedReason(job, false), null)
      assert.equal(legacyJobBlockedReason(job, true), null)
    }
  })
})

function names(plan: ReturnType<typeof planGeneratedLibraryRemoval>): Array<[string, string[]]> {
  return plan.deletions.map((d) => [d.serverName, d.rowIds])
}

function row(overrides: Partial<GeneratedLibraryRow> & Pick<GeneratedLibraryRow, 'id'>): GeneratedLibraryRow {
  return {
    userId: 'u1',
    channelId: null,
    name: 'AI Picks - Ann',
    mediaType: 'movies',
    providerLibraryId: null,
    ...overrides,
  }
}

describe('planGeneratedLibraryRemoval', () => {
  test('the stored id wins over the name', () => {
    const plan = planGeneratedLibraryRemoval(
      [row({ id: 'r1', name: 'Old Name', providerLibraryId: 'lib-1' })],
      [{ id: 'lib-1', name: 'Current Name' }]
    )
    assert.deepEqual(names(plan), [['Current Name', ['r1']]])
    assert.deepEqual(plan.alreadyGone, [])
  })

  test('falls back to the name when the id matches nothing', () => {
    const plan = planGeneratedLibraryRemoval(
      [row({ id: 'r1', name: 'AI Picks - Ann', providerLibraryId: 'gone' })],
      [{ id: 'lib-9', name: 'AI Picks - Ann' }]
    )
    assert.deepEqual(names(plan), [['AI Picks - Ann', ['r1']]])
  })

  test('a row matching nothing on the server is already gone, never guessed at', () => {
    const plan = planGeneratedLibraryRemoval(
      [row({ id: 'r1', name: 'AI Picks - Ann', providerLibraryId: 'gone' })],
      [{ id: 'lib-9', name: 'Movies' }]
    )
    assert.deepEqual(plan.deletions, [])
    assert.deepEqual(plan.alreadyGone, ['r1'])
  })

  test('two rows naming one library become ONE delete', () => {
    const plan = planGeneratedLibraryRemoval(
      [
        row({ id: 'r1', providerLibraryId: 'lib-1' }),
        row({ id: 'r2', userId: null, name: 'AI Picks - Ann' }),
      ],
      [{ id: 'lib-1', name: 'AI Picks - Ann' }]
    )
    assert.deepEqual(names(plan), [['AI Picks - Ann', ['r1', 'r2']]])
  })

  test('an ordinary library that shares no id or name is never planned', () => {
    const plan = planGeneratedLibraryRemoval(
      [row({ id: 'r1', providerLibraryId: 'lib-1', name: 'AI Picks - Ann' })],
      [
        { id: 'lib-1', name: 'AI Picks - Ann' },
        { id: 'lib-2', name: 'Movies' },
        { id: 'lib-3', name: 'TV Shows' },
      ]
    )
    assert.deepEqual(
      plan.deletions.map((d) => d.serverName),
      ['AI Picks - Ann']
    )
  })
})

const PREFIX = '/mnt/ApertureLibraries/'

describe('planGeneratedLibraryRemoval — orphans', () => {
  test('a library left behind by a rename is found by where it reads, with no row', () => {
    const plan = planGeneratedLibraryRemoval(
      [row({ id: 'r1', name: 'Ann Picks', providerLibraryId: 'lib-new' })],
      [
        { id: 'lib-new', name: 'Ann Picks', locations: ['/mnt/ApertureLibraries/aperture/Ann_abc'] },
        { id: 'lib-old', name: 'AI Picks - Ann', locations: ['/mnt/ApertureLibraries/aperture/Ann_abc'] },
        { id: 'lib-movies', name: 'Movies', locations: ['/mnt/media/Movies'] },
      ],
      PREFIX
    )
    assert.deepEqual(
      plan.deletions.map((d) => [d.serverName, d.rowIds, d.orphan]),
      [
        ['Ann Picks', ['r1'], false],
        ['AI Picks - Ann', [], true],
      ]
    )
    assert.deepEqual(plan.deletions[1].folders, [['aperture', 'Ann_abc']])
  })

  test('a library reading one generated folder AND one of its own is never an orphan', () => {
    const plan = planGeneratedLibraryRemoval(
      [],
      [
        {
          id: 'lib-1',
          name: 'Mixed',
          locations: ['/mnt/ApertureLibraries/aperture/Ann_abc', '/mnt/media/Movies'],
        },
      ],
      PREFIX
    )
    assert.deepEqual(plan.deletions, [])
  })

  test('a library that reports no folders is never an orphan', () => {
    const plan = planGeneratedLibraryRemoval([], [{ id: 'lib-1', name: 'AI Picks - Ann' }], PREFIX)
    assert.deepEqual(plan.deletions, [])
  })

  test('a row pointing at a library that reads a real folder is refused, not deleted', () => {
    const plan = planGeneratedLibraryRemoval(
      [row({ id: 'r1', userId: null, name: 'Movies', providerLibraryId: 'lib-real' })],
      [{ id: 'lib-real', name: 'Movies', locations: ['/mnt/media/Movies'] }],
      PREFIX
    )
    assert.deepEqual(plan.deletions, [])
    assert.deepEqual(plan.refused, [{ serverName: 'Movies', rowIds: ['r1'], locations: ['/mnt/media/Movies'] }])
  })

  test('a row whose library reports no folders is still removed — the row is the evidence', () => {
    const plan = planGeneratedLibraryRemoval(
      [row({ id: 'r1', providerLibraryId: 'lib-1' })],
      [{ id: 'lib-1', name: 'AI Picks - Ann' }],
      PREFIX
    )
    assert.deepEqual(names(plan), [['AI Picks - Ann', ['r1']]])
    assert.deepEqual(plan.refused, [])
  })

  test('without a libraries root, no orphan is looked for', () => {
    const plan = planGeneratedLibraryRemoval(
      [],
      [{ id: 'lib-1', name: 'x', locations: ['/mnt/ApertureLibraries/aperture/Ann_abc'] }]
    )
    assert.deepEqual(plan.deletions, [])
  })
})

describe('generatedLocationSegments', () => {
  test('the shapes the writers create, and only those', () => {
    assert.deepEqual(generatedLocationSegments('/mnt/ApertureLibraries/aperture/Ann_abc', PREFIX), ['aperture', 'Ann_abc'])
    assert.deepEqual(generatedLocationSegments('/mnt/ApertureLibraries/aperture-tv/Ann_abc/', PREFIX), ['aperture-tv', 'Ann_abc'])
    assert.deepEqual(generatedLocationSegments('/mnt/ApertureLibraries/channels/c1', PREFIX), ['channels', 'c1'])
    assert.deepEqual(generatedLocationSegments('/mnt/ApertureLibraries/top-picks-movies', PREFIX), ['top-picks-movies'])
    // The per-viewer root itself, a deeper folder, or anything else under the root is not ours.
    assert.equal(generatedLocationSegments('/mnt/ApertureLibraries/aperture', PREFIX), null)
    assert.equal(generatedLocationSegments('/mnt/ApertureLibraries/aperture/Ann_abc/Film (1999)', PREFIX), null)
    assert.equal(generatedLocationSegments('/mnt/ApertureLibraries/top-picks-movies/x', PREFIX), null)
    assert.equal(generatedLocationSegments('/mnt/ApertureLibraries/Movies', PREFIX), null)
  })

  test('a root set far too wide still cannot claim an ordinary library', () => {
    assert.equal(generatedLocationSegments('/mnt/Movies', '/mnt/'), null)
    assert.equal(generatedLocationSegments('/mnt/media/aperture', '/mnt/'), null)
    assert.equal(generatedLocationSegments('/anything/aperture/x', '/'), null)
    assert.equal(generatedLocationSegments('/anything/aperture/x', ''), null)
  })

  test('a sibling folder sharing the prefix text is not under the root', () => {
    assert.equal(generatedLocationSegments('/mnt/ApertureLibrariesOld/aperture/Ann_abc', PREFIX), null)
  })

  test('parent references are refused', () => {
    assert.equal(generatedLocationSegments('/mnt/ApertureLibraries/aperture/..', PREFIX), null)
    assert.equal(generatedLocationSegments('/mnt/ApertureLibraries/../aperture/x', PREFIX), null)
  })

  test('a Windows media server: backslashes, and no case', () => {
    assert.deepEqual(
      generatedLocationSegments('d:\\aperturelibraries\\Aperture\\Ann_abc', 'D:\\ApertureLibraries\\'),
      ['aperture', 'Ann_abc']
    )
  })

  test('a Linux media server keeps case', () => {
    assert.equal(generatedLocationSegments('/mnt/aperturelibraries/aperture/Ann_abc', PREFIX), null)
  })
})

describe('frozenLibraryStillPermitted', () => {
  const OPEN = { libraryAccess: null, maxParentalRating: null }

  test('an owner who can open everything keeps it, recorded or not', () => {
    assert.equal(frozenLibraryStillPermitted(null, OPEN), true)
    assert.equal(frozenLibraryStillPermitted({ libraryIds: ['a'], maxParentalRating: 5 }, OPEN), true)
  })

  test('no record and a restricted owner: not proven, so it goes', () => {
    assert.equal(frozenLibraryStillPermitted(null, { libraryAccess: ['a', 'b'], maxParentalRating: null }), false)
    assert.equal(frozenLibraryStillPermitted(null, { libraryAccess: null, maxParentalRating: 7 }), false)
  })

  test('kept while the current permission still covers every library it was written from', () => {
    const written = { libraryIds: ['a', 'b'], maxParentalRating: null }
    assert.equal(frozenLibraryStillPermitted(written, { libraryAccess: ['a', 'b', 'c'], maxParentalRating: null }), true)
    assert.equal(frozenLibraryStillPermitted(written, { libraryAccess: ['a'], maxParentalRating: null }), false)
  })

  test('written unrestricted, now restricted: it may hold anything, so it goes', () => {
    assert.equal(
      frozenLibraryStillPermitted({ libraryIds: null, maxParentalRating: null }, { libraryAccess: ['a'], maxParentalRating: null }),
      false
    )
  })

  test('a parental ceiling lowered since the write removes it; raised keeps it', () => {
    const written = { libraryIds: ['a'], maxParentalRating: 10 }
    assert.equal(frozenLibraryStillPermitted(written, { libraryAccess: null, maxParentalRating: 7 }), false)
    assert.equal(frozenLibraryStillPermitted(written, { libraryAccess: null, maxParentalRating: 12 }), true)
    assert.equal(
      frozenLibraryStillPermitted({ libraryIds: ['a'], maxParentalRating: null }, { libraryAccess: null, maxParentalRating: 12 }),
      false
    )
  })
})

describe('isDisposableTopPicksContainer', () => {
  const topPicks = new Set(['t1', 't2', 't3'])

  test('holding only Top Picks titles, or nothing at all, it is ours', () => {
    assert.equal(isDisposableTopPicksContainer(['t1', 't3'], topPicks), true)
    assert.equal(isDisposableTopPicksContainer([], topPicks), true)
    assert.equal(isDisposableTopPicksContainer([], new Set()), true)
  })

  test('one title from anywhere else and it is kept', () => {
    assert.equal(isDisposableTopPicksContainer(['t1', 'movie-from-the-real-library'], topPicks), false)
  })

  test('with the Top Picks library unreadable, only an empty one can go', () => {
    assert.equal(isDisposableTopPicksContainer(['t1'], new Set()), false)
  })
})

describe('output folders', () => {
  test('shared rows have fixed folders; personal rows are found by id instead', () => {
    assert.deepEqual(sharedOutputFolder({ userId: null, channelId: null, mediaType: 'movies' }), ['top-picks-movies'])
    assert.deepEqual(sharedOutputFolder({ userId: null, channelId: null, mediaType: 'series' }), ['top-picks-series'])
    assert.deepEqual(sharedOutputFolder({ userId: 'u1', channelId: 'c1', mediaType: 'movies' }), ['channels', 'c1'])
    assert.equal(sharedOutputFolder({ userId: 'u1', channelId: null, mediaType: 'movies' }), null)
  })

  test('personal libraries live under aperture/ (movies) and aperture-tv/ (series)', () => {
    assert.equal(personalOutputRoot('movies'), 'aperture')
    assert.equal(personalOutputRoot('series'), 'aperture-tv')
  })

  test('a folder written under an old display name is still found by its id', () => {
    const entries = ['Ann_abc123', 'Annie B_abc123', 'abc123', 'Bob_def456', 'Ann_abc1234']
    assert.deepEqual(personalOutputFolders(entries, 'abc123'), ['Ann_abc123', 'Annie B_abc123', 'abc123'])
  })

  test('an empty provider id matches nothing rather than every bare folder', () => {
    assert.deepEqual(personalOutputFolders(['', 'Ann_'], ''), [])
  })
})
