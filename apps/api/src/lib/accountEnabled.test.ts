/**
 * Who can sign in. Both ways this goes wrong are silent: an account whose switches
 * all read off keeps signing in, or an admin locks themselves out of the console.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { accountEnabledSql, isAccountEnabled, type AccountEnabledInput } from './accountEnabled.js'

const ALL_OFF: AccountEnabledInput = {
  moviesEnabled: false,
  seriesEnabled: false,
  discoverEnabled: false,
  collectionsEnabled: false,
  isAdmin: false,
  wasEnabled: true,
}

test('any one of the four switches enables an account', () => {
  for (const key of ['moviesEnabled', 'seriesEnabled', 'discoverEnabled', 'collectionsEnabled'] as const) {
    assert.equal(isAccountEnabled({ ...ALL_OFF, wasEnabled: false, [key]: true }), true, key)
  }
})

test('an account with every switch off is disabled, however many saves that took', () => {
  // The bug: the route cleared the flag only when Movies and Series arrived off in
  // one request, and the Users page sends one switch per request.
  assert.equal(isAccountEnabled(ALL_OFF), false)
})

test('an enabled admin switching everything off is not locked out', () => {
  assert.equal(isAccountEnabled({ ...ALL_OFF, isAdmin: true }), true)
})

test('being an admin does not enable an account that was off', () => {
  // The user sync imports every Emby administrator switched off.
  assert.equal(isAccountEnabled({ ...ALL_OFF, isAdmin: true, wasEnabled: false }), false)
})

test('a switch written by the same UPDATE is read from its new value, the rest from the row', () => {
  assert.equal(
    accountEnabledSql({ movies_enabled: '$3', discover_enabled: '$5' }),
    '($3 OR series_enabled OR $5 OR collections_enabled OR (is_admin AND is_enabled))'
  )
})

/** Evaluates accountEnabledSql's shape — ORs of columns and one parenthesised AND — against a row. */
function evaluate(sql: string, row: Record<string, boolean>): boolean {
  const value = (name: string): boolean => {
    if (!(name in row)) throw new Error(`unknown column ${name}`)
    return row[name]
  }
  return sql
    .slice(1, -1)
    .split(' OR ')
    .some((term) => (term.startsWith('(') ? term.slice(1, -1).split(' AND ').every((name) => value(name)) : value(term)))
}

test('the SQL and the function agree on every row', () => {
  // INSERT writers use the function and UPDATE writers the SQL, so the two copies
  // of the rule must not drift. A switch missing from the SQL fails here.
  const columns = ['movies_enabled', 'series_enabled', 'discover_enabled', 'collections_enabled', 'is_admin', 'is_enabled']
  for (let bits = 0; bits < 2 ** columns.length; bits++) {
    const row: Record<string, boolean> = Object.fromEntries(columns.map((column, i) => [column, (bits & (1 << i)) !== 0]))
    const expected = isAccountEnabled({
      moviesEnabled: row.movies_enabled,
      seriesEnabled: row.series_enabled,
      discoverEnabled: row.discover_enabled,
      collectionsEnabled: row.collections_enabled,
      isAdmin: row.is_admin,
      wasEnabled: row.is_enabled,
    })
    assert.equal(evaluate(accountEnabledSql(), row), expected, JSON.stringify(row))
  }
})
