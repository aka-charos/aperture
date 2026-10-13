/**
 * Every parameter the Browse page REPEATS must pass request validation when
 * repeated. Fastify's validator coerces a one-item array to a string and refuses
 * a longer one, so a parameter declared `type: 'string'` answered 400 to every
 * multi-select — country, content rating, video quality and Airing+Ended alike —
 * and the page showed "Failed to load". A test of the SQL cannot see it: the
 * request never reaches the handler.
 *
 * The names come from the client hooks' own `params.append(...)` calls, so a
 * new repeated filter added there is covered without anyone remembering this
 * file. Validation runs through a real Fastify instance with the server's own
 * validator options (config/ajv.ts).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import Fastify from 'fastify'
import { AJV_OPTIONS } from '../config/ajv.js'
import { listMoviesSchema } from './movies/schemas.js'
import { listSeriesSchema } from './series/schemas.js'

const HOOKS = fileURLToPath(new URL('../../../web/src/pages/browse/hooks/', import.meta.url))

/** Parameter names a hook sends with `params.append`, i.e. possibly repeated. */
function repeatedParams(file: string): string[] {
  const source = readFileSync(HOOKS + file, 'utf8')
  return [...new Set([...source.matchAll(/params\.append\(\s*'([A-Za-z]+)'/g)].map((m) => m[1]))]
}

/** A valid value for a parameter, so a test fails on shape and not on content. */
function sampleValues(schema: { properties: Record<string, { items?: { enum?: string[] } }> }, name: string) {
  const enumValues = schema.properties[name]?.items?.enum
  return enumValues && enumValues.length >= 2 ? enumValues.slice(0, 2) : ['First', 'Second']
}

async function validates(querystring: unknown, query: string): Promise<{ status: number; body: string }> {
  const app = Fastify({ ajv: AJV_OPTIONS })
  app.get('/probe', { schema: { querystring } }, async () => ({ ok: true }))
  try {
    const res = await app.inject({ method: 'GET', url: `/probe?${query}` })
    return { status: res.statusCode, body: res.body }
  } finally {
    await app.close()
  }
}

for (const [label, hook, schema] of [
  ['movies', 'useBrowseMovies.ts', listMoviesSchema],
  ['series', 'useBrowseSeries.ts', listSeriesSchema],
] as const) {
  test(`${label}: the hook repeats some parameters (the scan still finds them)`, () => {
    assert.ok(repeatedParams(hook).length >= 3, `${hook}: expected repeated parameters, found ${repeatedParams(hook)}`)
  })

  test(`${label}: every parameter the page repeats is accepted when repeated`, async () => {
    const querystring = schema.querystring as unknown as { properties: Record<string, { items?: { enum?: string[] } }> }
    for (const name of repeatedParams(hook)) {
      assert.ok(name in querystring.properties, `${name} is sent by ${hook} but not declared on the route`)
      const [a, b] = sampleValues(querystring, name)
      const { status, body } = await validates(
        schema.querystring,
        `${name}=${encodeURIComponent(a)}&${name}=${encodeURIComponent(b)}`
      )
      assert.equal(status, 200, `${label} ${name} repeated: ${body}`)
    }
  })

  test(`${label}: a single value is still accepted`, async () => {
    const querystring = schema.querystring as unknown as { properties: Record<string, { items?: { enum?: string[] } }> }
    for (const name of repeatedParams(hook)) {
      const [a] = sampleValues(querystring, name)
      const { status, body } = await validates(schema.querystring, `${name}=${encodeURIComponent(a)}`)
      assert.equal(status, 200, `${label} ${name} once: ${body}`)
    }
  })
}
