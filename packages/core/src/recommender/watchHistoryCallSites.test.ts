import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Every query that READS watch_history must say what it means by "watched".
 *
 * WHY A SOURCE SCAN. Favoriting an unwatched title writes a watch_history row
 * (played = false, play_count = 0, last_played_at NULL) — that is how a
 * favorite reaches the taste vector, and it is correct. What it means is that
 * `EXISTS (SELECT 1 FROM watch_history ...)` is not a watched test, and a query
 * written that way is not wrong in a way anything can see: it compiles, it
 * returns rows, the rows are real, and the number it produces is merely larger
 * than the truth. Nothing is thrown and no type is violated.
 *
 * THE COUNT IS THE ARGUMENT. When this was written there were four sanctioned
 * predicates and about fifteen reads that used none of them — Home's "Movies
 * Watched" tile, Browse's watched/unwatched filter on both media types, the
 * community strip's watcher count and its named-watcher list, the assistant's
 * `ContentItem.watched` (which therefore disagreed with the poster badge beside
 * it), Explore's hide-watched, both channel builders, four Top Picks popularity
 * aggregates, the Watching page's episode count, and several assistant tools.
 * Every one was written by someone who knew favorites are not watches. A
 * convention did not survive that, so this is the guard instead.
 *
 * WHAT COUNTS AS SAYING IT. Naming one of the shared predicates, or writing a
 * `played`, `is_favorite` or `play_count` COMPARISON inline. `play_count` as a
 * projection is deliberately not enough — `SUM(wh.play_count)` beside an
 * unfiltered `COUNT(DISTINCT user_id)` is the exact shape this rejects, and
 * that pair was in both community-strip handlers.
 *
 * A query that genuinely has no opinion — housekeeping, deletion, an "any
 * history at all" population — belongs in ALLOWED_UNFILTERED with a reason, not
 * in a predicate it does not mean.
 */

const HERE = fileURLToPath(new URL('.', import.meta.url))
const REPO_ROOT = join(HERE, '..', '..', '..', '..')

const SCANNED_ROOTS = [
  join(REPO_ROOT, 'packages', 'core', 'src'),
  join(REPO_ROOT, 'apps', 'api', 'src'),
]

/** A SQL literal that reads the table rather than writing it. */
const READS_WATCH_HISTORY = /(?:FROM|JOIN)\s+watch_history\b/i

/**
 * The query names a watched policy.
 *
 * `\bplayed\s*=` matches `played = true` and `wh.played = false`; it cannot
 * match `last_played_at`, where the preceding underscore is a word character
 * and so leaves no boundary. `WATCHED_SQL` and `${WATCHED}` are the API's own
 * three-way predicate (watchStatsFilters.ts), which is a fifth reading with its
 * own reason to exist.
 */
const NAMES_A_PREDICATE =
  /WATCH_HISTORY_(?:PLAYED|TASTE|EXCLUDABLE)_SQL|\bWATCHED_SQL\b|\$\{WATCHED\}|\.played\b|\bplayed\s*=|\bis_favorite\s*=|\bplay_count\s*>/

/** `${statusClause}` — a predicate the query assembles rather than spells out. */
const INTERPOLATED = /\$\{([A-Za-z_$][\w$]*)\}/g

/**
 * SQL `--` comments, which are prose and must not answer for the query.
 *
 * Not hypothetical: Top Picks' movie_stats block carried the comment
 * `-- For movies, consider played = completed` directly above a WHERE clause
 * that filtered on nothing, and the first version of this scan passed it. A
 * remark about `played` is how someone explains the filter they then did not
 * write.
 */
function stripSqlComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, '')
}

/**
 * Whether a query names a policy, following the variables it interpolates.
 *
 * Several handlers build their predicate above the query (`statusClause`,
 * `watchedExpr`, `havingClause`) because it branches on a filter argument. That
 * is correct code, and a scan whose unit is the literal alone would report it
 * and push people to inline SQL just to satisfy the test. So an interpolated
 * identifier is resolved against its assignments in the same file, one level at
 * a time — `havingClause` references `watchedExpr`, which is where the `played`
 * actually is.
 */
function namesAPredicate(literal: string, source: string, depth = 0): boolean {
  if (NAMES_A_PREDICATE.test(stripSqlComments(literal))) return true
  if (depth >= 3) return false

  for (const [, name] of literal.matchAll(INTERPOLATED)) {
    // Every assignment to this identifier, plus the two lines under it: a long
    // predicate is routinely written on the line after the `=`.
    const assignment = new RegExp(`\\b${name}\\s*=[^=]`, 'g')
    const lines = source.split('\n')
    for (const [index, line] of lines.entries()) {
      assignment.lastIndex = 0
      if (!assignment.test(line)) continue
      if (namesAPredicate(lines.slice(index, index + 3).join('\n'), source, depth + 1)) return true
    }
  }

  return false
}

/**
 * Files whose watch_history reads legitimately have no watched policy. Keyed by
 * repo-relative path so the entry survives the lines moving; each one is a
 * claim that EVERY read in that file is population- or bookkeeping-shaped.
 */
