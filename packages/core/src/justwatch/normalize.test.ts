import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { justWatchPosterAddress, parsePopularEdges, parseProvidersResponse } from './normalize.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const sample = JSON.parse(readFileSync(join(__dirname, '__fixtures__/popular-sample.json'), 'utf8'))

test('parsePopularEdges maps tmdb, chart, poster', () => {
  const rows = parsePopularEdges(sample)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].tmdbId, 27205)
  assert.equal(rows[0].title, 'Inception')
  assert.equal(rows[0].chartRank, 3)
  assert.equal(rows[0].chartTrend, 'UP')
  assert.equal(rows[0].daysInTop10, 5)
  assert.ok(rows[0].posterPath?.startsWith('http'))
})

test("JustWatch's poster becomes a whole address, so the card never asks TMDb for it", () => {
  assert.equal(
    justWatchPosterAddress('/poster/305/s718/title.jpg'),
    'https://images.justwatch.com/poster/305/s718/title.jpg'
  )
  assert.equal(justWatchPosterAddress('https://example.invalid/p.jpg'), 'https://example.invalid/p.jpg')
  assert.equal(justWatchPosterAddress(null), null)
  assert.equal(justWatchPosterAddress(''), null)
})

test('parseProvidersResponse maps packages', () => {
  const data = {
    data: {
      packages: [
        { packageId: 8, technicalName: 'nfx', shortName: 'Netflix', clearName: 'Netflix' },
      ],
    },
  }
  const opts = parseProvidersResponse(data)
  assert.equal(opts.length, 1)
  assert.equal(opts[0].technicalName, 'nfx')
})
