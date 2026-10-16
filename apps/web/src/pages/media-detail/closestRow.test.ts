import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildClosestRow, twinMarking } from './closestRow'

const film = (id: string) => ({ id, title: id, year: 2000, poster_url: null })

test('evidence and shared titles merge into one row, closest first', () => {
  const row = buildClosestRow({
    evidence: [
      { id: 'e1', similarity: 0.81, evidence_type: 'watched', item: film('anomalisa') },
      { id: 'e2', similarity: 0.75, evidence_type: 'favorite', item: film('crimes') },
    ],
    twinShared: [
      { ...film('eternal'), similarity: 0.77 },
      { ...film('exotica'), similarity: 0.62 },
    ],
  })

  assert.deepEqual(
    row.map((r) => r.id),
    ['anomalisa', 'eternal', 'crimes', 'exotica']
  )
  assert.deepEqual(
    row.map((r) => r.sharedWithTwin),
    [false, true, false, true]
  )
  // A shared-only title carries no evidence badge it never earned.
  assert.equal(row[1].evidenceType, null)
  assert.equal(row[2].evidenceType, 'favorite')
})

test('a title in both lists appears once, keeping its badge and gaining the mark', () => {
  const row = buildClosestRow({
    evidence: [{ id: 'e1', similarity: 0.81, evidence_type: 'favorite', item: film('anomalisa') }],
    twinShared: [{ ...film('anomalisa'), similarity: 0.81 }],
  })

  assert.equal(row.length, 1)
  assert.equal(row[0].evidenceType, 'favorite')
  assert.equal(row[0].sharedWithTwin, true)
  assert.equal(row[0].key, 'e1')
})

test('an unmeasured shared title sorts last instead of claiming closeness', () => {
  const row = buildClosestRow({
    evidence: [{ id: 'e1', similarity: 0.4, evidence_type: 'watched', item: film('a') }],
    twinShared: [
      { ...film('b'), similarity: null },
      { ...film('c'), similarity: 0.5 },
    ],
  })

  assert.deepEqual(
    row.map((r) => r.id),
    ['c', 'a', 'b']
  )
})

test('with no twin, the row is the evidence unchanged', () => {
  const row = buildClosestRow({
    evidence: [
      { id: 'e1', similarity: 0.7, evidence_type: 'watched', item: film('a') },
      { id: 'e2', similarity: 0.6, evidence_type: 'watched', item: film('b') },
    ],
    twinShared: [],
  })

  assert.deepEqual(
    row.map((r) => [r.id, r.sharedWithTwin]),
    [
      ['a', false],
      ['b', false],
    ]
  )
})

test('marking: badges only when some titles are shared, one caption when all are', () => {
  const evidence = [{ id: 'e1', similarity: 0.81, evidence_type: 'watched', item: film('anomalisa') }]

  assert.equal(twinMarking(buildClosestRow({ evidence, twinShared: [] })), 'none')
  assert.equal(
    twinMarking(buildClosestRow({ evidence, twinShared: [{ ...film('eternal'), similarity: 0.77 }] })),
    'some'
  )
  // The live Synecdoche row: every title nearest the pick was one both watched.
  assert.equal(
    twinMarking(
      buildClosestRow({
        evidence,
        twinShared: [
          { ...film('anomalisa'), similarity: 0.81 },
          { ...film('eternal'), similarity: 0.77 },
        ],
      })
    ),
    'all'
  )
  assert.equal(twinMarking([]), 'none')
})