const ALLOWED_UNFILTERED: Record<string, string> = {
  'packages/core/src/lib/purge.ts':
    'Deletes history. There is no watched question in a purge.',
  'packages/core/src/recommender/movies/sync.ts':
    'Owns the rows. Reads existing ids to diff against the media server.',
  'packages/core/src/recommender/series/watchHistorySync.ts': 'Series counterpart of the above.',
  'packages/core/src/recommender/activityGate.ts':
    'Asks whether anything CHANGED since the last run. A new favorite is real activity, ' +
    'and gating it on played would make the recommender ignore a signal it acts on.',
  'packages/core/src/recommender/watchedExclusion.ts':
    'Defines the predicates. Its own favorited-ids queries filter on is_favorite by design.',
  'packages/core/src/evaluation/run.ts':
    'Population query: every user with any history is a candidate for the split. ' +
    'Relevance is graded per row afterwards, from played/play_count/is_favorite together.',
  'apps/api/src/routes/users/handlers/profile/watchHistoryManagement.ts':
    'Admin editing of history rows — it operates ON the rows, so it must see all of them.',
  'apps/api/src/routes/users/handlers/profile/watchStatsBreakdown.ts':
    'The favorites and rewatched drill-ins deliberately skip the watched predicate, ' +
    'because the summary tiles they open from are counted without it (skipWatched).',
}

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      yield* walk(full)
    } else if (entry.endsWith('.ts')) {
      yield full
    }
  }
}

interface Literal {
  text: string
  line: number
}

/**
 * String and template literals, with comments skipped.
 *
 * A regex cannot do this: an apostrophe in a prose comment ("don't") opens a
 * span that swallows the next template literal whole, and the queries after it
 * silently stop being scanned. That failure is invisible — the test passes.
 */
export function stringLiterals(source: string): Literal[] {
  const found: Literal[] = []
  const n = source.length
  let i = 0
  let line = 1

  while (i < n) {
    const c = source[i]

    if (c === '\n') {
      line++
      i++
      continue
    }
    if (c === '/' && source[i + 1] === '/') {
      while (i < n && source[i] !== '\n') i++
      continue
    }
    if (c === '/' && source[i + 1] === '*') {
      i += 2
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) {
        if (source[i] === '\n') line++
        i++
      }
      i += 2
      continue
    }
    if (c === '`' || c === "'" || c === '"') {
      const quote = c
      const start = i
      const startLine = line
      let depth = 0
      i++
      while (i < n) {
        const d = source[i]
        if (d === '\\') {
          i += 2
          continue
        }
        if (d === '\n') {
          line++
          // Only a template literal may span lines; anything else is unterminated.
          if (quote !== '`') break
          i++
          continue
        }
        if (quote === '`' && d === '$' && source[i + 1] === '{') {
          depth++
          i += 2
          continue
        }
        if (quote === '`' && depth > 0 && d === '}') {
          depth--
          i++
          continue
        }
        if (d === quote && depth === 0) {
          i++
          break
        }
        i++
      }
      found.push({ text: source.slice(start, i), line: startLine })
      continue
    }
    i++
  }

  return found
}

function scan(): { offenders: string[]; reads: number; files: number } {
  const offenders: string[] = []
  let reads = 0
  let files = 0

  for (const root of SCANNED_ROOTS) {
    for (const file of walk(root)) {
      files++
      const rel = relative(REPO_ROOT, file).split(sep).join('/')
      if (rel.endsWith('.test.ts')) continue

      const source = readFileSync(file, 'utf8')
      for (const literal of stringLiterals(source)) {
        if (!READS_WATCH_HISTORY.test(literal.text)) continue
        reads++
        if (namesAPredicate(literal.text, source)) continue
        if (rel in ALLOWED_UNFILTERED) continue
        offenders.push(`${rel}:${literal.line}`)
      }
    }
  }

  return { offenders, reads, files }
}

test('every watch_history read names which "watched" it means', () => {
  const { offenders } = scan()

  assert.deepEqual(
    offenders,
    [],
    'These read watch_history without saying what counts as watched, so a favorited-but-' +
      'unplayed title is counted as seen. Use WATCH_HISTORY_PLAYED_SQL (did you play it), ' +
      'WATCH_HISTORY_TASTE_SQL (what shaped your taste), or WATCH_HISTORY_EXCLUDABLE_SQL ' +
      '(have you seen it) — or add the file to ALLOWED_UNFILTERED with a reason:\n  ' +
      offenders.join('\n  ')
  )
})

test('the scan reaches the whole tree and every allowlisted file still exists', () => {
  // A walk that silently found nothing would make the test above pass forever.
  const { reads, files } = scan()
  assert.ok(files > 500, `expected to scan the whole tree, saw ${files} files`)
  assert.ok(reads > 100, `expected to find the watch_history queries, saw ${reads}`)

  for (const path of Object.keys(ALLOWED_UNFILTERED)) {
    const full = join(REPO_ROOT, path)
    assert.doesNotThrow(
      () => statSync(full),
      `${path} is allowlisted but no longer exists — drop the entry`
    )
    const source = readFileSync(full, 'utf8')
    assert.ok(
      stringLiterals(source).some((l) => READS_WATCH_HISTORY.test(l.text)),
      `${path} is allowlisted but no longer reads watch_history — drop the entry`
    )
  }
})

