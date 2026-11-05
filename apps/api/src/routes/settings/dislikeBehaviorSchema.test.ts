/**
 * The dislike-behavior schema is the route's only validation, and it used to
 * describe a different body (`behavior`, `reductionFactor`) that nothing read.
 * Runs through a real Fastify instance with the server's validator options, and
 * reads the field name off the settings card so the two cannot part.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import Fastify from 'fastify'
import { AJV_OPTIONS } from '../../config/ajv.js'
import { updateDislikeBehaviorSchema } from './schemas.js'

const CARD = fileURLToPath(
  new URL('../../../../web/src/pages/UserSettings/recommendations/LowRatedTitlesCard.tsx', import.meta.url)
)

async function statusFor(payload?: object): Promise<number> {
  const app = Fastify({ ajv: AJV_OPTIONS })
  app.patch('/probe', { schema: { body: updateDislikeBehaviorSchema.body } }, async () => ({ ok: true }))
  try {
    const response = await app.inject({ method: 'PATCH', url: '/probe', payload })
    return response.statusCode
  } finally {
    await app.close()
  }
}

test('both stored values are accepted', async () => {
  assert.equal(await statusFor({ dislikeBehavior: 'exclude' }), 200)
  assert.equal(await statusFor({ dislikeBehavior: 'penalize' }), 200)
})

test('anything else stops at validation, before the query', async () => {
  assert.equal(await statusFor({ dislikeBehavior: 'reduce' }), 400)
  assert.equal(await statusFor({ behavior: 'reduce', reductionFactor: 0.3 }), 400)
  assert.equal(await statusFor({}), 400)
  assert.equal(await statusFor(), 400)
})

test('the card sends the field the schema requires', () => {
  assert.match(readFileSync(CARD, 'utf8'), /JSON\.stringify\(\{ dislikeBehavior: value \}\)/)
})

test('the documentation promises no lower score', () => {
  const documented = JSON.stringify(updateDislikeBehaviorSchema)
  assert.doesNotMatch(documented, /reduce|lowers their score|reductionFactor/)
})
