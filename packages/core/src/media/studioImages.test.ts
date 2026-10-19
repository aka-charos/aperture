import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pickStudioImage } from './studioImages.js'

test('a Thumb is preferred, a Primary taken when there is no Thumb', () => {
  assert.deepEqual(pickStudioImage({ Primary: 'p1', Thumb: 't1' }), { type: 'Thumb', tag: 't1' })
  assert.deepEqual(pickStudioImage({ Primary: 'p1' }), { type: 'Primary', tag: 'p1' })
})

test('other image types and empty tags are not a studio logo', () => {
  assert.equal(pickStudioImage({ Backdrop: 'b1', Logo: 'l1' }), null)
  assert.equal(pickStudioImage({ Thumb: '' }), null)
  assert.equal(pickStudioImage({}), null)
  assert.equal(pickStudioImage(undefined), null)
  assert.equal(pickStudioImage(null), null)
})
