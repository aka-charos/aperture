import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Structural checks over every migration file.
 *
 * These exist because a malformed migration is not an ordinary bug: migrations
 * run at API startup (RUN_MIGRATIONS_ON_START), a failure aborts boot, and the
 * container then crash-loops. There is no degraded mode -- the whole instance
 * is down until someone reads a stack trace.
 *
 * 0154 shipped with `DO $ BEGIN` instead of `DO $$ BEGIN`, because the script
 * that wrote the file collapsed the dollar-quote through a layer of shell
 * escaping. Nothing could have caught it: it is valid text, it typechecks
 * nothing, and no test touched the SQL. It took the instance down.
 */

const MIGRATIONS_DIR = fileURLToPath(new URL('../../../db/migrations', import.meta.url))

function migrationFiles(): Array<{ name: string; sql: string }> {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((name) => ({
      name,
      sql: readFileSync(`${MIGRATIONS_DIR}/${name}`, 'utf8'),
    }))
}

/** Drop `--` line comments so prose about SQL is not mistaken for SQL. */
function stripLineComments(sql: string): string {
  return sql
    .split('\n')
    .map((line) => {
      const i = line.indexOf('--')
      return i === -1 ? line : line.slice(0, i)
    })
    .join('\n')
}

test('there is at least one migration to check', () => {
  // A path mistake would otherwise make every assertion below vacuously true.
  assert.ok(migrationFiles().length > 100, 'migration directory looks wrong')
})

test('every dollar-quoted block is opened and closed', () => {
  for (const { name, sql } of migrationFiles()) {
    const body = stripLineComments(sql)
    const count = (body.match(/\$\$/g) ?? []).length
    assert.equal(count % 2, 0, `${name}: odd number of $$ delimiters (${count})`)
  }
})

test('no DO block opens with a single $', () => {
  // The exact 0154 failure. `DO $ BEGIN` is valid-looking text that Postgres
  // rejects at the first statement, taking the whole file with it.
  for (const { name, sql } of migrationFiles()) {
    const body = stripLineComments(sql)
    const bad = body.match(/\bDO\s+\$(?!\$|[A-Za-z_])/g)
    assert.equal(
      bad,
      null,
      `${name}: DO block opened with a single $ rather than $$ or a named tag`
    )
  }
})

test('no block closes with a single $ before a semicolon', () => {
  for (const { name, sql } of migrationFiles()) {
    const body = stripLineComments(sql)
    const bad = body.match(/\bEND\s+\$(?!\$|[A-Za-z_])\s*;/g)
    assert.equal(bad, null, `${name}: END closed with a single $ rather than $$`)
  }
})

test('migration numbers are unique enough to order, and none is empty', () => {
  // The runner tracks filenames, so a duplicate number is tolerated (0129 is
  // used twice already) -- but an empty file is always a mistake.
  for (const { name, sql } of migrationFiles()) {
    assert.ok(sql.trim().length > 0, `${name} is empty`)
    assert.match(name, /^\d{4}_/, `${name} does not start with a 4-digit number`)
  }
})
