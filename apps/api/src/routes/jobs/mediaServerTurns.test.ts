import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { MEDIA_SERVER_JOBS, TurnQueue } from './mediaServerTurns.js'
import { jobDefinitions } from './definitions.js'

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms))

describe('TurnQueue', () => {
  it('lets one job in at a time, in the order they asked', async () => {
    const turns = new TurnQueue(10)
    const order: string[] = []
    const run = async (id: string, ms: number) => {
      const release = await turns.acquire(id, () => false)
      assert.ok(release)
      order.push(`${id} start`)
      await tick(ms)
      order.push(`${id} end`)
      release()
    }
    await Promise.all([run('a', 30), run('b', 5), run('c', 5)])
    assert.deepEqual(order, ['a start', 'a end', 'b start', 'b end', 'c start', 'c end'])
  })

  it('shows a waiting state only for a job that has to wait', async () => {
    const turns = new TurnQueue(10)
    const waited: string[] = []
    const first = await turns.acquire('a', () => false, () => waited.push('a'))
    const second = turns.acquire('b', () => false, () => waited.push('b'))
    assert.deepEqual(waited, ['b'])
    assert.equal(turns.isWaiting('b'), true)
    first?.()
    const release = await second
    assert.equal(turns.isWaiting('b'), false)
    release?.()
  })

  it('a job cancelled while waiting leaves the queue at once and never starts', async () => {
    const turns = new TurnQueue(10)
    const first = await turns.acquire('a', () => false)
    let cancel = false
    const second = turns.acquire('b', () => cancel)
    const third = turns.acquire('c', () => false)
    cancel = true
    assert.equal(await second, null)
    assert.deepEqual(turns.waitingJobIds(), ['c'])
    first?.()
    const release = await third
    assert.ok(release)
    release?.()
  })

  it('a release counts once, and only from the holder', async () => {
    const turns = new TurnQueue(10)
    const first = await turns.acquire('a', () => false)
    const second = turns.acquire('b', () => false)
    const third = turns.acquire('c', () => false)
    first?.()
    const b = await second
    first?.() // a second release from a job that no longer holds the turn
    assert.equal(turns.isWaiting('c'), true, 'c must still be waiting while b holds the turn')
    b?.()
    const c = await third
    assert.ok(c)
    c?.()
  })

  it('frees the turn when the holder releases with nobody waiting', async () => {
    const turns = new TurnQueue(10)
    ;(await turns.acquire('a', () => false))?.()
    const again = await turns.acquire('b', () => false)
    assert.ok(again)
    again?.()
  })
})

describe('MEDIA_SERVER_JOBS', () => {
  it('names only jobs that exist', () => {
    const names = new Set(jobDefinitions.map((d) => d.name))
    for (const name of MEDIA_SERVER_JOBS) assert.ok(names.has(name), name)
  })
})
