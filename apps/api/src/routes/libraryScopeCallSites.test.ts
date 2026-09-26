/**
 * Every route file that reads titles either applies the viewer's library scope
 * or says, here, why it does not.
 *
 * The rule (F-136) is that a viewer is shown only what the media server lets
 * them open, among the libraries enabled here, within their parental rating. It
 * was applied nowhere, then in some places — the operator's own library switch
 * reached Browse and recommendations and not search, similar titles, the
 * assistant or a detail page. A convention held by memory drifts exactly that
 * way, so this scan fails on a file that queries `movies`, `series` or
 * `episodes` and names none of the scope helpers, unless it is listed below with
 * a reason.
 *
 * It checks that a file THINKS about scope, not that every query in it is
 * scoped: a file can call a helper once and miss a second query. What it buys is
 * that nobody adds a new title-listing route without the question coming up.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROUTES = fileURLToPath(new URL('.', import.meta.url))

/** SQL that reads a title table. */
const READS_TITLES = /\b(?:FROM|JOIN)\s+(?:movies|series|episodes)\b/

/** Any one of these means the file applies the viewer's scope somewhere. */
const SCOPE_HELPERS = /\b(?:viewerScope|titleInScope|idsInScope|scopeClause|libraryScopeSql|getLibraryScopeForUser)\(/

/**
 * Files that read titles and deliberately apply no scope, and why. A stale
 * entry fails too: a renamed file would come back unscoped while this list
 * still read as reviewed.
 */
const EXEMPT: Record<string, string> = {
  // The viewer's own record — every title in it was one they could open when
  // they watched, rated or followed it.
  'users/handlers/profile/watchHistory.ts': 'own watch history',
  'users/handlers/profile/watchHistoryManagement.ts': 'own watch history, edited by id',
  'users/handlers/profile/watchStats.ts': 'own watch statistics',
  'users/handlers/profile/watchStatsBreakdown.ts': 'own watch statistics, drilled into',
  'users/handlers/profile/userPreferences.ts': 'own preferences and history',
  'ratings/index.ts': 'own ratings',
  'watching/index.ts': 'shows the viewer follows',
  'recommendations/handlers/history.ts': 'own past recommendation runs',
  'assistant/tools/history.ts': 'own watch history and ratings (also exempt in withLibraryScope)',
  'assistant/prompts/context/user.ts': 'own history, summarised for the system prompt',
  'assistant/discovery/tasteBrief.ts': 'own history, for the taste brief',
  'assistant/jobs/refreshSuggestions.ts': 'own history and own picks, for suggestion chips',
  'assistant/helpers/unwatched.ts': 'answers "watched?" for ids it is handed; lists nothing',
  // Assistant tools returning cards: every card is filtered by withLibraryScope,
  // which wraps every tool. None of these returns titles as `brief` text — the
  // tools that do (search, episodes) put the scope in their SQL.
  'assistant/tools/content.ts': 'card and single-title results, filtered by withLibraryScope',
  'assistant/tools/discovery.ts': 'card results, filtered by withLibraryScope',
  'assistant/tools/recommendations.ts': 'card results, filtered by withLibraryScope',
  'assistant/tools/library.ts':
    'rankings are cards (filtered by withLibraryScope); stats, genres and studios are aggregates naming no title',
  'assistant/tools/people.ts': 'returns people, not titles; any title cards are filtered by withLibraryScope',
  // Hydration of items a scoped builder already chose.
  'channels/handlers/playlist.ts': "hydrates items the channel builder chose within the owner's scope",
  // Admin-only surfaces.
  'gap-analysis/index.ts': 'admin only',
  'mdblist/index.ts': 'admin only',
  'settings/handlers/aiConfig.ts': 'admin only',
  'settings/handlers/legacyAiModels.ts': 'admin only',
  'settings/handlers/ratings.ts': 'admin only',
  'settings/handlers/recommendations.ts': 'admin only',
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return name.endsWith('.ts') && !name.endsWith('.test.ts') ? [path] : []
  })
}

const files = sourceFiles(ROUTES).map((path) => ({
  path: relative(ROUTES, path).split(sep).join('/'),
  text: readFileSync(path, 'utf8'),
}))
const readers = files.filter((file) => READS_TITLES.test(file.text))

test('every route file reading titles applies the viewer scope or says why not', () => {
  const unscoped = readers
    .filter((file) => !SCOPE_HELPERS.test(file.text) && !(file.path in EXEMPT))
    .map((file) => file.path)
  assert.deepEqual(unscoped, [], 'apply lib/viewerScope.ts, or add the file to EXEMPT with a reason')
})

test('no exemption is stale', () => {
  const byPath = new Map(files.map((file) => [file.path, file]))
  for (const path of Object.keys(EXEMPT)) {
    const file = byPath.get(path)
    assert.ok(file, `${path} no longer exists`)
    assert.ok(READS_TITLES.test(file.text), `${path} no longer reads titles`)
    assert.ok(!SCOPE_HELPERS.test(file.text), `${path} applies the scope now; drop its exemption`)
  }
})

test('the scan still finds the routes it exists for', () => {
  // A regex that stopped matching would pass every file vacuously.
  const scoped = readers.filter((file) => SCOPE_HELPERS.test(file.text)).map((file) => file.path)
  for (const path of ['movies/handlers/list.ts', 'search/index.ts', 'assistant/tools/search.ts']) {
    assert.ok(scoped.includes(path), `${path} should read titles AND apply the scope`)
  }
  assert.ok(readers.length > 30, `only ${readers.length} title-reading files found`)
})
