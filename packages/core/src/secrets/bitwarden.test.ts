import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSecretStore, type BwsRunner } from './bitwarden.js'
import { SECRETS_RETRY_MS, SECRETS_TTL_MS, secretRefFor } from './rules.js'

const ENV = {
  BWS_ACCESS_TOKEN: '0.token',
  BWS_PROJECT_ID: '7b006643-89c1-4202-a5ca-90510f566030',
}

function listing(secrets: Record<string, string>): string {
  return JSON.stringify(Object.entries(secrets).map(([key, value]) => ({ key, value })))
}

function harness(run: BwsRunner, env: Record<string, string | undefined> = ENV) {
  const clock = { now: 1_000_000 }
  let calls = 0
  const store = createSecretStore({
    run: (bootstrap) => {
      calls += 1
      return run(bootstrap)
    },
    now: () => clock.now,
    env: () => env,
  })
  return { store, clock, calls: () => calls }
}

test('a plain value passes through and the CLI is never run for it', async () => {
  const h = harness(async () => listing({}))
  assert.equal(await h.store.resolve('plain-key'), 'plain-key')
  assert.equal(await h.store.resolve(null), null)
  assert.equal(h.calls(), 0)
})

test('a reference resolves to its secret, from one read shared by every caller', async () => {
  const h = harness(async () => listing({ TMDB: 'tmdb-value', OMDB: 'omdb-value' }))
  const [a, b, c] = await Promise.all([
    h.store.resolve(secretRefFor('TMDB')),
    h.store.resolve(secretRefFor('OMDB')),
    h.store.resolve(secretRefFor('TMDB')),
  ])
  assert.deepEqual([a, b, c], ['tmdb-value', 'omdb-value', 'tmdb-value'])
  assert.equal(h.calls(), 1)

  h.clock.now += SECRETS_TTL_MS - 1
  await h.store.resolve(secretRefFor('TMDB'))
  assert.equal(h.calls(), 1, 'still inside the window')

  h.clock.now += 1
  await h.store.resolve(secretRefFor('TMDB'))
  await h.store.ensure()
  assert.equal(h.calls(), 2, 'read again once the window has passed')
})

test('once there are values, a read that is due never holds up the answer', async () => {
  const gate: { release: () => void } = { release: () => {} }
  let hang = false
  const h = harness(async () => {
    if (hang) await new Promise<void>((resolve) => (gate.release = resolve))
    return listing({ KEY: 'v2' })
  })
  // Seed with a first value through a separate runner state.
  hang = false
  await h.store.ensure()
  assert.equal(await h.store.resolve(secretRefFor('KEY')), 'v2')

  // The window passes and Bitwarden stops answering.
  hang = true
  h.clock.now += SECRETS_TTL_MS
  const answered = await Promise.race([
    h.store.resolve(secretRefFor('KEY')),
    new Promise((resolve) => setTimeout(() => resolve('blocked'), 200)),
  ])
  assert.equal(answered, 'v2', 'answered from memory while the read is still running')
  assert.equal(h.calls(), 2, 'the read was started')

  // More lookups join the same read rather than starting others.
  await h.store.resolve(secretRefFor('KEY'))
  assert.equal(h.calls(), 2)
  gate.release()
})

test('a store that has never read the project waits for the first read', async () => {
  const gate: { release: () => void } = { release: () => {} }
  const h = harness(async () => {
    await new Promise<void>((resolve) => (gate.release = resolve))
    return listing({ KEY: 'v' })
  })
  const pending = h.store.resolve(secretRefFor('KEY'))
  const early = await Promise.race([pending, new Promise((resolve) => setTimeout(() => resolve('waiting'), 50))])
  assert.equal(early, 'waiting')
  gate.release()
  assert.equal(await pending, 'v')
})

test('a rotated secret is picked up by the next read', async () => {
  let value = 'old'
  const h = harness(async () => listing({ KEY: value }))
  assert.equal(await h.store.resolve(secretRefFor('KEY')), 'old')
  value = 'new'
  await h.store.ensure(true)
  assert.equal(await h.store.resolve(secretRefFor('KEY')), 'new')
})

