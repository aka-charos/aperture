import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  BINDABLE_SECRETS,
  SECRETS_RETRY_MS,
  SECRETS_TTL_MS,
  bwsChildEnvironment,
  describeSecretsFailure,
  isBindableSettingKey,
  isSecretName,
  linkableNames,
  lookupSecret,
  parseSecretList,
  parseSecretRef,
  readSecretsBootstrap,
  secretRefFor,
  shouldFetchSecrets,
} from './rules.js'

const PROJECT = '7b006643-89c1-4202-a5ca-90510f566030'

test('a reference round-trips, and a plain value is never read as one', () => {
  assert.equal(parseSecretRef(secretRefFor('TMDB_API_KEY')), 'TMDB_API_KEY')
  assert.equal(parseSecretRef('  bws:Seerr key  '), 'Seerr key')
  assert.equal(parseSecretRef('sk-live-abc'), null)
  assert.equal(parseSecretRef('BWS:NAME'), null, 'the prefix is exact, so no real key is mistaken for a link')
  assert.equal(parseSecretRef('bws:'), null)
  assert.equal(parseSecretRef(''), null)
  assert.equal(parseSecretRef(null), null)
})

test('a secret name must survive being stored and found again', () => {
  assert.equal(isSecretName('OMDB_API_KEY'), true)
  assert.equal(isSecretName('Κλειδί TMDb'), true)
  assert.equal(isSecretName(' padded'), false)
  assert.equal(isSecretName('two\nlines'), false)
  assert.equal(isSecretName(''), false)
  assert.equal(isSecretName('x'.repeat(501)), false)
  assert.equal(isSecretName(42), false)
})

test('only the listed single-value credentials resolve a reference', () => {
  for (const { settingKey } of BINDABLE_SECRETS) assert.equal(isBindableSettingKey(settingKey), true)
  // A JSON setting holding a credential is read by its own code, which does not
  // resolve references: it must not look linkable.
  assert.equal(isBindableSettingKey('smtp_integration'), false)
  assert.equal(isBindableSettingKey('ai_config'), false)
  assert.equal(isBindableSettingKey('app_name'), false)
  assert.equal(new Set(BINDABLE_SECRETS.map((s) => s.id)).size, BINDABLE_SECRETS.length)
  assert.equal(new Set(BINDABLE_SECRETS.map((s) => s.settingKey)).size, BINDABLE_SECRETS.length)
})

test('nothing set is off, and a half-set environment says what is missing', () => {
  assert.deepEqual(readSecretsBootstrap({}), { configured: false, problem: 'off' })
  assert.deepEqual(readSecretsBootstrap({ BWS_PROJECT_ID: PROJECT }), { configured: false, problem: 'missingToken' })
  assert.deepEqual(readSecretsBootstrap({ BWS_ACCESS_TOKEN: '0.abc' }), { configured: false, problem: 'missingProject' })
  assert.deepEqual(readSecretsBootstrap({ BWS_ACCESS_TOKEN: '0.abc', BWS_PROJECT_ID: 'my-project' }), {
    configured: false,
    problem: 'invalidProject',
  })
  assert.deepEqual(
    readSecretsBootstrap({ BWS_ACCESS_TOKEN: '0.abc', BWS_PROJECT_ID: PROJECT, BWS_SERVER_URL: 'vault.example' }),
    { configured: false, problem: 'invalidServerUrl' }
  )
})

test('a complete environment is read, with the cloud and PATH as defaults', () => {
  assert.deepEqual(readSecretsBootstrap({ BWS_ACCESS_TOKEN: ' 0.abc ', BWS_PROJECT_ID: PROJECT }), {
    configured: true,
    bootstrap: { accessToken: '0.abc', projectId: PROJECT, serverUrl: null, bwsPath: 'bws' },
  })
  const custom = readSecretsBootstrap({
    BWS_ACCESS_TOKEN: '0.abc',
    BWS_PROJECT_ID: PROJECT,
    BWS_SERVER_URL: 'https://vault.bitwarden.eu',
    BWS_PATH: '/opt/bws',
  })
  assert.equal(custom.configured && custom.bootstrap.serverUrl, 'https://vault.bitwarden.eu')
  assert.equal(custom.configured && custom.bootstrap.bwsPath, '/opt/bws')
})

test('the CLI listing becomes names and values, and a shared name is set aside', () => {
  const snapshot = parseSecretList(
    JSON.stringify([
      { id: '1', key: 'TMDB', value: 'a' },
      { id: '2', key: 'DUP', value: 'b' },
      { id: '3', key: 'DUP', value: 'c' },
      { id: '4', key: 'DUP', value: 'd' },
      { id: '5', key: 'BLANK', value: '  ' },
    ])
  )
  assert.deepEqual(lookupSecret(snapshot, 'TMDB'), { status: 'ok', value: 'a' })
  assert.deepEqual(lookupSecret(snapshot, 'DUP'), { status: 'ambiguous' })
  assert.deepEqual(lookupSecret(snapshot, 'BLANK'), { status: 'empty' })
  assert.deepEqual(lookupSecret(snapshot, 'tmdb'), { status: 'missing' }, 'names are case-sensitive, as in Bitwarden')
  assert.deepEqual(lookupSecret(null, 'TMDB'), { status: 'unreachable' })
})

