import test from 'node:test'
import assert from 'node:assert/strict'
import { sharedCredentialUpdate, isGroundingRole } from './providerCredentials.js'

const ROLES = ['embeddings', 'chat', 'textGeneration', 'exploration', 'webSearch', 'titleAnalysis']

/**
 * The reported failure, as a test. Title Analysis on LM Studio at a non-default
 * address, switched to another provider and back: the role's own config is
 * replaced whole, so the shared store is the only place the address can come
 * from. Withheld there, the card falls back to the shipped localhost default
 * and the operator has to remember and retype their own server.
 */
test('every role publishes its base URL, so a provider switch is reversible', () => {
  const baseUrl = 'http://host.docker.internal:9099/v1'
  for (const fn of ROLES) {
    assert.equal(
      sharedCredentialUpdate(fn, { baseUrl })?.baseUrl,
      baseUrl,
      `${fn} must publish its base URL, or switching provider and back loses the server`
    )
  }
})

/**
 * The half that must NOT change. Two roles can spend Google's grounded-search
 * allowance and hold separate keys precisely so they spend from separate
 * projects; publishing one lets the other borrow it.
 */
test('a grounding role never publishes its API key', () => {
  for (const fn of ROLES) {
    const shared = sharedCredentialUpdate(fn, { apiKey: 'AIza-secret' })
    if (isGroundingRole(fn)) {
      assert.equal(shared, null, `${fn} must contribute nothing when it has only a key`)
    } else {
      assert.equal(shared?.apiKey, 'AIza-secret', `${fn} shares its key as it always did`)
    }
  }
})

/**
 * The combination that made the bug hard to see: a grounding role with BOTH.
 * The key is withheld and the address is published, from one save.
 */
test('a grounding role with both publishes the address and withholds the key', () => {
  const shared = sharedCredentialUpdate('titleAnalysis', {
    apiKey: 'AIza-secret',
    baseUrl: 'http://host.docker.internal:9099/v1',
  })
  assert.deepEqual(shared, { baseUrl: 'http://host.docker.internal:9099/v1' })
})

test('a save with nothing to contribute writes nothing', () => {
  assert.equal(sharedCredentialUpdate('titleAnalysis', {}), null)
  assert.equal(sharedCredentialUpdate('embeddings', {}), null)
})

/**
 * The settings form sends an empty string for a field nobody filled in. Writing
 * it would blank a good stored value — which is the same class of loss this
 * whole change is about, arriving from the other direction.
 */
test('an empty field is absent, not a blank to store over a good value', () => {
  assert.equal(sharedCredentialUpdate('embeddings', { apiKey: '', baseUrl: '' }), null)
  assert.equal(sharedCredentialUpdate('embeddings', { apiKey: '   ' }), null)
  // A real address alongside a blank key still publishes the address.
  assert.deepEqual(sharedCredentialUpdate('embeddings', { apiKey: '', baseUrl: 'http://x/v1' }), {
    baseUrl: 'http://x/v1',
  })
})

test('the grounding roles are the two that can spend a search allowance', () => {
  assert.ok(isGroundingRole('webSearch'))
  assert.ok(isGroundingRole('titleAnalysis'))
  assert.ok(!isGroundingRole('embeddings'))
  assert.ok(!isGroundingRole('chat'))
  assert.ok(!isGroundingRole('textGeneration'))
  assert.ok(!isGroundingRole('exploration'))
})
