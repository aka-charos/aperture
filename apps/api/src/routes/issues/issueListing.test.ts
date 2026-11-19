import test from 'node:test'
import assert from 'node:assert/strict'
import { lastActivityAt, listIssues, readIssueListView } from './issueListing.js'

type Row = Parameters<typeof listIssues>[0][number]

const issue = (id: number, extra: Partial<Row> = {}): Row => ({
  id,
  kind: 'video',
  state: 'open',
  createdAt: `2026-01-${String(id).padStart(2, '0')}T10:00:00Z`,
  updatedAt: `2026-01-${String(id).padStart(2, '0')}T10:00:00Z`,
  comments: [],
  libraryTitle: `Title ${id}`,
  ...extra,
})

const ids = (rows: Row[]) => rows.map((r) => r.id)
const view = (v: Partial<ReturnType<typeof readIssueListView>>) => ({ ...readIssueListView({}), ...v })

test('unknown query values read as the defaults', () => {
  assert.deepEqual(readIssueListView({}), { state: 'all', kind: 'all', sort: 'newest' })
  assert.deepEqual(readIssueListView({ filter: 'closed', kind: 'smell', sort: 'random' }), {
    state: 'all',
    kind: 'all',
    sort: 'newest',
  })
  assert.deepEqual(readIssueListView({ filter: 'resolved', kind: 'subtitles', sort: 'titleAsc' }), {
    state: 'resolved',
    kind: 'subtitles',
    sort: 'titleAsc',
  })
})

test('state and problem type both narrow the list', () => {
  const rows = [
    issue(1, { kind: 'video', state: 'open' }),
    issue(2, { kind: 'subtitles', state: 'open' }),
    issue(3, { kind: 'subtitles', state: 'resolved' }),
  ]
  assert.deepEqual(ids(listIssues(rows, view({ kind: 'subtitles' }))), [3, 2])
  assert.deepEqual(ids(listIssues(rows, view({ kind: 'subtitles', state: 'open' }))), [2])
  assert.deepEqual(ids(listIssues(rows, view({ kind: 'audio' }))), [])
})

test('newest and oldest go by the report date', () => {
  const rows = [issue(2), issue(5), issue(1)]
  assert.deepEqual(ids(listIssues(rows, view({ sort: 'newest' }))), [5, 2, 1])
  assert.deepEqual(ids(listIssues(rows, view({ sort: 'oldest' }))), [1, 2, 5])
})

test('latest activity counts a reply, which does not move the issue itself', () => {
  const rows = [issue(5), issue(1, { comments: [{ createdAt: '2026-02-01T00:00:00Z' }] }), issue(3)]
  assert.deepEqual(ids(listIssues(rows, view({ sort: 'latestActivity' }))), [1, 5, 3])
  assert.equal(lastActivityAt(rows[1]!), Date.parse('2026-02-01T00:00:00Z'))
})

test('title order ignores case and accents, and an unknown title sorts last either way', () => {
  const rows = [
    issue(1, { libraryTitle: 'breaking Bad' }),
    issue(2, { libraryTitle: null }),
    issue(3, { libraryTitle: 'Ossessione' }),
    issue(4, { libraryTitle: 'Älska' }),
  ]
  assert.deepEqual(ids(listIssues(rows, view({ sort: 'titleAsc' }))), [4, 1, 3, 2])
  assert.deepEqual(ids(listIssues(rows, view({ sort: 'titleDesc' }))), [3, 1, 4, 2])
})

test('the list it was given is left as it was', () => {
  const rows = [issue(1), issue(2)]
  listIssues(rows, view({ sort: 'newest' }))
  assert.deepEqual(ids(rows), [1, 2])
})
