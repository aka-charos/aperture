import test, { afterEach, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import type { LibraryScope } from '../lib/libraryScope.js'

process.env.DATABASE_URL ??= 'postgres://unused:unused@127.0.0.1/unused'

const { closePool, getPool } = await import('../lib/db.js')
const {
  foldPersonName,
  listPeopleForBrowse,
  orderByCredits,
  peopleListKey,
  peopleMatching,
  peoplePage,
} = await import('./peopleBrowse.js')

const person = (name: string, credits: number) => ({
  name,
  credits,
  movieCredits: credits,
  seriesCredits: 0,
})

const scopeOf = (libraryIds: string[] | null, maxParentalRating: number | null = null): LibraryScope => ({
  libraryIds,
  maxParentalRating,
  hasMovies: true,
  hasSeries: true,
})

test('no two audiences share a key', () => {
  const scopes: Array<[string, LibraryScope]> = [
    ['unrestricted', scopeOf(null)],
    ['no library at all', scopeOf([])],
    ['library a', scopeOf(['a'])],
    ['library b', scopeOf(['b'])],
    ['both', scopeOf(['a', 'b'])],
    ['rated 12', scopeOf(['a'], 12)],
    ['rated 16', scopeOf(['a'], 16)],
    ['unrestricted rated 12', scopeOf(null, 12)],
    ['a value that looks like two ids', scopeOf(['a","b'])],
  ]
  const keys = new Map<string, string>()
  for (const [name, scope] of scopes) {
    const key = peopleListKey(scope)
    assert.equal(keys.get(key), undefined, `${name} shares a key with ${keys.get(key)}`)
    keys.set(key, name)
  }
})

test('id order does not split one audience', () => {
  assert.equal(peopleListKey(scopeOf(['a', 'b'])), peopleListKey(scopeOf(['b', 'a'])))
})

test('a name search folds case the way the database did', () => {
  const finds = (name: string, search: string) => foldPersonName(name).includes(foldPersonName(search))
  assert.ok(finds('Tom Hanks', 'tOM'))
  assert.ok(finds('Levent İnanir', 'inanir'), 'Turkish capital I with a dot')
  assert.ok(finds('Müller', 'MÜLLER'))
  assert.ok(finds('Γιώργος', 'ΓΙΏΡΓΟΣ'))
  assert.ok(finds('Γιώργος', 'γιώργοσ'), 'a sigma is a sigma wherever it falls')
  assert.ok(!finds('José', 'jose'), 'accents still count')
})

test('a search keeps the list order, and is not filtered again for the next page', () => {
  const list = { byName: [person('Ann Lee', 1), person('Bob', 9), person('Hannah', 5)] }
  const matches = peopleMatching(list, 'ANN')
  assert.deepEqual(matches.byName.map((p) => p.name), ['Ann Lee', 'Hannah'])
  assert.equal(peopleMatching(list, 'ann'), matches)
  assert.notEqual(peopleMatching(list, 'bob'), matches)
  assert.equal(list.byName.length, 3)
})

test('names are folded once per list, not once per search', () => {
  const list = { byName: [person('Ann Lee', 1), person('Bob', 9)] } as Parameters<typeof peopleMatching>[0]
  peopleMatching(list, 'ann')
  const folded = list.foldedNames
  assert.deepEqual(folded, ['ann lee', 'bob'])
  assert.deepEqual(peopleMatching(list, 'bob').byName.map((p) => p.name), ['Bob'])
  assert.equal(list.foldedNames, folded)
})

test('search text is taken literally, not as a pattern', () => {
  const list = { byName: [person('Ann', 1), person('50% Man', 1), person('a_b', 1)] }
  assert.deepEqual(peopleMatching(list, '_').byName.map((p) => p.name), ['a_b'])
  assert.deepEqual(peopleMatching(list, '%').byName.map((p) => p.name), ['50% Man'])
})

test('credits order is credits first, the database name order among equals', () => {
  // Name order as a collating database gives it, which is not code-point order.
  const byName = [person('ábel', 3), person('Adam', 5), person('bob', 3), person('Émile', 5)]
  assert.deepEqual(
    orderByCredits(byName).map((p) => p.name),
    ['Adam', 'Émile', 'ábel', 'bob']
  )
  assert.equal(byName[0].name, 'ábel', 'the name order is not disturbed')
})

test('a page is the slice LIMIT and OFFSET would return', () => {
  const list = { byName: Array.from({ length: 120 }, (_, i) => person(`p${i}`, 120 - i)) }

  const first = peoplePage(list, 'name', 1, 50)
  assert.equal(first.people.length, 50)
  assert.equal(first.people[0].name, 'p0')
  assert.equal(first.total, 120)

  const last = peoplePage(list, 'name', 3, 50)
  assert.deepEqual(
    last.people.map((p) => p.name),
    Array.from({ length: 20 }, (_, i) => `p${100 + i}`)
  )
  assert.equal(last.page, 3)
  assert.equal(last.pageSize, 50)

  const past = peoplePage(list, 'name', 4, 50)
  assert.deepEqual(past.people, [])
  assert.equal(past.total, 120)
})

test('the credits order is worked out once and shares the rows', () => {
  const list: { byName: ReturnType<typeof person>[]; byCredits?: ReturnType<typeof person>[] } = {
    byName: [person('a', 1), person('b', 2)],
  }
  const first = peoplePage(list, 'credits', 1, 50)
  assert.deepEqual(first.people.map((p) => p.name), ['b', 'a'])
  const order = list.byCredits
  peoplePage(list, 'credits', 1, 50)
  assert.equal(list.byCredits, order)
  assert.equal(list.byCredits?.[0], list.byName[1])
})

describeDatabase()

function describeDatabase() {
  let queries: Array<{ sql: string; params: unknown[] }>
  let restore: () => void
  /** Rows per library, as the query would have filtered them. */
  const rowsFor = (ids: unknown) =>
    ids === null
      ? [{ name: 'Everyone', credits: 9, movie_credits: 9, series_credits: 0 }]
      : (ids as string[]).map((id) => ({
          name: `Only in ${id}`,
          credits: 1,
          movie_credits: 1,
          series_credits: 0,
        }))

  beforeEach(() => {
    queries = []
    const pool = getPool()
    const original = pool.query
    Object.assign(pool, {
      query: async (sql: string, params: unknown[] = []) => {
        queries.push({ sql, params })
        if (sql.includes('FROM library_config') && !sql.includes('all_contributions')) {
          return { rows: [{ count: '1' }], rowCount: 1 }
        }
        return { rows: rowsFor(params[0] ?? null), rowCount: 1 }
      },
    })
    restore = () => Object.assign(pool, { query: original })
  })

  afterEach(async () => {
    restore()
    await closePool()
  })

  test('every page and both sorts of one list come from one read', async () => {
    const scope = scopeOf(['pages'])
    await listPeopleForBrowse({ scope, page: 1 })
    await listPeopleForBrowse({ scope, page: 2 })
    await listPeopleForBrowse({ scope, page: 1, sortBy: 'credits' })
    await listPeopleForBrowse({ scope, page: 7, pageSize: 10, sortBy: 'credits' })
    assert.equal(queries.length, 1)
    // libraryScopeSql has a LIMIT 1 of its own; a page would bind a parameter.
    assert.doesNotMatch(queries[0].sql, /LIMIT \$|OFFSET/)
    assert.match(queries[0].sql, /ORDER BY name ASC/)
  })

  test('one viewer is never served another viewer\'s people', async () => {
    const a = await listPeopleForBrowse({ scope: scopeOf(['viewer-a']) })
    const b = await listPeopleForBrowse({ scope: scopeOf(['viewer-b']) })
    const rated = await listPeopleForBrowse({ scope: scopeOf(['viewer-a'], 12) })
    assert.deepEqual(a.people.map((p) => p.name), ['Only in viewer-a'])
    assert.deepEqual(b.people.map((p) => p.name), ['Only in viewer-b'])
    assert.equal(queries.length, 3, 'a different rating ceiling is a different audience')
    assert.equal(rated.people.length, 1)

    // Back to the first viewer: their own list, still cached.
    const again = await listPeopleForBrowse({ scope: scopeOf(['viewer-a']) })
    assert.deepEqual(again.people, a.people)
    assert.equal(queries.length, 3)
  })

  test('every search of an audience comes from its one read', async () => {
    const scope = scopeOf(['searches'])
    const all = await listPeopleForBrowse({ scope })
    assert.equal(all.total, 1)
    const found = await listPeopleForBrowse({ scope, search: '  ONLY in ', sortBy: 'credits' })
    const none = await listPeopleForBrowse({ scope, search: 'nobody' })
    assert.equal(queries.length, 1)
    assert.doesNotMatch(queries[0].sql, /ILIKE/)
    assert.deepEqual(found.people.map((p) => p.name), ['Only in searches'])
    assert.equal(found.total, 1)
    assert.deepEqual(none.people, [])
    assert.equal(none.total, 0)
  })

  test('a search stays inside the viewer who asked', async () => {
    const a = await listPeopleForBrowse({ scope: scopeOf(['search-a']), search: 'only' })
    const b = await listPeopleForBrowse({ scope: scopeOf(['search-b']), search: 'only' })
    assert.deepEqual(a.people.map((p) => p.name), ['Only in search-a'])
    assert.deepEqual(b.people.map((p) => p.name), ['Only in search-b'])
  })

  test('showAll never widens a scoped viewer, and does not split their cache', async () => {
    const scope = scopeOf(['show-all'])
    const plain = await listPeopleForBrowse({ scope })
    const wider = await listPeopleForBrowse({ scope, showAll: true })
    assert.deepEqual(wider.people, plain.people)
    assert.equal(queries.length, 1)
  })

  test('a failed read is not remembered', async () => {
    const scope = scopeOf(['flaky'])
    const pool = getPool()
    const working = pool.query
    Object.assign(pool, {
      query: async () => {
        throw new Error('database away')
      },
    })
    await assert.rejects(listPeopleForBrowse({ scope }))
    Object.assign(pool, { query: working })
    const result = await listPeopleForBrowse({ scope })
    assert.deepEqual(result.people.map((p) => p.name), ['Only in flaky'])
  })

  test('without a scope nothing is cached, and the library switch is read live', async () => {
    await listPeopleForBrowse({})
    await listPeopleForBrowse({})
    assert.equal(queries.filter((q) => q.sql.includes('all_contributions')).length, 2)
    assert.match(queries[1].sql, /lc\.is_enabled = true/)

    queries.length = 0
    await listPeopleForBrowse({ showAll: true })
    assert.doesNotMatch(queries[1].sql, /lc\.is_enabled = true/)
  })
}
