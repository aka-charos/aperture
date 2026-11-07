import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { MEDIA_SERVER_JOBS, TurnQueue, runInTurn, type TurnDeps } from './mediaServerTurns.js'
import { jobDefinitions } from './definitions.js'

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms))

/** A promise plus whether it has settled yet. */
function watch<T>(promise: Promise<T>) {
  const state = { done: false, promise }
  promise.then(() => (state.done = true))
  return state
}

describe('TurnQueue', () => {
  it('lets one job in at a time, in the order they asked', async () => {
    const turns = new TurnQueue({ pollMs: 10 })
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
    const turns = new TurnQueue({ pollMs: 10 })
    const waited: string[] = []
    const first = await turns.acquire('a', () => false, () => waited.push('a'))
    const second = watch(turns.acquire('b', () => false, () => waited.push('b')))
    assert.deepEqual(waited, ['b'])
    await tick(30)
    assert.equal(second.done, false, 'b waits while a holds the turn')
    first?.()
    const release = await second.promise
    assert.ok(release)
    release?.()
  })

  it('a job cancelled while waiting leaves the queue at once and never starts', async () => {
    const turns = new TurnQueue({ pollMs: 10 })
    const first = await turns.acquire('a', () => false)
    let cancel = false
    const second = turns.acquire('b', () => cancel)
    const third = turns.acquire('c', () => false)
    cancel = true
    // Leaves while a still holds the turn, without waiting for it.
    assert.equal(await second, null)
    first?.()
    const release = await third
    assert.ok(release)
    release?.()
  })

  it('a job cancelled between two polls never gets the turn', async () => {
    // A poll interval far longer than the test: only the hand-over can notice.
    const turns = new TurnQueue({ pollMs: 60_000 })
    const first = await turns.acquire('a', () => false)
    let cancel = false
    const second = turns.acquire('b', () => cancel)
    const third = turns.acquire('c', () => false)
    cancel = true
    first?.()
    assert.equal(await second, null)
    const release = await third
    assert.ok(release, 'the turn passes to the next job still waiting')
    release?.()
  })

  it('a release counts once, and only from the holder', async () => {
    const turns = new TurnQueue({ pollMs: 10 })
    const first = await turns.acquire('a', () => false)
    const second = turns.acquire('b', () => false)
    const third = watch(turns.acquire('c', () => false))
    first?.()
    const b = await second
    first?.() // a second release from a job that no longer holds the turn
    await tick(30)
    assert.equal(third.done, false, 'c must still be waiting while b holds the turn')
    b?.()
    const c = await third.promise
    assert.ok(c)
    c?.()
  })

  it('a cancelled holder gives way: it is only winding down', async () => {
    const overrides: string[] = []
    const turns = new TurnQueue({ pollMs: 10, onOverride: (id, why) => overrides.push(`${id} ${why}`) })
    let cancelA = false
    const first = await turns.acquire('a', () => cancelA)
    const second = turns.acquire('b', () => false)
    cancelA = true
    const b = await second
    assert.ok(b)
    assert.deepEqual(overrides, ['a cancelled'])
    first?.() // a's late release must not free b's turn
    const third = watch(turns.acquire('c', () => false))
    await tick(30)
    assert.equal(third.done, false, 'b still holds the turn')
    b?.()
    ;(await third.promise)?.()
  })

  it('a holder past the lease gives way, so one stuck job cannot stop the rest', async () => {
    let clock = 0
    const overrides: string[] = []
    const turns = new TurnQueue({
      pollMs: 10,
      leaseMs: 1_000,
      now: () => clock,
      onOverride: (id, why) => overrides.push(`${id} ${why}`),
    })
    await turns.acquire('stuck', () => false) // never released
    const next = watch(turns.acquire('b', () => false))
    await tick(30)
    assert.equal(next.done, false, 'within the lease, b waits')
    clock = 1_000
    const b = await next.promise
    assert.ok(b)
    assert.deepEqual(overrides, ['stuck lease'])
    b?.()
  })

  it('frees the turn when the holder releases with nobody waiting', async () => {
    const turns = new TurnQueue({ pollMs: 10 })
    ;(await turns.acquire('a', () => false))?.()
    const again = await turns.acquire('b', () => false)
    assert.ok(again)
    again?.()
  })
})

