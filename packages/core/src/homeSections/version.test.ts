import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MIN_EMBY_VERSION,
  compareVersions,
  isEmbyVersionSupported,
  parseServerVersion,
} from './version.js'

test('the floor itself passes and the build before it fails', () => {
  assert.equal(isEmbyVersionSupported(MIN_EMBY_VERSION), true)
  assert.equal(isEmbyVersionSupported('4.10.0.39'), false)
})

test('comparison is numeric, not lexical', () => {
  // As strings, "4.9.1.80" sorts after "4.10.0.40"; as a version it is older.
  assert.equal(isEmbyVersionSupported('4.9.1.80'), false)
  assert.equal(isEmbyVersionSupported('4.10.1.0'), true)
  assert.equal(isEmbyVersionSupported('5.0'), true)
})

test('garbage and missing versions fail the gate rather than comparing as zero', () => {
  for (const bad of [null, undefined, '', 'beta', '4', '4.10.x.40', '4.10.0.40.1', ' . ']) {
    assert.equal(isEmbyVersionSupported(bad), false, `expected ${String(bad)} to fail`)
  }
})

test('short versions pad to four parts', () => {
  assert.deepEqual(parseServerVersion('4.10'), [4, 10, 0, 0])
  assert.equal(compareVersions([4, 10, 0, 0], [4, 10, 0, 40]) < 0, true)
})
