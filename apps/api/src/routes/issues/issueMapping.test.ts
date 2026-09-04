/**
 * Pins the issue mapping.
 *
 * The failures here are all silent on screen: a report rendered twice, a
 * blank author beside every comment, or "Season 0" on a title that has none.
 */
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { displayNameOf, mapSeerrIssue, toIssueKindCode } from './issueMapping.js'
import type { SeerrIssue, SeerrUser } from '@aperture/core'

function user(overrides: Partial<SeerrUser> = {}): SeerrUser {
  return {
    id: 7,
    email: 'haris',
    username: '',
    displayName: 'haris',
    plexToken: null,
    jellyfinUsername: 'haris',
    jellyfinUserId: null,
    permissions: 0,
    avatar: null,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  } as SeerrUser
}

function issue(overrides: Partial<SeerrIssue> = {}): SeerrIssue {
  return {
    id: 3,
    issueType: 1,
    status: 1,
    problemSeason: 0,
    problemEpisode: 0,
    media: { id: 11, tmdbId: 550, status: 5, mediaType: 'movie' },
    createdBy: user(),
    comments: [],
    createdAt: '2026-09-05T10:00:00.000Z',
    updatedAt: '2026-09-05T10:00:00.000Z',
    ...overrides,
  } as SeerrIssue
}

test('the opening comment is the report, not the first reply', () => {
  // Seerr has no description column: POST /issue stores the reporter's message
  // as comment one. Rendering it in the thread as well would show it twice.
  const mapped = mapSeerrIssue(
    issue({
      comments: [
        { id: 1, message: 'Audio desyncs at 40 minutes', user: user(), createdAt: 'a', updatedAt: 'a' },
        { id: 2, message: 'Looking at it', user: user({ id: 1 }), createdAt: 'b', updatedAt: 'b' },
      ],
    })
  )

  assert.equal(mapped.description, 'Audio desyncs at 40 minutes')
  assert.equal(mapped.comments.length, 1)
  assert.equal(mapped.comments[0].message, 'Looking at it')
})

test('an issue with no comments has no description rather than an empty one', () => {
  const mapped = mapSeerrIssue(issue({ comments: [] }))

  assert.equal(mapped.description, null)
  assert.deepEqual(mapped.comments, [])
})

test('a whitespace-only opening comment is not a description', () => {
  const mapped = mapSeerrIssue(
    issue({ comments: [{ id: 1, message: '   ', user: user(), createdAt: 'a', updatedAt: 'a' }] })
  )

  assert.equal(mapped.description, null)
})

test('season and episode 0 mean the whole title, not season zero', () => {
  const whole = mapSeerrIssue(issue({ problemSeason: 0, problemEpisode: 0 }))
  assert.equal(whole.problemSeason, null)
  assert.equal(whole.problemEpisode, null)

  const specific = mapSeerrIssue(issue({ problemSeason: 2, problemEpisode: 5 }))
  assert.equal(specific.problemSeason, 2)
  assert.equal(specific.problemEpisode, 5)
})

test('a Seerr tv issue becomes an Aperture series issue', () => {
  const mapped = mapSeerrIssue(
    issue({ media: { id: 11, tmdbId: 1396, status: 5, mediaType: 'tv' } as SeerrIssue['media'] })
  )

  assert.equal(mapped.mediaType, 'series')
})

test('the four issue types map to their own names, and nothing else is invented', () => {
  assert.equal(mapSeerrIssue(issue({ issueType: 1 })).kind, 'video')
  assert.equal(mapSeerrIssue(issue({ issueType: 2 })).kind, 'audio')
  assert.equal(mapSeerrIssue(issue({ issueType: 3 })).kind, 'subtitles')
  assert.equal(mapSeerrIssue(issue({ issueType: 4 })).kind, 'other')
})

test('status maps to open or resolved', () => {
  assert.equal(mapSeerrIssue(issue({ status: 1 })).state, 'open')
  assert.equal(mapSeerrIssue(issue({ status: 2 })).state, 'resolved')
})

test('an Emby user with no username is named, not left blank', () => {
  // Seerr's import leaves `username` empty and puts the name in
  // jellyfinUsername, with the username copied into `email`.
  assert.equal(displayNameOf(user({ displayName: undefined, username: '', jellyfinUsername: 'haris' })), 'haris')
})

test('display name falls back through the same chain Seerr uses', () => {
  assert.equal(displayNameOf(user({ displayName: 'Haris M' })), 'Haris M')
  assert.equal(displayNameOf(user({ displayName: undefined, username: 'haris' })), 'haris')
  assert.equal(
    displayNameOf(user({ displayName: undefined, username: '', jellyfinUsername: '', email: 'a@b.c' })),
    'a@b.c'
  )
  assert.equal(displayNameOf(undefined), null)
})

test('an unknown issue kind is refused rather than defaulted', () => {
  assert.equal(toIssueKindCode('video'), 1)
  assert.equal(toIssueKindCode('subtitles'), 3)
  assert.equal(toIssueKindCode('nonsense'), null)
  assert.equal(toIssueKindCode(undefined), null)
  assert.equal(toIssueKindCode(''), null)
})
