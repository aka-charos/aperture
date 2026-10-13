import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { groupLibraryCredits } from './libraryCreditGroups.js'

const keys = (groups: { groupKey: string; items: { id: string }[] }[]) =>
  groups.map((g) => `${g.groupKey}=${g.items.map((i) => i.id).join(',')}`)

describe('groupLibraryCredits', () => {
  it('groups by medium and role in the TMDb section order', () => {
    const groups = groupLibraryCredits(
      [
        { id: 'm1', credits: ['actor'] },
        { id: 'm2', credits: ['director'] },
        { id: 'm3', credits: ['actor', 'director'] },
      ],
      [{ id: 's1', credits: ['creator'] }],
      []
    )
    assert.deepEqual(keys(groups), ['movie:actor=m1,m3', 'movie:director=m2,m3', 'tv:creator=s1'])
  })

  it('adds the roles TMDb knows for the same title, matched by medium and id', () => {
    const groups = groupLibraryCredits(
      [{ id: 'm1', tmdbId: '10', credits: ['actor'] }],
      [{ id: 's1', tmdbId: '10', credits: ['actor'] }],
      [
        { tmdbId: 10, mediaType: 'movie', roleKind: 'producer' },
        { tmdbId: 10, mediaType: 'movie', roleKind: 'actor' },
      ]
    )
    // The film gains Producer; the show sharing its number does not.
    assert.deepEqual(keys(groups), ['movie:actor=m1', 'movie:producer=m1', 'tv:actor=s1'])
  })

  it('never drops a title: no known role reads as other crew', () => {
    const groups = groupLibraryCredits([{ id: 'm1' }, { id: 'm2', credits: ['bogus'] }], [], [])
    assert.deepEqual(keys(groups), ['movie:other=m1,m2'])
  })
})
