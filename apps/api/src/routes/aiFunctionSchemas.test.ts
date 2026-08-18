/**
 * The AI roles are declared once, as `AI_FUNCTIONS` in core, and appear as a
 * JSON-Schema `enum` on ten Fastify routes across two schema modules. Those
 * enums are validation, not documentation: a role missing from one is a
 * `400 Bad Request` on the request that asks for its providers or models, which
 * the settings card renders as "no models available" for every provider — with
 * the "add a custom model" escape hatch rejected by the same rule. That is
 * exactly how `titleAnalysis` shipped unusable.
 *
 * TypeScript cannot check a hand-written copy of a union against the union, so
 * this test is the check: any enum listing AI roles must be the shared list,
 * whole and in order.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { AI_FUNCTIONS } from '@aperture/core'
import * as settingsSchemas from './settings/schemas.js'
import { setupSchemas } from './setup/schemas.js'

/** A JSON-Schema fragment, walked structurally rather than by known key paths. */
type Node = Record<string, unknown>

const isNode = (value: unknown): value is Node =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Every `enum` in the tree that is talking about AI roles. Recognised by naming
 * a role rather than by where it sits, so an enum added on a new route is
 * covered without this test knowing the route exists.
 */
function collectRoleEnums(root: unknown, path: string, found: Array<{ path: string; values: string[] }>) {
  if (Array.isArray(root)) {
    root.forEach((item, i) => collectRoleEnums(item, `${path}[${i}]`, found))
    return
  }
  if (!isNode(root)) return

  for (const [key, value] of Object.entries(root)) {
    if (key === 'enum' && Array.isArray(value)) {
      const values = value.filter((v): v is string => typeof v === 'string')
      if (values.some((v) => (AI_FUNCTIONS as readonly string[]).includes(v))) {
        found.push({ path: `${path}.${key}`, values })
      }
      continue
    }
    collectRoleEnums(value, `${path}.${key}`, found)
  }
}

function roleEnumsIn(module: unknown, label: string): Array<{ path: string; values: string[] }> {
  const found: Array<{ path: string; values: string[] }> = []
  collectRoleEnums(module, label, found)
  return found
}

test('every AI-role enum in the settings schemas is the shared list', () => {
  const enums = roleEnumsIn(settingsSchemas, 'settings')
  assert.ok(enums.length > 0, 'expected the settings schemas to declare AI-role enums')
  for (const { path, values } of enums) {
    assert.deepEqual(values, [...AI_FUNCTIONS], `${path} drifted from AI_FUNCTIONS`)
  }
})

test('every AI-role enum in the setup schemas is the shared list', () => {
  const enums = roleEnumsIn(setupSchemas, 'setup')
  assert.ok(enums.length > 0, 'expected the setup schemas to declare AI-role enums')
  for (const { path, values } of enums) {
    assert.deepEqual(values, [...AI_FUNCTIONS], `${path} drifted from AI_FUNCTIONS`)
  }
})

test('titleAnalysis is a role, and so is reachable through those enums', () => {
  // The regression in one line: the role existed in the type and in every
  // handler, and was rejected at the door by the schema.
  assert.ok((AI_FUNCTIONS as readonly string[]).includes('titleAnalysis'))

  const everyEnum = [...roleEnumsIn(settingsSchemas, 'settings'), ...roleEnumsIn(setupSchemas, 'setup')]
  for (const { path, values } of everyEnum) {
    assert.ok(values.includes('titleAnalysis'), `${path} would 400 a Title Analysis request`)
  }
})

// ============================================================================
// The copy TypeScript could not see
// ============================================================================

/**
 * The schema enums above are checkable because they are JavaScript. The sixth
 * copy of the role list was not: migration `0089` wrote
 * `CHECK (function_type IN ('embeddings','chat','textGeneration','exploration'))`
 * on `custom_ai_models` and nothing ever revisited it, so the database rejected
 * `webSearch` and `titleAnalysis` for as long as those roles existed. Nobody
 * noticed the first one — Google is not a custom-model provider, so no request
 * could reach it. The second broke the only path that role has: `titleAnalysis`
 * usually points at a local or OpenRouter model, and every catalog that ships
 * zero built-ins requires adding a custom model per role. The dialog validated
 * the model, said so, and then took a 500 from a constraint.
 *
 * `0144` dropped it rather than extending it. This is the tripwire that keeps it
 * dropped: SQL is the one place a role list can be restated without any build
 * failing, so the rule is that it may not be restated there at all.
 */
const MIGRATIONS_DIR = path.resolve(fileURLToPath(import.meta.url), '../../../../../db/migrations')

/** The migration that removed the last SQL copy. Everything before it is history. */
const CONSTRAINT_DROPPED_IN = 144

test('no migration after 0144 restates the AI role list as a CHECK constraint', () => {
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .filter((name) => Number.parseInt(name.slice(0, 4), 10) > CONSTRAINT_DROPPED_IN)

  const offenders: string[] = []

  for (const name of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, name), 'utf8')
    // Statement granularity, so a role literal in one CHECK is not blamed on a
    // different statement that happens to share the file.
    for (const statement of sql.split(';')) {
      if (!/\bCHECK\s*\(/i.test(statement)) continue
      // Two or more distinct roles in one CHECK is the role list; one alone is
      // far more likely to be an unrelated column that shares a word.
      const named = AI_FUNCTIONS.filter((role) => statement.includes(`'${role}'`))
      if (named.length >= 2) {
        offenders.push(`${name}: CHECK naming ${named.join(', ')}`)
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `A CHECK constraint cannot be derived from AI_FUNCTIONS and TypeScript cannot see it, ` +
      `which is how the last one stayed stale through two new roles. Validate the role in ` +
      `the route schema and in addCustomModel instead:\n  ${offenders.join('\n  ')}`
  )
})