test('a reference that cannot be honoured is null, never the reference text', async () => {
  const h = harness(async () => listing({ KEY: 'v' }))
  assert.equal(await h.store.resolve(secretRefFor('GONE')), null)
})

test('a failed read keeps serving the last good values and reports itself stale', async () => {
  let fail = false
  const h = harness(async () => {
    if (fail) throw Object.assign(new Error('boom'), { code: 1, stderr: 'connection refused' })
    return listing({ KEY: 'v' })
  })
  assert.equal(await h.store.resolve(secretRefFor('KEY')), 'v')

  fail = true
  h.clock.now += SECRETS_TTL_MS
  assert.equal(await h.store.resolve(secretRefFor('KEY')), 'v')
  await h.store.ensure()
  assert.equal(h.calls(), 2)
  const status = h.store.status()
  assert.equal(status.connected, true)
  assert.equal(status.stale, true)
  assert.equal(status.lastFailure?.kind, 'failed')
  assert.equal(status.lastFailure?.detail, 'connection refused')

  // A down server is not asked on every lookup...
  await h.store.resolve(secretRefFor('KEY'))
  assert.equal(h.calls(), 2)
  // ...and is asked again after the retry wait, clearing the failure on success.
  fail = false
  h.clock.now += SECRETS_RETRY_MS
  await h.store.ensure()
  assert.equal(h.calls(), 3)
  assert.equal(h.store.status().stale, false)
  assert.equal(h.store.status().lastFailure, null)
})

test('a first read that fails leaves references unavailable, not empty-project', async () => {
  const h = harness(async () => {
    throw Object.assign(new Error('spawn bws ENOENT'), { code: 'ENOENT' })
  })
  assert.equal(await h.store.resolve(secretRefFor('KEY')), null)
  assert.deepEqual(await h.store.lookup('KEY'), { status: 'unreachable' })
  const status = h.store.status()
  assert.equal(status.configured, true)
  assert.equal(status.connected, false)
  assert.equal(status.lastFailure?.kind, 'notInstalled')
})

test('output that is not a secret list is a failure and replaces nothing', async () => {
  let output = listing({ KEY: 'v' })
  const h = harness(async () => output)
  await h.store.ensure()
  output = 'Warning: something that is not JSON'
  await h.store.ensure(true)
  assert.equal(await h.store.resolve(secretRefFor('KEY')), 'v')
  assert.equal(h.store.status().lastFailure?.kind, 'unreadable')
})

test('without a token the CLI is never run and status says the feature is off', async () => {
  const h = harness(async () => listing({ KEY: 'v' }), {})
  assert.equal(await h.store.resolve(secretRefFor('KEY')), null)
  assert.equal(h.calls(), 0)
  assert.deepEqual(
    { configured: h.store.status().configured, problem: h.store.status().problem },
    { configured: false, problem: null }
  )
})

test('status and names never include a value', async () => {
  const h = harness(async () =>
    JSON.stringify([
      { key: 'B', value: 'value-b' },
      { key: 'A', value: 'value-a' },
      { key: 'DUP', value: 'value-1' },
      { key: 'DUP', value: 'value-2' },
    ])
  )
  await h.store.ensure()
  assert.deepEqual(h.store.names(), ['A', 'B'])
  const status = h.store.status()
  assert.equal(status.secretCount, 3)
  assert.deepEqual(status.ambiguousNames, ['DUP'])
  assert.equal(/value-/.test(JSON.stringify(status)), false)
  assert.equal(JSON.stringify(status).includes('0.token'), false)
})

test('the token is handed to the runner, with the project and server', async () => {
  let seen: unknown = null
  const h = harness(
    async (bootstrap) => {
      seen = bootstrap
      return '[]'
    },
    { ...ENV, BWS_SERVER_URL: 'https://vault.bitwarden.eu' }
  )
  await h.store.ensure()
  assert.deepEqual(seen, {
    accessToken: '0.token',
    projectId: ENV.BWS_PROJECT_ID,
    serverUrl: 'https://vault.bitwarden.eu',
    bwsPath: 'bws',
  })
})
