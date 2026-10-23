/**
 * Which user guide pages describe the screen someone is looking at — what the
 * Help button in the app bar opens.
 *
 * Pure data plus one lookup, pinned by `guide.test.ts`, which fails on a page
 * named here that does not exist in `docs/features/`. The first page of a
 * list opens first; the rest become tabs, because some screens are described
 * by more than one page (a title page is also where you rate and read the
 * analysis). A screen with no entry opens the guide's contents instead.
 *
 * The same table names the screen's guided tour (`tour`, an id in
 * `components/tour/tours.ts`) and its first-visit hint (`hint`, the text at
 * `onboarding.hints.<id>`), so "what describes this screen" is answered in
 * one place. `tours.test.ts` fails on a tour or hint named here that does not
 * exist.
 */

import { userSettingsTabFromParam } from '../UserSettings/tabHelpers'

interface RouteDocs {
  /** `/browse` matches exactly; `/movies/` matches anything under it. */
  path: string
  docs: readonly string[]
  /** For Settings: the `?tab=` value this entry answers, when it depends on it. */
  tab?: string
  /** The tour that walks through this screen, if it has one. */
  tour?: string
  /** The one-line tip shown the first time someone opens this screen. */
  hint?: string
}

export const ROUTE_DOCS: readonly RouteDocs[] = [
  { path: '/', docs: ['dashboard', 'getting-started'], tour: 'home', hint: 'home' },
  { path: '/browse', docs: ['browse', 'grid-list-views'], tour: 'browse', hint: 'browse' },
  { path: '/movies', docs: ['browse', 'grid-list-views'] },
  { path: '/series', docs: ['browse', 'grid-list-views'] },
  { path: '/movies/', docs: ['movie-detail', 'ratings', 'title-analysis', 'similarity-graphs', 'next-from-here'], tour: 'title', hint: 'title' },
  { path: '/series/', docs: ['series-detail', 'ratings', 'title-analysis', 'similarity-graphs', 'next-from-here'], tour: 'title', hint: 'title' },
  { path: '/recommendations', docs: ['recommendations'], tour: 'recommendations', hint: 'recommendations' },
  { path: '/top-picks', docs: ['top-picks'] },
  { path: '/top-picks/', docs: ['top-picks'] },
  { path: '/watching', docs: ['shows-you-watch'], hint: 'watching' },
  { path: '/playlists', docs: ['playlists'] },
  { path: '/collections', docs: ['collections'] },
  // No hint: Explore fills the viewport, and a line above it would push the graph off the bottom.
  { path: '/explore', docs: ['explore'], tour: 'explore' },
  { path: '/next', docs: ['next-from-here'] },
  { path: '/discovery', docs: ['discovery'], hint: 'discovery' },
  { path: '/my-requests', docs: ['my-requests'] },
  { path: '/history', docs: ['watch-history'] },
  { path: '/stats', docs: ['watch-stats'], hint: 'stats' },
  { path: '/search', docs: ['global-search'] },
  { path: '/franchises', docs: ['franchises'] },
  { path: '/franchises/', docs: ['franchises'] },
  { path: '/person/', docs: ['person-pages'] },
  { path: '/studio/', docs: ['studio-pages'] },
  { path: '/watch-this', docs: ['watch-this'] },
  { path: '/assistant', docs: ['ai-assistant'] },
  { path: '/settings', tab: 'recommendations', docs: ['user-settings/recommendations'], tour: 'settings-recommendations', hint: 'settings-recommendations' },
  { path: '/settings', tab: 'display', docs: ['user-settings/display', 'similarity-graphs', 'getting-started'] },
  { path: '/settings', tab: 'account', docs: ['user-settings/account', 'trakt-integration'] },
  { path: '/settings', tab: 'home', docs: ['user-settings/home-screen'] },
  // A tab this list does not name (none today; a safety net for a new one).
  { path: '/settings', docs: ['user-settings/recommendations'] },
]

/** The entry describing a location, or null when none does. */
function entryForLocation(pathname: string, search = ''): RouteDocs | null {
  const path = pathname.replace(/\/+$/, '') || '/'
  const requested = new URLSearchParams(search).get('tab')
  // Settings resolves the tab the way the page does, so a retired name
  // (`?tab=preferences`) or none at all gets the pages for the tab on screen.
  const tab = path === '/settings' ? userSettingsTabFromParam(requested) : (requested ?? undefined)

  for (const entry of ROUTE_DOCS) {
    const matches = entry.path.endsWith('/') && entry.path !== '/'
      ? path.startsWith(entry.path)
      : path === entry.path
    if (!matches) continue
    if (entry.tab !== undefined && entry.tab !== tab) continue
    return entry
  }
  return null
}

/** The pages describing a location, or an empty list when none does. */
export function docsForLocation(pathname: string, search = ''): readonly string[] {
  return entryForLocation(pathname, search)?.docs ?? []
}

/** The tour for the screen at a location, or null when it has none. */
export function tourForLocation(pathname: string, search = ''): string | null {
  return entryForLocation(pathname, search)?.tour ?? null
}

/** The first-visit hint for the screen at a location, or null when it has none. */
export function hintForLocation(pathname: string, search = ''): string | null {
  return entryForLocation(pathname, search)?.hint ?? null
}

/**
 * The screen a page describes, for the "go to this screen" button on it: the
 * first exact address that lists the page. A page that only describes screens
 * reached from something else (a title page, a person page) has none.
 */
export function screenForDoc(slug: string): string | null {
  const entry = ROUTE_DOCS.find((e) => !(e.path.endsWith('/') && e.path !== '/') && e.docs.includes(slug))
  if (!entry) return null
  return entry.tab ? `${entry.path}?tab=${entry.tab}` : entry.path
}

/**
 * An app address written as inline code in a user page (`/recommendations`),
 * when it is a screen the reader can open; otherwise null and it stays code.
 * Only exact screens: a pattern such as `/movies/:id` names no one page.
 */
export function appPathIn(code: string): string | null {
  const candidate = code.trim().replace(/\/+$/, '') || '/'
  if (!candidate.startsWith('/')) return null
  return ROUTE_DOCS.some((e) => e.path === candidate && !e.path.endsWith('/') && e.tab === undefined)
    ? candidate
    : null
}
