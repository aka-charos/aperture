/**
 * The library switch sends `provider_library_id`, an id the media server chose:
 * a number on Emby, 32 hex characters on Jellyfin. The schema once required a
 * UUID, so every switch answered 400 before the handler ran and the page, which
 * only changes on success, did nothing. Runs through a real Fastify instance with
 * the server's validator options, since a test of the handler never gets there.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { AJV_OPTIONS } from '../../config/ajv.js'
import { updateLibrarySchema } from './schemas.js'

async function statusFor(id: string): Promise<number> {
  const app = Fastify({ ajv: AJV_OPTIONS })
  app.patch('/libraries/:id', { schema: { params: updateLibrarySchema.params } }, async () => ({ ok: true }))
  try {
    const response = await app.inject({ method: 'PATCH', url: `/libraries/${id}`, payload: {} })
    return response.statusCode
  } finally {
    await app.close()
  }
}

test('a media server library id reaches the handler, whatever shape the server gave it', async () => {
  assert.equal(await statusFor('3'), 200)
  assert.equal(await statusFor('f137a2dd21bbc1b99aa5c0f6bf02a805'), 200)
  assert.equal(await statusFor('f137a2dd-21bb-c1b9-9aa5-c0f6bf02a805'), 200)
})

test('an absurdly long id never reaches the handler', async () => {
  // Fastify's router refuses it (maxParamLength) before the schema is consulted.
  assert.notEqual(await statusFor('x'.repeat(256)), 200)
})