/** A stand-in job system: one record per job id, cancellation by flag. */
function fakeJobs(turns: TurnQueue) {
  const records = new Map<string, { status: string }>()
  const cancelled = new Set<string>()
  const calls: string[] = []
  const deps: TurnDeps<{ status: string }> = {
    turns,
    isCancelled: (id) => cancelled.has(id),
    createQueued: (id) => {
      const record = { status: 'running' }
      records.set(id, record)
      calls.push(`queued ${id}`)
      return record
    },
    startQueued: (id) => calls.push(`started ${id}`),
    current: (id) => records.get(id),
    complete: (id) => {
      calls.push(`completed ${id}`)
      records.set(id, { status: 'completed' })
    },
    releaseSlot: (_name, id) => calls.push(`slot freed ${id}`),
    log: () => {},
  }
  return { deps, records, cancelled, calls }
}

describe('runInTurn', () => {
  it('a job that goes straight in gets no queued record', async () => {
    const jobs = fakeJobs(new TurnQueue({ pollMs: 10 }))
    let ran = false
    await runInTurn('sync-movies', 'a', async () => void (ran = true), jobs.deps)
    assert.equal(ran, true)
    assert.deepEqual(jobs.calls, [])
  })

  it('a waiting job is queued, then started when its turn comes', async () => {
    const turns = new TurnQueue({ pollMs: 10 })
    const jobs = fakeJobs(turns)
    const hold = await turns.acquire('holder', () => false)
    const runs: string[] = []
    const waiting = runInTurn(
      'sync-series',
      'b',
      async () => {
        runs.push('b')
        jobs.records.set('b', { status: 'running' }) // the job's own record
      },
      jobs.deps
    )
    await tick()
    assert.deepEqual(jobs.calls, ['queued b'])
    hold?.()
    await waiting
    assert.deepEqual(runs, ['b'])
    assert.deepEqual(jobs.calls, ['queued b', 'started b'], 'its own record is not completed for it')
  })

  it('a job cancelled while it waits never runs and frees its name', async () => {
    const turns = new TurnQueue({ pollMs: 60_000 })
    const jobs = fakeJobs(turns)
    const hold = await turns.acquire('holder', () => false)
    let ran = false
    const waiting = runInTurn('sync-series', 'b', async () => void (ran = true), jobs.deps)
    await tick()
    jobs.cancelled.add('b')
    hold?.()
    await waiting
    assert.equal(ran, false)
    assert.ok(jobs.calls.includes('slot freed b'))
    // The turn is free again.
    const next = await turns.acquire('c', () => false)
    assert.ok(next)
    next?.()
  })

  it('a cancel landing after the hand-over still stops it, and frees the turn', async () => {
    const turns = new TurnQueue({ pollMs: 60_000 })
    const jobs = fakeJobs(turns)
    const hold = await turns.acquire('holder', () => false)
    let ran = false
    // Not cancelled at the hand-over, cancelled by the time runInTurn looks.
    let asks = 0
    jobs.deps.isCancelled = () => ++asks > 1
    const waiting = runInTurn('sync-series', 'b', async () => void (ran = true), jobs.deps)
    await tick()
    hold?.()
    await waiting
    assert.equal(ran, false)
    const next = await turns.acquire('c', () => false)
    assert.ok(next, 'the turn was released')
    next?.()
  })

  it('closes the queued record of a job that keeps none of its own', async () => {
    const turns = new TurnQueue({ pollMs: 10 })
    const jobs = fakeJobs(turns)
    const hold = await turns.acquire('holder', () => false)
    const waiting = runInTurn('sync-users', 'b', async () => {}, jobs.deps)
    await tick()
    hold?.()
    await waiting
    assert.deepEqual(jobs.calls, ['queued b', 'started b', 'completed b'])
  })

  it('a job that throws still releases the turn', async () => {
    const turns = new TurnQueue({ pollMs: 10 })
    const jobs = fakeJobs(turns)
    await assert.rejects(
      runInTurn('sync-movies', 'a', async () => {
        throw new Error('boom')
      }, jobs.deps)
    )
    const next = await turns.acquire('b', () => false)
    assert.ok(next)
    next?.()
  })
})

describe('MEDIA_SERVER_JOBS', () => {
  it('names only jobs that exist', () => {
    const names = new Set(jobDefinitions.map((d) => d.name))
    for (const name of MEDIA_SERVER_JOBS) assert.ok(names.has(name), name)
  })
})
