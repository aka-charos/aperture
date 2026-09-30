import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { rowStatus } from './rowStatus.js'

const some = { count: 12, sample: [] }

describe('rowStatus', () => {
  it('names who switched it off before anything about its contents', () => {
    assert.deepEqual(rowStatus({ status: 'unavailable', reason: 'admin-off' }, some, true), {
      kind: 'unavailable',
      reason: 'admin-off',
    })
    assert.deepEqual(rowStatus({ status: 'off' }, some, true), { kind: 'off' })
  })

  it('never calls a row empty when its contents could not be read', () => {
    assert.deepEqual(rowStatus({ status: 'on' }, { count: null, sample: [] }, true), { kind: 'unknown', onScreen: true })
    assert.deepEqual(rowStatus({ status: 'on' }, null, false), { kind: 'unknown', onScreen: false })
  })

  it('tells a row on the screen from one still to be created', () => {
    assert.deepEqual(rowStatus({ status: 'on' }, some, true), { kind: 'showing', count: 12 })
    assert.deepEqual(rowStatus({ status: 'on' }, some, false), { kind: 'arriving', count: 12 })
    assert.deepEqual(rowStatus({ status: 'on' }, { count: 0, sample: [] }, true), { kind: 'empty' })
  })
})
