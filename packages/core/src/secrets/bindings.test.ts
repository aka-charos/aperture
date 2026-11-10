import { test } from 'node:test'
import assert from 'node:assert/strict'
// The factory only: importing `bindings.ts` itself would open the database.
import type { SecretBindingsDeps } from './bindings.js'
import { BINDABLE_SECRETS, lookupSecret, parseSecretList, secretRefFor } from './rules.js'

async function load() {
  // `bindings.ts` builds its default instance over the settings module, which
  // needs DATABASE_URL to import. A placeholder is enough: nothing here queries.
  process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/test'
  return (await import('./bindings.js')).createSecretBindings
}

function harness(rows: Record<string, string>, secrets: Array<{ key: string; value: string }> | null) {
  const store = new Map(Object.entries(rows))
  const snapshot = secrets ? parseSecretList(JSON.stringify(secrets)) : null
  const writes: Array<[string, string]> = []
  const removed: string[] = []
  let manyReads = 0
  const deps: SecretBindingsDeps = {
    readRaw: async (key) => store.get(key) ?? null,
    readManyRaw: async (keys) => {
      manyReads += 1
      return new Map(keys.filter((k) => store.has(k)).map((k) => [k, store.get(k) as string]))
    },
    write: async (key, value) => {
      writes.push([key, value])
      store.set(key, value)
    },
    remove: async (key) => {
      removed.push(key)
      store.delete(key)
    },
    lookup: async (name) => lookupSecret(snapshot, name),
  }
  return { deps, store, writes, removed, manyReads: () => manyReads }
}

const SECRETS = [
  { key: 'TMDB', value: 'tmdb-secret-value' },
  { key: 'EMPTY', value: '' },
  { key: 'DUP', value: 'a' },
  { key: 'DUP', value: 'b' },
]

test('every credential is listed with its source, from one read', async () => {
  const createSecretBindings = await load()
  const h = harness(
    {
      tmdb_api_key: secretRefFor('TMDB'),
      omdb_api_key: 'plain-omdb-key',
      seerr_api_key: secretRefFor('GONE'),
      mdblist_api_key: '   ',
    },
    SECRETS
  )
  const list = await createSecretBindings(h.deps).list()
  assert.equal(h.manyReads(), 1)
  assert.deepEqual(
    list.map((b) => b.id),
    BINDABLE_SECRETS.map((s) => s.id)
  )
  const byId = Object.fromEntries(list.map((b) => [b.id, b]))
  assert.deepEqual(byId.tmdb, { id: 'tmdb', source: 'bitwarden', secretName: 'TMDB', state: 'ok' })
  assert.deepEqual(byId.omdb, { id: 'omdb', source: 'stored', secretName: null, state: null })
  // A link whose secret is gone is still a link, and says why it has no key.
  assert.deepEqual(byId.seerr, { id: 'seerr', source: 'bitwarden', secretName: 'GONE', state: 'missing' })
  assert.equal(byId.mdblist.source, 'none')
  assert.equal(byId.mediaServer.source, 'none')
  // The listing never carries a value, stored or linked.
  assert.equal(/tmdb-secret-value|plain-omdb-key/.test(JSON.stringify(list)), false)
})

test('an unreadable project leaves links listed as unreachable, not unset', async () => {
  const createSecretBindings = await load()
  const h = harness({ tmdb_api_key: secretRefFor('TMDB') }, null)
  const [tmdb] = (await createSecretBindings(h.deps).list()).filter((b) => b.id === 'tmdb')
  assert.deepEqual(tmdb, { id: 'tmdb', source: 'bitwarden', secretName: 'TMDB', state: 'unreachable' })
})

test('linking stores the reference and never the value', async () => {
  const createSecretBindings = await load()
  const h = harness({ tmdb_api_key: 'old-plain-key' }, SECRETS)
  assert.deepEqual(await createSecretBindings(h.deps).bind('tmdb', 'TMDB'), { ok: true })
  assert.deepEqual(h.writes, [['tmdb_api_key', 'bws:TMDB']])
})

test('a link is refused unless the secret can be read right now', async () => {
  const createSecretBindings = await load()
  const h = harness({ tmdb_api_key: 'old-plain-key' }, SECRETS)
  const bindings = createSecretBindings(h.deps)
  assert.deepEqual(await bindings.bind('tmdb', 'GONE'), { ok: false, reason: 'missing' })
  assert.deepEqual(await bindings.bind('tmdb', 'EMPTY'), { ok: false, reason: 'empty' })
  assert.deepEqual(await bindings.bind('tmdb', 'DUP'), { ok: false, reason: 'ambiguous' })
  assert.deepEqual(await bindings.bind('tmdb', ' TMDB'), { ok: false, reason: 'invalidName' })
  assert.deepEqual(await bindings.bind('tmdb', 42), { ok: false, reason: 'invalidName' })
  assert.deepEqual(await bindings.bind('smtp', 'TMDB'), { ok: false, reason: 'unknownCredential' })
  const offline = createSecretBindings(harness({}, null).deps)
  assert.deepEqual(await offline.bind('tmdb', 'TMDB'), { ok: false, reason: 'unreachable' })
  // A refusal leaves the saved key where it was.
  assert.deepEqual(h.writes, [])
  assert.equal(h.store.get('tmdb_api_key'), 'old-plain-key')
})

test('unlinking removes the row and writes no value back', async () => {
  const createSecretBindings = await load()
  const h = harness({ tmdb_api_key: secretRefFor('TMDB') }, SECRETS)
  assert.deepEqual(await createSecretBindings(h.deps).unbind('tmdb'), { ok: true })
  assert.deepEqual(h.removed, ['tmdb_api_key'])
  assert.deepEqual(h.writes, [])
})

test('unlinking never removes a key that is saved in the database', async () => {
  const createSecretBindings = await load()
  const h = harness({ omdb_api_key: 'plain-omdb-key' }, SECRETS)
  const bindings = createSecretBindings(h.deps)
  assert.deepEqual(await bindings.unbind('omdb'), { ok: false, reason: 'notLinked' })
  assert.deepEqual(await bindings.unbind('tmdb'), { ok: false, reason: 'notLinked' })
  assert.deepEqual(await bindings.unbind('nope'), { ok: false, reason: 'unknownCredential' })
  assert.deepEqual(h.removed, [])
})

test('linked is a fact about the row, whatever state the secret is in', async () => {
  const createSecretBindings = await load()
  const h = harness({ media_server_api_key: secretRefFor('GONE'), tmdb_api_key: 'plain' }, SECRETS)
  const bindings = createSecretBindings(h.deps)
  assert.equal(await bindings.isLinked('mediaServer'), true)
  assert.equal(await bindings.isLinked('tmdb'), false)
  assert.equal(await bindings.isLinked('omdb'), false)
})
