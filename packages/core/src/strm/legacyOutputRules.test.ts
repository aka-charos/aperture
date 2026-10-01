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
  rowOwnsLibrary,
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

// A viewer names their own library, and the writers adopt any library already
// carrying the name they ask for — so a row can point at someone else's.
describe('rowOwnsLibrary', () => {
  const ann = { userId: 'u1', channelId: null, mediaType: 'movies', ownerProviderUserId: 'abc' }

  test("a personal row owns a library reading the owner's own folder", () => {
    assert.equal(rowOwnsLibrary(ann, { id: 'l', name: 'n', locations: ['/mnt/ApertureLibraries/aperture/Ann_abc'] }), true)
    // The folder from before display names were added is just the id.
    assert.equal(rowOwnsLibrary(ann, { id: 'l', name: 'n', locations: ['/mnt/ApertureLibraries/aperture/abc'] }), true)
  })

  test("never the operator's library, nor another viewer's", () => {
    assert.equal(rowOwnsLibrary(ann, { id: 'l', name: 'Movies', locations: ['/mnt/media/Movies'] }), false)
    assert.equal(rowOwnsLibrary(ann, { id: 'l', name: 'n', locations: ['/mnt/ApertureLibraries/aperture/Bob_def'] }), false)
    // Every folder must be hers: one of the operator's alongside is enough to refuse.
    assert.equal(
      rowOwnsLibrary(ann, { id: 'l', name: 'n', locations: ['/mnt/ApertureLibraries/aperture/Ann_abc', '/mnt/media/Movies'] }),
      false
    )
  })

  test('the media type picks the folder: a movie row does not own a series folder', () => {
    assert.equal(rowOwnsLibrary(ann, { id: 'l', name: 'n', locations: ['/mnt/ApertureLibraries/aperture-tv/Ann_abc'] }), false)
    assert.equal(
      rowOwnsLibrary({ ...ann, mediaType: 'series' }, { id: 'l', name: 'n', locations: ['/mnt/ApertureLibraries/aperture-tv/Ann_abc'] }),
      true
    )
  })

  test('judged by the end of the path, so a library made under an earlier root is still ours', () => {
    assert.equal(rowOwnsLibrary(ann, { id: 'l', name: 'n', locations: ['/old/mount/aperture/Ann_abc'] }), true)
  })

  test('a library that does not say where it reads proves nothing either way', () => {
    assert.equal(rowOwnsLibrary(ann, { id: 'l', name: 'n' }), null)
    assert.equal(rowOwnsLibrary(ann, { id: 'l', name: 'n', locations: [] }), null)
  })

  test('shared rows own exactly their fixed folder', () => {
    const topPicks = { userId: null, channelId: null, mediaType: 'series' }
    assert.equal(rowOwnsLibrary(topPicks, { id: 'l', name: 'n', locations: ['/x/top-picks-series'] }), true)
    assert.equal(rowOwnsLibrary(topPicks, { id: 'l', name: 'n', locations: ['/x/top-picks-movies'] }), false)
    const channel = { userId: 'u1', channelId: 'C-1', mediaType: 'movies' }
    assert.equal(rowOwnsLibrary(channel, { id: 'l', name: 'n', locations: ['/x/channels/c-1'] }), true)
    assert.equal(rowOwnsLibrary(channel, { id: 'l', name: 'n', locations: ['/x/channels/c-2'] }), false)
  })

  test('an unknown owner falls back to the shape of a viewer folder', () => {
    const unknown = { ...ann, ownerProviderUserId: null }
    assert.equal(rowOwnsLibrary(unknown, { id: 'l', name: 'n', locations: ['/x/aperture/Bob_def'] }), true)
    assert.equal(rowOwnsLibrary(unknown, { id: 'l', name: 'n', locations: ['/mnt/media/Movies'] }), false)
  })

  test('a Windows media server: backslashes and case', () => {
    assert.equal(rowOwnsLibrary(ann, { id: 'l', name: 'n', locations: ['D:\\Aperture\\Aperture\\Ann_ABC'] }), true)
  })
})

describe('planGeneratedLibraryRemoval — adopted libraries', () => {
  const ann = (overrides: Partial<GeneratedLibraryRow> & Pick<GeneratedLibraryRow, 'id'>) =>
    row({ ownerProviderUserId: 'abc', ...overrides })

  test("a viewer's row that adopted the operator's library is refused, with or without a root", () => {
    const libraries = [{ id: 'lib-real', name: 'Movies', locations: ['/mnt/media/Movies'] }]
    for (const prefix of [PREFIX, '']) {
      const plan = planGeneratedLibraryRemoval([ann({ id: 'r1', name: 'Movies', providerLibraryId: 'lib-real' })], libraries, prefix)
      assert.deepEqual(plan.deletions, [])
      assert.deepEqual(plan.refused.map((r) => [r.serverName, r.rowIds]), [['Movies', ['r1']]])
    }
  })

  test("adopting another viewer's library: refused without a root (one viewer's cleanup)…", () => {
    const plan = planGeneratedLibraryRemoval(
      [ann({ id: 'r1', name: 'AI Picks - Bob', providerLibraryId: 'lib-bob' })],
      [{ id: 'lib-bob', name: 'AI Picks - Bob', locations: [`${PREFIX}aperture/Bob_def`] }]
    )
    assert.deepEqual(plan.deletions, [])
    assert.deepEqual(plan.refused.map((r) => r.serverName), ['AI Picks - Bob'])
  })

  test('…but removed with one (the removal job), since it is generated all the same', () => {
    const plan = planGeneratedLibraryRemoval(
      [ann({ id: 'r1', name: 'AI Picks - Bob', providerLibraryId: 'lib-bob' })],
      [{ id: 'lib-bob', name: 'AI Picks - Bob', locations: [`${PREFIX}aperture/Bob_def`] }],
      PREFIX
    )
    assert.deepEqual(names(plan), [['AI Picks - Bob', ['r1']]])
    assert.deepEqual(plan.refused, [])
  })

  test('one row owns it and another adopted it: ONE delete, both rows cleared', () => {
    const plan = planGeneratedLibraryRemoval(
      [
        ann({ id: 'r-adopted', name: 'AI Picks - Bob', providerLibraryId: 'lib-bob' }),
        row({ id: 'r-bob', userId: 'u2', ownerProviderUserId: 'def', name: 'AI Picks - Bob', providerLibraryId: 'lib-bob' }),
      ],
      [{ id: 'lib-bob', name: 'AI Picks - Bob', locations: [`${PREFIX}aperture/Bob_def`] }]
    )
    assert.deepEqual(names(plan), [['AI Picks - Bob', ['r-bob', 'r-adopted']]])
    assert.deepEqual(plan.refused, [])
  })

  test('a recorded library made under an earlier root is removed, not refused', () => {
    const plan = planGeneratedLibraryRemoval(
      [ann({ id: 'r1', providerLibraryId: 'lib-1' })],
      [{ id: 'lib-1', name: 'AI Picks - Ann', locations: ['/old/mount/aperture/Ann_abc'] }],
      PREFIX
    )
    assert.deepEqual(names(plan), [['AI Picks - Ann', ['r1']]])
    assert.deepEqual(plan.refused, [])
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