test('the scan would catch a violation and does not flag a filtered query', () => {
  // Verified against an injected offender rather than assumed: the whole value
  // of this file is that it fails when someone writes the natural thing.
  const offending = ['const q = `', "  SELECT 1 FROM watch_history wh WHERE wh.user_id = $1", '`'].join(
    '\n'
  )
  const filtered = [
    'const q = `',
    '  SELECT 1 FROM watch_history wh WHERE wh.user_id = $1 AND wh.played = true',
    '`',
  ].join('\n')

  const check = (src: string) =>
    stringLiterals(src)
      .filter((l) => READS_WATCH_HISTORY.test(l.text))
      .filter((l) => !namesAPredicate(l.text, src)).length

  assert.equal(check(offending), 1, 'an unfiltered read must be flagged')
  assert.equal(check(filtered), 0, 'a played-filtered read must not be flagged')
})

test('a predicate assembled above the query still counts as naming one', () => {
  // Two levels: the query interpolates havingClause, which interpolates
  // watchedExpr, which is where `played` is. Flagging this would push a handler
  // that legitimately branches on a filter argument into inlining its SQL.
  const src = [
    "const watchedExpr = 'COUNT(*) FILTER (WHERE wh.played = true)'",
    'const havingClause = `HAVING ${watchedExpr} > 0`',
    'const q = `SELECT 1 FROM watch_history wh WHERE wh.user_id = $1 ${havingClause}`',
  ].join('\n')

  const flagged = stringLiterals(src)
    .filter((l) => READS_WATCH_HISTORY.test(l.text))
    .filter((l) => !namesAPredicate(l.text, src))
  assert.deepEqual(flagged, [])

  // But an interpolation that resolves to nothing relevant is still an offender:
  // following variables must not become a way to launder any query at all.
  const laundered = [
    "const orderBy = 'wh.last_played_at DESC'",
    'const q = `SELECT 1 FROM watch_history wh WHERE wh.user_id = $1 ORDER BY ${orderBy}`',
  ].join('\n')
  assert.equal(
    stringLiterals(laundered)
      .filter((l) => READS_WATCH_HISTORY.test(l.text))
      .filter((l) => !namesAPredicate(l.text, laundered)).length,
    1
  )
})

test('an apostrophe in a comment does not blind the scanner', () => {
  // The regex version of this scan silently stopped here: the apostrophe opened
  // a string span that ate the query below it, and the test went green.
  const source = [
    "// A favorite isn't a watch, so don't count it.",
    'const q = `SELECT 1 FROM watch_history wh WHERE wh.user_id = $1`',
  ].join('\n')

  const literals = stringLiterals(source).filter((l) => READS_WATCH_HISTORY.test(l.text))
  assert.equal(literals.length, 1, 'the query after a comment with apostrophes must still be seen')
})

test('an SQL comment about played does not answer for the query', () => {
  // The exact shape that slipped through: a remark explaining the filter,
  // above a WHERE clause that does not have one.
  const src = [
    'const q = `',
    '  SELECT wh.movie_id, COUNT(*)',
    '  -- For movies, consider played = completed',
    '  FROM watch_history wh WHERE wh.movie_id IS NOT NULL',
    '`',
  ].join('\n')

  const flagged = stringLiterals(src)
    .filter((l) => READS_WATCH_HISTORY.test(l.text))
    .filter((l) => !namesAPredicate(l.text, src))
  assert.equal(flagged.length, 1, 'a comment mentioning played is not a predicate')
})

test('a play_count projection is not an answer, but a comparison is', () => {
  // A favorited-unplayed row has play_count 0, so `SUM(play_count)` beside an
  // unfiltered count is exactly the shape this guard exists to reject —
  // selecting the column says nothing about which rows were selected.
  // `play_count > 1` is a different thing: it is the rewatch filter, and it
  // cannot be true of a row nobody played.
  assert.equal(NAMES_A_PREDICATE.test('SELECT SUM(wh.play_count) FROM watch_history wh'), false)
  assert.equal(NAMES_A_PREDICATE.test('SELECT MAX(wh.last_played_at) FROM watch_history wh'), false)
  assert.equal(NAMES_A_PREDICATE.test('WHERE wh.play_count > 1'), true)
  assert.equal(NAMES_A_PREDICATE.test('SELECT 1 FROM watch_history wh WHERE wh.played'), true)

  // `last_played_at` must not read as `played` — the underscore leaves no word
  // boundary, which is the only reason the pattern is safe unanchored.
  assert.equal(NAMES_A_PREDICATE.test('ORDER BY last_played_at DESC'), false)
})
