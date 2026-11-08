/**
 * Through a real multipart request, because the failure lives there: over its limit
 * the stream ends early without an error, so a test that hands the handler a stream
 * would never see it.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify from 'fastify'
import multipart from '@fastify/multipart'
import { storeBackupUpload } from './upload.js'

const BOUNDARY = 'XBOUNDARYX'

/** `pluginLimit` stands in for the server's own, lower, ceiling. */
async function send(
  options: { name: string; body: string; maxBytes: number; valid?: boolean; pluginLimit?: number }
) {
  const backupRoot = mkdtempSync(join(tmpdir(), 'aperture-upload-test-'))
  const app = Fastify()
  await app.register(multipart, { limits: { fileSize: options.pluginLimit ?? 16 } })
  app.post('/upload', (request, reply) =>
    storeBackupUpload(request, reply, {
      backupRoot,
      maxBytes: options.maxBytes,
      validate: async () => (options.valid === false ? { valid: false, error: 'not a backup' } : { valid: true }),
    })
  )
  await app.ready()
  const response = await app.inject({
    method: 'POST',
    url: '/upload',
    headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
    payload:
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="${options.name}"\r\n` +
      `Content-Type: application/octet-stream\r\n\r\n${options.body}\r\n--${BOUNDARY}--\r\n`,
  })
  await app.close()
  return {
    status: response.statusCode,
    body: JSON.parse(response.body) as { error?: string; filename?: string; sizeBytes?: number },
    files: readdirSync(backupRoot),
    backupRoot,
    done: () => rmSync(backupRoot, { recursive: true, force: true }),
  }
}

test('an upload over the limit is refused, and nothing is kept', async () => {
  const r = await send({ name: 'mine.sql', body: 'A'.repeat(5000), maxBytes: 1024 })
  try {
    assert.equal(r.status, 413)
    assert.match(r.body.error ?? '', /larger than/)
    assert.deepEqual(r.files, [])
  } finally {
    r.done()
  }
})

test('a whole upload is kept whole, past the ceiling other routes get', async () => {
  const body = 'A'.repeat(5000)
  const r = await send({ name: 'mine.dump', body, maxBytes: 10_000, pluginLimit: 1024 })
  try {
    assert.equal(r.status, 200)
    assert.equal(r.body.sizeBytes, 5000)
    assert.deepEqual(r.files, [r.body.filename])
    assert.match(r.body.filename ?? '', /^aperture_uploaded_.*\.dump$/)
    assert.equal(readFileSync(join(r.backupRoot, r.body.filename!), 'utf8'), body)
  } finally {
    r.done()
  }
})

test('a type that cannot be restored is refused', async () => {
  const r = await send({ name: 'mine.zip', body: 'A', maxBytes: 1024 })
  try {
    assert.equal(r.status, 400)
    assert.deepEqual(r.files, [])
  } finally {
    r.done()
  }
})

test('a file that fails validation is not kept', async () => {
  const r = await send({ name: 'mine.dump', body: 'A', maxBytes: 1024, valid: false })
  try {
    assert.equal(r.status, 400)
    assert.match(r.body.error ?? '', /not a backup/)
    assert.deepEqual(r.files, [])
    assert.equal(existsSync(join(r.backupRoot, 'mine.dump')), false)
  } finally {
    r.done()
  }
})
