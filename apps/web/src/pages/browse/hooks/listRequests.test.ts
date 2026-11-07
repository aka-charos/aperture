import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequestGuard } from '../../../lib/requestGuard'
import { beginListRequest } from './listRequests'

/**
 * The bug this pins: a slow Browse reply to an older search landed after the
 * newer one and replaced it, and an old "load more" appended to a new list.
 * Each reply below resolves in the order a slow server can produce.
 */

/** A list as a hook keeps it, applying a reply only while its ticket is current. */
function simulatedList() {
  const guard = createRequestGuard()
  let rows: string[] = []
  return {
    guard,
    rows: () => rows,
    request(append: boolean) {
      const ticket = beginListRequest(guard, append)
      return {
        ticket,
        reply(page: string[]) {
          if (!ticket.isCurrent()) return
          rows = append ? [...rows, ...page] : page
        },
      }
    },
  }
}

test('an older search answering after the newer one changes nothing', () => {
  const list = simulatedList()
  const star = list.request(false)
  list.guard.invalidate() // the query changes: useRequestGuard(listQuery)
  const starWars = list.request(false)

  starWars.reply(['A New Hope', 'The Empire Strikes Back'])
  star.reply(['A Star Is Born', 'Stardust', 'A New Hope'])

  assert.deepEqual(list.rows(), ['A New Hope', 'The Empire Strikes Back'])
  assert.equal(star.ticket.signal.aborted, true)
})

test('asking for page one cancels a "load more" still in flight for the old list', () => {
  const list = simulatedList()
  list.request(false).reply(['Heat', 'Thief'])
  const more = list.request(true)
  const fresh = list.request(false) // e.g. the same query asked again

  fresh.reply(['Collateral'])
  more.reply(['Manhunter'])

  assert.deepEqual(list.rows(), ['Collateral'])
  assert.equal(more.ticket.signal.aborted, true)
})

test('"load more" keeps page one current, and appends while its list stands', () => {
  const list = simulatedList()
  const first = list.request(false)
  first.reply(['Heat'])
  const more = list.request(true)

  assert.equal(first.ticket.isCurrent(), true)
  more.reply(['Thief'])
  assert.deepEqual(list.rows(), ['Heat', 'Thief'])
})

test('every Browse list hook goes through the guard', () => {
  for (const name of ['useBrowseMovies', 'useBrowseSeries', 'useBrowsePeople']) {
    const source = readFileSync(new URL(`./${name}.ts`, import.meta.url), 'utf8')
    assert.match(source, /useRequestGuard\(/, `${name}: no request guard`)
    assert.match(source, /beginListRequest\(requests, append\)/, `${name}: page requests skip beginListRequest`)
    assert.match(source, /signal: ticket\.signal/, `${name}: the fetch is not cancellable`)
    // After the fetch, after the body, in the catch and in the finally.
    const checks = source.match(/ticket\.isCurrent\(\)/g)?.length ?? 0
    assert.ok(checks >= 4, `${name}: ${checks} currency checks, expected at least 4`)
  }
})
