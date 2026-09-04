import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { pickRequestOverrides, resolveRequestSource } from './requestOptions.js'

const full = {
  rootFolder: '/mnt/media/tv',
  profileId: 4,
  serverId: 1,
  languageProfileId: 2,
  is4k: true,
}

test('an admin keeps every override', () => {
  assert.deepEqual(pickRequestOverrides(full, true), full)
})

test('a viewer keeps none of the path or profile overrides', () => {
  const picked = pickRequestOverrides(full, false)

  assert.equal(picked.rootFolder, undefined)
  assert.equal(picked.profileId, undefined)
  assert.equal(picked.serverId, undefined)
  assert.equal(picked.languageProfileId, undefined)
})

test('a viewer keeps is4k, which Seerr refuses on its own if they may not have it', () => {
  assert.equal(pickRequestOverrides(full, false).is4k, true)
})

test('absent stays absent rather than becoming a default', () => {
  // Seerr treats an omitted field as "use the server default"; sending an
  // explicit undefined-turned-null would override that with nothing.
  assert.deepEqual(pickRequestOverrides({}, true), {})
  assert.deepEqual(pickRequestOverrides({}, false), {})
})

test('is4k false is preserved, not dropped as falsy', () => {
  assert.equal(pickRequestOverrides({ is4k: false }, false).is4k, false)
})

test('a request can only claim direct or discovery', () => {
  assert.equal(resolveRequestSource('direct'), 'direct')
  assert.equal(resolveRequestSource('discovery'), 'discovery')
})

test('a client cannot claim gap_analysis, which the job alone writes', () => {
  assert.equal(resolveRequestSource('gap_analysis'), 'discovery')
})

test('anything unrecognised or absent reads as discovery', () => {
  assert.equal(resolveRequestSource(undefined), 'discovery')
  assert.equal(resolveRequestSource(''), 'discovery')
  assert.equal(resolveRequestSource('nonsense'), 'discovery')
})
