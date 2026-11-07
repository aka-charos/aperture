/**
 * Every tool the chat can hand a model must have a provider-safe name and an
 * input schema whose ROOT is an object, with no top-level union.
 *
 * OpenAI (and OpenAI-compatible servers that copy its rules) refuse the whole
 * request when one tool's root is `anyOf`/`oneOf` or not an object, so a single
 * `z.union(...)` or `a.or(b)` as an `inputSchema` breaks every chat turn, while
 * the provider's own Test button still passes (it sends no tools). Upstream hit
 * exactly this with a playlist tool. Branch on a field inside one object
 * (`operation: z.enum([...])`) and check the combination in `execute` instead.
 *
 * The catalog comes from `buildToolCatalog`, the function the chat handler
 * sends, for both a library and a discovery turn, with the two setting-gated
 * factories switched ON so their tools are checked too.
 */
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { asSchema, type ToolSet } from 'ai'
import { z } from 'zod'

process.env.DATABASE_URL ??= 'postgres://unused:unused@127.0.0.1/unused'

const { closePool, getPool } = await import('../../../lib/db.js')
const { buildToolCatalog } = await import('./index.js')

type Context = Parameters<typeof buildToolCatalog>[0]

const ctx = {
  userId: '00000000-0000-0000-0000-000000000000',
  isAdmin: true,
  scope: { libraryIds: null, maxParentalRating: null, hasMovies: true, hasSeries: true },
  embedding: {},
  mediaServer: null,
} as unknown as Context

/** Settings that switch on every conditional tool; anything else reads as unset. */
const SETTINGS: Record<string, string> = {
  episode_embeddings_enabled: 'true',
  n8n_integration: JSON.stringify({
    searchTool: { enabled: true, webhookUrl: 'http://n8n.invalid/webhook' },
    preProcess: null,
  }),
}

const pool = getPool()
const originalQuery = pool.query
Object.assign(pool, {
  query: async (sql: string, params: unknown[] = []) => {
    const value = /FROM system_settings/i.test(sql) ? SETTINGS[String(params[0])] : undefined
    return { rowCount: value == null ? 0 : 1, rows: value == null ? [] : [{ value }] }
  },
})
after(async () => {
  Object.assign(pool, { query: originalQuery })
  await closePool()
})

/** Both turn kinds: a discovery turn adds a tool and drops others. */
async function catalogs(): Promise<Array<[string, ToolSet]>> {
  return [
    ['library turn', await buildToolCatalog(ctx, null)],
    ['discovery turn', await buildToolCatalog(ctx, { userRequest: 'something to watch' })],
  ]
}

const PROVIDER_SAFE_NAME = /^[A-Za-z0-9_-]{1,64}$/

/** What a provider would refuse about one tool; empty when it is acceptable. */
async function rootSchemaProblems(name: string, inputSchema: unknown): Promise<string[]> {
  const problems: string[] = []
  if (!PROVIDER_SAFE_NAME.test(name)) problems.push(`${name}: name is not provider-safe`)
  const schema = (await asSchema(inputSchema as Parameters<typeof asSchema>[0]).jsonSchema) as Record<
    string,
    unknown
  >
  if (schema.type !== 'object') problems.push(`${name}: root type is ${String(schema.type)}, not object`)
  for (const key of ['anyOf', 'oneOf', 'allOf'] as const) {
    if (schema[key]) problems.push(`${name}: root has ${key}`)
  }
  return problems
}

test('the catalogs include the conditional tools, so the check below covers them', async () => {
  const names = new Set((await catalogs()).flatMap(([, tools]) => Object.keys(tools)))
  for (const name of ['searchEpisodes', 'search_web', 'findCandidatesInLibrary', 'semanticSearch']) {
    assert.ok(names.has(name), `${name} missing from the catalogs under test`)
  }
})

test('a discovery turn adds findCandidatesInLibrary and drops the list tools it duplicates', async () => {
  const [[, library], [, discovery]] = await catalogs()
  const { DISCOVERY_SUPPRESSED_TOOLS } = await import('./index.js')
  assert.ok(!('findCandidatesInLibrary' in library))
  assert.ok('findCandidatesInLibrary' in discovery)
  for (const name of DISCOVERY_SUPPRESSED_TOOLS) {
    assert.ok(name in library, `${name} should be offered on a library turn`)
    assert.ok(!(name in discovery), `${name} should be withheld on a discovery turn`)
  }
})

test('every tool has a provider-safe name and an object input root without a top-level union', async () => {
  const problems: string[] = []
  for (const [turn, tools] of await catalogs()) {
    for (const [name, definition] of Object.entries(tools)) {
      for (const problem of await rootSchemaProblems(name, definition.inputSchema)) {
        problems.push(`${turn}: ${problem}`)
      }
    }
  }
  assert.deepEqual(problems, [])
})

test('the check refuses what a provider refuses, so a pass above means something', async () => {
  const a = z.object({ a: z.string() })
  const b = z.object({ b: z.number() })
  assert.ok((await rootSchemaProblems('unionTool', z.union([a, b]))).length > 0, 'union root')
  assert.ok((await rootSchemaProblems('orTool', a.or(b))).length > 0, '.or() root')
  assert.ok((await rootSchemaProblems('andTool', a.and(b))).length > 0, 'intersection root')
  assert.ok((await rootSchemaProblems('stringTool', z.string())).length > 0, 'non-object root')
  assert.ok((await rootSchemaProblems('bad name!', a)).length > 0, 'unsafe name')
  assert.deepEqual(await rootSchemaProblems('fine_tool', a), [])
})
