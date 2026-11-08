/**
 * Tool argument normalization (`nullSafe`, tools/utils.ts).
 *
 * The bug this pins: every digit-only string was turned into a number before
 * validation, so a title such as "1917", "1984" or the series "24" reached the
 * field's `z.string()` as a number and the tool call failed. Strings are now
 * converted only where the field is declared a number or a boolean.
 */
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'

process.env.DATABASE_URL ??= 'postgres://unused:unused@127.0.0.1/unused'

const { closePool, getPool } = await import('../../../lib/db.js')
const { coercionFor, nullSafe } = await import('./utils.js')
const { buildToolCatalog } = await import('./index.js')

const pool = getPool()
const originalQuery = pool.query
Object.assign(pool, { query: async () => ({ rowCount: 0, rows: [] }) })
after(async () => {
  Object.assign(pool, { query: originalQuery })
  await closePool()
})

test('a digit-only string stays a string where the field is text', () => {
  const schema = nullSafe(
    z.object({
      title: z.string().describe('The title'),
      limit: z.number().optional(),
      recent: z.boolean().optional(),
      year: z.number().int().min(1900).optional(),
    })
  )
  assert.deepEqual(schema.parse({ title: '1917', limit: '5', recent: 'true', year: '1984' }), {
    title: '1917',
    limit: 5,
    recent: true,
    year: 1984,
  })
  assert.deepEqual(schema.parse({ title: 'true', limit: null }), { title: 'true' })
  assert.deepEqual(schema.parse({ title: '24', limit: '2.5' }), { title: '24', limit: 2.5 })
})

test('wrappers are looked through; a union with a string member is left alone', () => {
  assert.equal(coercionFor(z.number().optional().describe('n')), 'number')
  assert.equal(coercionFor(z.boolean().nullable().default(false)), 'boolean')
  assert.equal(coercionFor(z.string().optional()), null)
  assert.equal(coercionFor(z.enum(['movie', 'series'])), null)
  assert.equal(coercionFor(z.union([z.string(), z.number()])), null)
  assert.equal(coercionFor(z.union([z.literal(1), z.literal(2)])), 'number')
  assert.equal(coercionFor(z.number().refine((n) => n > 0)), 'number')
})

test('a refined root still has its fields coerced by type', () => {
  const schema = nullSafe(
    z.object({ query: z.string(), limit: z.number() }).refine((v) => v.limit > 0)
  )
  assert.deepEqual(schema.parse({ query: '300', limit: '3' }), { query: '300', limit: 3 })
})

test('the real tools accept numeric titles and still coerce numeric fields', async () => {
  const ctx = {
    userId: '00000000-0000-0000-0000-000000000000',
    isAdmin: false,
    scope: { libraryIds: null, maxParentalRating: null, hasMovies: true, hasSeries: true },
    embedding: {},
    mediaServer: null,
  } as unknown as Parameters<typeof buildToolCatalog>[0]
  const tools = await buildToolCatalog(ctx, null)
  const parse = (name: string, input: unknown) =>
    (tools[name].inputSchema as unknown as z.ZodTypeAny).safeParse(input)

  const details = parse('getContentDetails', { title: '1917' })
  assert.ok(details.success, 'getContentDetails refused "1917"')
  assert.deepEqual(details.data, { title: '1917' })

  const search = parse('searchContent', { query: '24', yearMin: '2001', minRating: '7.5' })
  assert.ok(search.success, 'searchContent refused its input')
  assert.equal(search.data.query, '24')
  assert.equal(search.data.yearMin, 2001)
  assert.equal(search.data.minRating, 7.5)
})
