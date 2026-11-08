/**
 * Input the server refuses before a handler runs, checked through a real
 * Fastify instance with the server's own validator options (config/ajv.ts),
 * so what passes here passes in production.
 *
 * - The two hand-set preference saves (genre weights, franchise scores) wrote
 *   one entry at a time and refused a bad value only when they reached it,
 *   after earlier entries were saved; a score that was not a number passed the
 *   range check and was stored as NaN, which recommendation scoring reads.
 * - A conversation title was stored as sent, of any type or length.
 * - Route parameters are decoded once by the router. A second
 *   decodeURIComponent in a handler broke any name holding a '%'.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Fastify from 'fastify'

process.env.DATABASE_URL ??= 'postgres://unused:unused@127.0.0.1/unused'

const { AJV_OPTIONS } = await import('../config/ajv.js')
const { updateFranchisePreferencesSchema, updateGenreWeightsSchema } = await import('./settings/schemas.js')
const { renameConversationSchema, CONVERSATION_TITLE_MAX } = await import('./assistant/handlers/conversations.js')

/** Status and the body the handler received, for one PUT through a schema. */
async function send(schema: object, payload: unknown): Promise<{ status: number; body: unknown }> {
  const app = Fastify({ ajv: AJV_OPTIONS })
  let received: unknown
  app.put('/probe', { schema: schema as never }, async (request) => {
    received = request.body
    return { ok: true }
  })
  try {
    const res = await app.inject({ method: 'PUT', url: '/probe', payload: payload as never })
    return { status: res.statusCode, body: received }
  } finally {
    await app.close()
  }
}

test('a franchise batch with one bad entry is refused whole, before anything is saved', async () => {
  const good = { franchiseName: 'Alien', mediaType: 'movie', preferenceScore: 0.5 }
  assert.equal((await send(updateFranchisePreferencesSchema, { franchises: [good] })).status, 200)

  for (const bad of [
    { ...good, preferenceScore: 'abc' }, // stored as NaN before
    { ...good, preferenceScore: 1.5 },
    { ...good, mediaType: 'film' },
    { ...good, franchiseName: '' },
    { franchiseName: 'Alien', mediaType: 'movie' },
  ]) {
    const res = await send(updateFranchisePreferencesSchema, { franchises: [good, bad] })
    assert.equal(res.status, 400, JSON.stringify(bad))
    assert.equal(res.body, undefined, 'the handler ran')
  }
  assert.equal((await send(updateFranchisePreferencesSchema, { franchises: 'Alien' })).status, 400)
})

test('a genre batch with one bad entry is refused whole, and numeric strings still count', async () => {
  const ok = await send(updateGenreWeightsSchema, { genres: [{ genre: 'Drama', weight: '1.5' }] })
  assert.equal(ok.status, 200)
  assert.deepEqual(ok.body, { genres: [{ genre: 'Drama', weight: 1.5 }] })

  for (const bad of [{ genre: 'Horror', weight: 'NaN' }, { genre: 'Horror', weight: 3 }, { genre: '', weight: 1 }]) {
    const res = await send(updateGenreWeightsSchema, { genres: [{ genre: 'Drama', weight: 1 }, bad] })
    assert.equal(res.status, 400, JSON.stringify(bad))
  }
})

test('a conversation title is a short string', async () => {
  assert.equal((await send(renameConversationSchema, { title: 'Films for a rainy Sunday' })).status, 200)
  assert.equal((await send(renameConversationSchema, { title: 'x'.repeat(CONVERSATION_TITLE_MAX + 1) })).status, 400)
  assert.equal((await send(renameConversationSchema, { title: { nested: true } })).status, 400)
  assert.equal((await send(renameConversationSchema, {})).status, 400)
  assert.equal((await send(renameConversationSchema, { title: '' })).status, 400)
})

