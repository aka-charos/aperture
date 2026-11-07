/**
 * The two auto-detected preference writers (genre weights, franchise
 * preferences), against a stubbed pool client that records every statement.
 *
 * What is pinned: a write is one transaction behind a per-account lock, so a
 * reset that fails part-way rolls back to the old list and two writes for one
 * account queue; a row that would come out the same is not written, since a
 * trigger restamps `updated_at` on any update and the activity gate reads it;
 * a hand-set value is never overwritten; and nothing in the recommender asks
 * for a reset, which deletes hand-set rows.
 */
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

process.env.DATABASE_URL ??= 'postgres://unused:unused@127.0.0.1/unused'

const { closePool, getPool } = await import('../lib/db.js')
const { bulkUpdateGenreWeights, bulkUpdateFranchisePreferences, FRANCHISE_ROW_CHANGED, GENRE_ROW_CHANGED } =
  await import('./index.js')

interface Recorded {
  sql: string
  params: unknown[]
}

let statements: Recorded[] = []
let failOn: ((sql: string, index: number) => boolean) | null = null
let connections = 0

const pool = getPool()
const originalConnect = pool.connect.bind(pool)
Object.assign(pool, {
  connect: async () => {
    connections++
    return {
      query: async (sql: string, params: unknown[] = []) => {
        const index = statements.length
        statements.push({ sql: sql.replace(/\s+/g, ' ').trim(), params })
        if (failOn?.(sql, index)) throw new Error('insert failed')
        return { rowCount: 1, rows: [] }
      },
      release: () => {},
    }
  },
})
after(async () => {
  Object.assign(pool, { connect: originalConnect })
  await closePool()
})

function reset() {
  statements = []
  failOn = null
  connections = 0
}

const kinds = () =>
  statements.map(({ sql }) =>
    sql.startsWith('SELECT pg_advisory_xact_lock') ? 'LOCK' : sql.split(' ')[0]
  )

test('a genre reset is one locked transaction: lock, delete, inserts, commit', async () => {
  reset()
  const updated = await bulkUpdateGenreWeights(
    'user-1',
    [
      { genre: 'Drama', weight: 1.2 },
      { genre: 'Horror', weight: 0.7 },
    ],
    true
  )
  assert.equal(updated, 2)
  assert.deepEqual(kinds(), ['BEGIN', 'LOCK', 'DELETE', 'INSERT', 'INSERT', 'COMMIT'])
  assert.deepEqual(statements[1].params, ['genre-weights', 'user-1'])
})

test('a franchise reset that fails part-way rolls back instead of committing', async () => {
  reset()
  // Fail the second insert: the delete and the first insert must not stand.
  failOn = (sql, index) => sql.includes('INSERT') && index === 4
  await assert.rejects(
    bulkUpdateFranchisePreferences(
      'user-1',
      [
        { franchiseName: 'Alien', mediaType: 'movie', preferenceScore: 0.4, itemsWatched: 3, totalEngagement: 3 },
        { franchiseName: 'Mad Max', mediaType: 'movie', preferenceScore: 0.2, itemsWatched: 2, totalEngagement: 2 },
      ],
      true,
      'movie'
    ),
    /insert failed/
  )
  assert.deepEqual(kinds(), ['BEGIN', 'LOCK', 'DELETE', 'INSERT', 'INSERT', 'ROLLBACK'])
  assert.deepEqual(statements[1].params, ['franchise-preferences', 'user-1'])
})

test('nothing to write and nothing to clear opens no connection', async () => {
  reset()
  assert.equal(await bulkUpdateGenreWeights('user-1', [], false), 0)
  assert.equal(await bulkUpdateFranchisePreferences('user-1', [], false, 'movie'), 0)
  assert.equal(connections, 0)
})

test('an update happens only when it changes the row, and never to a hand-set value', async () => {
  reset()
  await bulkUpdateGenreWeights('user-1', [{ genre: 'Drama', weight: 1.2 }])
  await bulkUpdateFranchisePreferences('user-1', [
    { franchiseName: 'Alien', mediaType: 'movie', preferenceScore: 0.4, itemsWatched: 3, totalEngagement: 3 },
  ])
  const genreInsert = statements.find(({ sql }) => sql.includes('INTO user_genre_weights'))!.sql
  const franchiseInsert = statements.find(({ sql }) => sql.includes('INTO user_franchise_preferences'))!.sql

  const squash = (text: string) => text.replace(/\s+/g, ' ').trim()
  assert.ok(genreInsert.endsWith(`WHERE ${squash(GENRE_ROW_CHANGED)}`))
  assert.ok(franchiseInsert.endsWith(`WHERE ${squash(FRANCHISE_ROW_CHANGED)}`))

  // Genre: a hand-set weight is never touched, an unchanged one is not rewritten.
  assert.match(GENRE_ROW_CHANGED, /NOT user_genre_weights\.is_user_set\s+AND user_genre_weights\.weight IS DISTINCT FROM EXCLUDED\.weight/)
  // Franchise: the score only changes for a detected row, and the counts only when they differ.
  assert.match(
    FRANCHISE_ROW_CHANGED,
    /NOT user_franchise_preferences\.is_user_set\s+AND user_franchise_preferences\.preference_score IS DISTINCT FROM EXCLUDED\.preference_score/
  )
  assert.match(FRANCHISE_ROW_CHANGED, /items_watched IS DISTINCT FROM EXCLUDED\.items_watched/)
  assert.match(FRANCHISE_ROW_CHANGED, /total_engagement IS DISTINCT FROM EXCLUDED\.total_engagement/)
  assert.match(franchiseInsert, /CASE WHEN user_franchise_preferences\.is_user_set THEN user_franchise_preferences\.preference_score/)
})

test('no detector call in core runs in the default reset mode', () => {
  const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
  const files: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) walk(path)
      else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) files.push(path)
    }
  }
  walk(root)

  const bare: string[] = []
  for (const file of files) {
    const source = readFileSync(file, 'utf8')
    for (const call of source.matchAll(/await detectAndUpdate(?:Franchises|Genres)\(([^)]*)\)/g)) {
      if (!/\bmode\b/.test(call[1])) bare.push(`${file}: ${call[0]}`)
    }
  }
  // The settings rescan (apps/api) passes the viewer's chosen mode; inside core,
  // every caller must say which mode it means.
  assert.deepEqual(bare, [])
  assert.ok(files.length > 50, 'the scan found the core sources')
})