test('an unreadable listing throws rather than reading as an empty project', () => {
  assert.throws(() => parseSecretList(''))
  assert.throws(() => parseSecretList('Error: something'))
  assert.throws(() => parseSecretList('{"key":"A","value":"b"}'))
  assert.throws(() => parseSecretList('[{"key":"A"}]'))
  assert.throws(() => parseSecretList('[null]'))
  assert.equal(parseSecretList('[]').values.size, 0, 'an empty project is a real answer')
})

test('the project is read when never read, when its time is up, and not during the retry wait', () => {
  const t = 1_000_000
  assert.equal(shouldFetchSecrets({ fetchedAt: null, failedAt: null }, t), true)
  assert.equal(shouldFetchSecrets({ fetchedAt: t, failedAt: null }, t + SECRETS_TTL_MS - 1), false)
  assert.equal(shouldFetchSecrets({ fetchedAt: t, failedAt: null }, t + SECRETS_TTL_MS), true)
  // A failure waits, whether or not an earlier read succeeded...
  assert.equal(shouldFetchSecrets({ fetchedAt: null, failedAt: t }, t + SECRETS_RETRY_MS - 1), false)
  assert.equal(shouldFetchSecrets({ fetchedAt: t, failedAt: t + 5 }, t + 6), false)
  // ...and then asks again without waiting out the long window.
  assert.equal(shouldFetchSecrets({ fetchedAt: t, failedAt: t + 5 }, t + 5 + SECRETS_RETRY_MS), true)
})

test('a failure is named, clipped, and never carries the access token', () => {
  const token = '0.4f6c2b1e.secretpart:key=='
  assert.deepEqual(describeSecretsFailure({ code: 'ENOENT', message: 'spawn bws ENOENT' }, token), {
    kind: 'notInstalled',
    detail: null,
  })
  assert.equal(describeSecretsFailure({ killed: true, message: 'timed out' }, token).kind, 'timeout')
  assert.equal(
    describeSecretsFailure({ code: 1, stderr: 'Error: Received error message from server: [401 Unauthorized]' }, token)
      .kind,
    'unauthorized'
  )
  const leaked = describeSecretsFailure({ code: 1, stderr: `bad token ${token} given\n  twice ${token}` }, token)
  assert.equal(leaked.detail?.includes(token), false)
  assert.equal(leaked.detail, 'bad token [access token] given twice [access token]')
  const long = describeSecretsFailure({ code: 1, stderr: 'x'.repeat(5000) }, token)
  assert.equal(long.kind, 'failed')
  assert.equal(long.detail?.length, 300)
})

test('a message that merely mentions the token is not a refusal', () => {
  const token = '0.4f6c2b1e.secretpart:key=='
  // Echoing the token puts "[access token]" in the shown text; that placeholder
  // must not turn an unreachable server into "Bitwarden refused the token".
  assert.equal(
    describeSecretsFailure({ code: 1, stderr: `error sending request with ${token}: connection refused` }, token).kind,
    'failed'
  )
  assert.equal(
    describeSecretsFailure({ code: 1, stderr: 'Specify access token for the service account' }, token).kind,
    'failed'
  )
  assert.equal(describeSecretsFailure({ code: 1, stderr: 'invalid_client' }, token).kind, 'unauthorized')
})

test('the picker offers exactly the names a link accepts', () => {
  const snapshot = parseSecretList(
    JSON.stringify([
      { key: 'b', value: 'v' },
      { key: 'A', value: 'v' },
      { key: 'TRAILING ', value: 'v' },
      { key: 'BLANK', value: '   ' },
      { key: 'DUP', value: 'v' },
      { key: 'DUP', value: 'w' },
    ])
  )
  const names = linkableNames(snapshot)
  assert.deepEqual(names, ['A', 'b'])
  for (const name of names) {
    assert.equal(isSecretName(name), true)
    assert.equal(lookupSecret(snapshot, name).status, 'ok')
  }
  assert.deepEqual(linkableNames(null), [])
})

test('the CLI gets the token, the server and the way out, and nothing else of ours', () => {
  const bootstrap = {
    accessToken: '0.token',
    projectId: PROJECT,
    serverUrl: 'https://vault.bitwarden.eu',
    bwsPath: 'bws',
  }
  const env = bwsChildEnvironment(bootstrap, {
    PATH: '/usr/bin',
    HOME: '/home/aperture',
    https_proxy: 'http://proxy:3128',
    HTTP_PROXY: 'http://proxy:3128',
    no_proxy: 'localhost',
    DATABASE_URL: 'postgres://app:pw@db/aperture',
    SESSION_SECRET: 'x',
    BWS_ACCESS_TOKEN: 'stale-token-from-the-environment',
    EMPTY: '',
  })
  assert.deepEqual(env, {
    PATH: '/usr/bin',
    HOME: '/home/aperture',
    HTTP_PROXY: 'http://proxy:3128',
    https_proxy: 'http://proxy:3128',
    no_proxy: 'localhost',
    BWS_ACCESS_TOKEN: '0.token',
    BWS_SERVER_URL: 'https://vault.bitwarden.eu',
  })
  assert.equal('BWS_SERVER_URL' in bwsChildEnvironment({ ...bootstrap, serverUrl: null }, {}), false)
})