test('the router decodes a parameter once, so a name with % arrives intact', async () => {
  const app = Fastify({ ajv: AJV_OPTIONS })
  app.get('/franchises/:name', async (request) => ({ name: (request.params as { name: string }).name }))
  try {
    // What the web sends: encodeURIComponent('100% Wolf Collection').
    const res = await app.inject({ method: 'GET', url: `/franchises/${encodeURIComponent('100% Wolf Collection')}` })
    assert.deepEqual(res.json(), { name: '100% Wolf Collection' })
  } finally {
    await app.close()
  }
  // A second decode of that value is what broke: it throws.
  assert.throws(() => decodeURIComponent('100% Wolf Collection'), URIError)
})

test('the real routes refuse bad input before anything else runs', async () => {
  // Body validation runs before every preHandler, so through the real
  // registrations a bad body answers 400 and a good one reaches the sign-in
  // check (401, there is no session). A route that lost its schema would let
  // the bad body through to that same 401.
  const { registerTasteProfileHandlers } = await import('./settings/handlers/tasteProfile.js')
  const { registerConversationHandlers } = await import('./assistant/handlers/conversations.js')
  const app = Fastify({ ajv: AJV_OPTIONS, logger: false })
  await app.register(async (scope) => {
    registerTasteProfileHandlers(scope)
    registerConversationHandlers(scope)
  })
  await app.ready()
  const status = async (method: 'PUT' | 'PATCH' | 'POST', url: string, payload: unknown) =>
    (await app.inject({ method, url, payload: payload as never })).statusCode
  try {
    const genre = '/api/settings/taste-profile/genres'
    assert.equal(await status('PUT', genre, { genres: [{ genre: 'Drama', weight: 'NaN' }] }), 400)
    assert.equal(await status('PUT', genre, { genres: [{ genre: 'Drama', weight: 1 }] }), 401)

    const franchise = '/api/settings/taste-profile/franchises'
    const good = { franchiseName: 'Alien', mediaType: 'movie', preferenceScore: 0.5 }
    assert.equal(await status('PUT', franchise, { franchises: [good, { ...good, preferenceScore: 'abc' }] }), 400)
    assert.equal(await status('PUT', franchise, { franchises: [good] }), 401)

    const conversation = '/api/assistant/conversations/00000000-0000-0000-0000-000000000000'
    assert.equal(await status('PATCH', conversation, { title: 'x'.repeat(CONVERSATION_TITLE_MAX + 1) }), 400)
    assert.equal(await status('PATCH', conversation, { title: 'Rainy Sunday' }), 401)

    assert.equal(await status('POST', '/api/assistant/conversations', { title: { nested: true } }), 400)
    assert.equal(await status('POST', '/api/assistant/conversations', { title: 'x'.repeat(CONVERSATION_TITLE_MAX + 1) }), 400)
    // What the browser sends: an empty object, for the default title.
    assert.equal(await status('POST', '/api/assistant/conversations', {}), 401)
  } finally {
    await app.close()
  }
})

/** The one deliberate decode, and why it stays. */
const DECODE_ALLOWED: Record<string, string> = {
  'config/cors.ts': 'decodes the RAW request URL to judge its path, as the router does; nothing has decoded it yet',
}

test('nothing in the API decodes a parameter or query value a second time', () => {
  const src = fileURLToPath(new URL('..', import.meta.url))
  const offenders: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) walk(path)
      else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) {
        const relative = path.slice(src.length).replace(/\\/g, '/').replace(/^\//, '')
        if (DECODE_ALLOWED[relative]) continue
        if (/decodeURIComponent\(/.test(readFileSync(path, 'utf8'))) offenders.push(relative)
      }
    }
  }
  walk(src)
  assert.deepEqual(offenders, [])
  // An allowlisted file that stopped decoding is a stale entry.
  for (const file of Object.keys(DECODE_ALLOWED)) {
    assert.match(readFileSync(join(src, file), 'utf8'), /decodeURIComponent\(/, `${file} no longer decodes`)
  }
})
