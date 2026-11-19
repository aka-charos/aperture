import test from 'node:test'
import assert from 'node:assert/strict'
import { lastActivityAt, listIssues, readIssueListView, readLocale, reportedBy, uniqueById } from './issueListing.js'

type Row = Parameters<typeof listIssues>[0][number] & { state: 'open' | 'resolved' }

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

test('unknown query values read as the defaults, and latest activity is the default order', () => {
  const defaults = { state: 'all', kind: 'all', sort: 'latestActivity', locale: null }
  assert.deepEqual(readIssueListView({}), defaults)
  assert.deepEqual(readIssueListView({ filter: 'closed', kind: 'smell', sort: 'random', lang: '!!' }), defaults)
  assert.deepEqual(readIssueListView({ filter: 'resolved', kind: 'subtitles', sort: 'titleAsc', lang: 'el' }), {
    state: 'resolved',
    kind: 'subtitles',
    sort: 'titleAsc',
    locale: 'el',
  })
})

test('a language tag Intl refuses reads as none, never as a throw', () => {
  assert.equal(readLocale(undefined), null)
  assert.equal(readLocale('en-x-'), null)
  assert.equal(readLocale('el'), 'el')
})

test('the problem type narrows the list; the state is left to Seerr', () => {
  const rows = [
    issue(1, { kind: 'video', state: 'open' }),
    issue(2, { kind: 'subtitles', state: 'open' }),
    issue(3, { kind: 'subtitles', state: 'resolved' }),
  ]
  assert.deepEqual(ids(listIssues(rows, view({ kind: 'subtitles', sort: 'newest' }))), [3, 2])
  // Not filtered again here, whatever the view's state says.
  assert.deepEqual(ids(listIssues(rows, view({ kind: 'subtitles', state: 'open', sort: 'newest' }))), [3, 2])
  assert.deepEqual(ids(listIssues(rows, view({ kind: 'audio' }))), [])
})

test('an issue read twice across shifting pages is kept once, the first copy', () => {
  const first = issue(2, { libraryTitle: 'first' })
  assert.deepEqual(uniqueById([issue(3), first, issue(2, { libraryTitle: 'again' }), issue(1)]), [
    issue(3),
    first,
    issue(1),
  ])
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

test("title order follows the viewer's language", () => {
  // Swedish puts Å after Z; the default collation puts it beside A.
  const rows = [issue(1, { libraryTitle: 'Zorro' }), issue(2, { libraryTitle: 'Ådalen' })]
  assert.deepEqual(ids(listIssues(rows, view({ sort: 'titleAsc', locale: 'sv' }))), [1, 2])
  assert.deepEqual(ids(listIssues(rows, view({ sort: 'titleAsc', locale: 'en' }))), [2, 1])
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

test('"mine" keeps the viewer\'s own reports even when Seerr answered with everyone\'s', () => {
  const rows = [
    { id: 1, reportedBySeerrUserId: 7 },
    { id: 2, reportedBySeerrUserId: 9 },
    { id: 3, reportedBySeerrUserId: null },
    { id: 4, reportedBySeerrUserId: 7 },
  ]
  // A Seerr admin acting as themselves still gets every issue back.
  const mine = reportedBy(rows, 7, 40)
  assert.deepEqual(
    mine.issues.map((r) => r.id),
    [1, 4]
  )
  assert.equal(mine.total, 2)
  // Seerr had already narrowed the list: its own count stands.
  const narrowed = reportedBy([rows[0]!, rows[3]!], 7, 12)
  assert.equal(narrowed.total, 12)
})

test('the list it was given is left as it was', () => {
  const rows = [issue(1), issue(2)]
  listIssues(rows, view({ sort: 'newest' }))
  assert.deepEqual(ids(rows), [1, 2])
})
