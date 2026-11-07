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
 * The catalog is built the way `handlers/chat.ts` builds it, with the two
 * setting-gated factories switched ON so their tools are checked too.
 */
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { asSchema, type ToolSet } from 'ai'

process.env.DATABASE_URL ??= 'postgres://unused:unused@127.0.0.1/unused'

const { closePool, getPool } = await import('../../../lib/db.js')
const { createTools, createEpisodeTools, createN8nTools, createDiscoveryResolveTool } = await import(
  './index.js'
)

type Context = Parameters<typeof createTools>[0]

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

async function fullCatalog(): Promise<ToolSet> {
  return {
    ...createTools(ctx),
    ...(await createEpisodeTools(ctx)),
    ...(await createN8nTools()),
    ...createDiscoveryResolveTool(ctx, 'something to watch'),
  }
}

const PROVIDER_SAFE_NAME = /^[A-Za-z0-9_-]{1,64}$/

test('the catalog includes the conditional tools, so the check below covers them', async () => {
  const names = Object.keys(await fullCatalog())
  for (const name of ['searchEpisodes', 'search_web', 'findCandidatesInLibrary']) {
    assert.ok(names.includes(name), `${name} missing from the catalog under test`)
  }
})

test('every tool has a provider-safe name and an object input root without a top-level union', async () => {
  const problems: string[] = []
  for (const [name, definition] of Object.entries(await fullCatalog())) {
    if (!PROVIDER_SAFE_NAME.test(name)) problems.push(`${name}: name is not provider-safe`)
    const schema = (await asSchema(definition.inputSchema).jsonSchema) as Record<string, unknown>
    if (schema.type !== 'object') problems.push(`${name}: root type is ${String(schema.type)}, not object`)
    for (const key of ['anyOf', 'oneOf', 'allOf'] as const) {
      if (schema[key]) problems.push(`${name}: root has ${key}`)
    }
  }
  assert.deepEqual(problems, [])
})

test('the check refuses a union root, so a pass above means something', async () => {
  const { z } = await import('zod')
  const union = z.union([z.object({ a: z.string() }), z.object({ b: z.number() })])
  const schema = (await asSchema(union).jsonSchema) as Record<string, unknown>
  assert.ok(schema.type !== 'object' || schema.anyOf || schema.oneOf)
})
