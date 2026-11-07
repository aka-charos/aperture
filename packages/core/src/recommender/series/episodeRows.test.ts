import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Episode } from '../../media/types.js'
import {
  EPISODE_FIELDS,
  episodeKey,
  episodeRowParams,
  episodeRowsSource,
  planEpisodeBatch,
  widestPerNumber,
} from './episodeRows.js'
import type { PreparedEpisode } from './syncTypes.js'

function prepared(id: string, episodeNumber: number, end?: number, extra: Partial<Episode> = {}): PreparedEpisode {
  return {
    episode: {
      id,
      name: `Episode ${episodeNumber}`,
      seriesId: 'provider-series',
      seriesName: 'Mad Men',
      seasonNumber: 5,
      episodeNumber,
      episodeNumberEnd: end,
      ...extra,
    } as Episode,
    seriesDbId: 'series-uuid',
    posterUrl: null,
    runtimeMinutes: 48,
  }
}

test('every column gets the parameter of its own position', () => {
  const sql = episodeRowsSource('t')
  const columns = EPISODE_FIELDS.map(([column]) => column)
  const numbered = [...sql.matchAll(/\$(\d+)::(\w+)\[\]/g)].map((m) => [Number(m[1]), m[2]])
  assert.deepEqual(numbered, EPISODE_FIELDS.map(([, type], i) => [i + 1, type]))
  assert.ok(sql.endsWith(`AS t(${columns.join(', ')})`))

  const params = episodeRowParams([prepared('e1', 1, 2, { path: '/tv/s05e01-e02.mkv' })])
  const at = (column: string) => params[columns.indexOf(column)]
  assert.equal(params.length, columns.length)
  assert.deepEqual(at('provider_item_id'), ['e1'])
  assert.deepEqual(at('episode_number'), [1])
  assert.deepEqual(at('episode_number_end'), [2])
  assert.deepEqual(at('path'), ['/tv/s05e01-e02.mkv'])
  assert.deepEqual(at('runtime_minutes'), [48])
  assert.deepEqual(episodeRowParams([prepared('e2', 3)])[columns.indexOf('episode_number_end')], [null])
})

test('a known id updates, a new id at a held number waits, anything else inserts', () => {
  const held = prepared('old', 1)
  const plan = planEpisodeBatch(
    [prepared('known', 2), prepared('new-id', 1), prepared('fresh', 3)],
    new Set(['known', 'old']),
    new Set([episodeKey(held), episodeKey(prepared('known', 2))])
  )
  assert.deepEqual(plan.update.map((pe) => pe.episode.id), ['known'])
  assert.deepEqual(plan.rekeyed.map((pe) => pe.episode.id), ['new-id'])
  assert.deepEqual(plan.insert.map((pe) => pe.episode.id), ['fresh'])
  assert.equal(plan.duplicates, 0)
})

test('versions of one episode in a batch all carry the widest range', () => {
  const plan = planEpisodeBatch(
    [prepared('single', 1), prepared('double', 1, 2), prepared('plain', 4)],
    new Set(),
    new Set()
  )
  assert.equal(plan.duplicates, 1)
  assert.deepEqual(
    plan.insert.map((pe) => [pe.episode.id, pe.episode.episodeNumberEnd]),
    [['double', 2], ['plain', undefined]]
  )

  // The version that matches the stored id is written with the other's range too
  const known = planEpisodeBatch([prepared('stored', 1), prepared('double', 1, 2)], new Set(['stored']), new Set())
  assert.equal(known.update[0].episode.episodeNumberEnd, 2)
  assert.equal(known.insert[0].episode.episodeNumberEnd, 2)
})

test('the settle step takes the widest version of each number', () => {
  const chosen = widestPerNumber([prepared('a', 1), prepared('b', 1, 3), prepared('c', 1, 2), prepared('d', 4)])
  assert.deepEqual(chosen.map((pe) => pe.episode.id), ['b', 'd'])
})
