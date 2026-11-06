/**
 * Household reach: how a title's audience compares with every other title's, as
 * a named level. Pure, no runtime imports; `householdReachStore.ts` reads the
 * figures.
 *
 * It is a rank among titles, never a share of users, because the watcher count
 * is printed right beside it. A percentage gives the number of accounts away by
 * simple division, and so does a band of the share: find the two counts where
 * the band changes and the total is pinned to within a threshold. A rank has no
 * total in it, so comparing any number of title pages learns nothing about how
 * many accounts exist.
 *
 * A share would also be useless in practice. A large library is watched thinly:
 * most titles have one watcher, so nearly everything lands in the lowest share
 * band and the top band is out of reach.
 */

export const HOUSEHOLD_REACH_LEVELS = ['niche', 'familiar', 'popular', 'mostWatched'] as const
export type HouseholdReach = (typeof HOUSEHOLD_REACH_LEVELS)[number]

/** One bar of the histogram: this many titles have exactly this many watchers. */
export interface WatcherCount {
  watchers: number
  titles: number
}

/** Share of watched titles with a smaller audience, at which each level starts. */
const LEVEL_FLOORS = { familiar: 0.5, popular: 0.9, mostWatched: 0.98 } as const

/**
 * The level for a title with this many watchers, or undefined when there is
 * nothing to compare: nobody has watched it, there is no history at all, or every
 * title has the same audience, as on a server with one user.
 *
 * Ties share a level, since titles with equal audiences have equal reach. The
 * largest audience is `mostWatched` even where it is too common to clear the
 * floor, as in a small household that watches together. Levels compare titles and
 * say nothing about people: in that household a title three of four people saw can
 * still be `niche`, so the strings must not claim few people watched it. The
 * histogram may be slightly older than the count, so a count above its top is
 * simply the top.
 */
export function householdReach(
  watchers: number,
  histogram: readonly WatcherCount[]
): HouseholdReach | undefined {
  if (watchers <= 0) return undefined

  let titles = 0
  let fewer = 0
  let largest = 0
  for (const bar of histogram) {
    titles += bar.titles
    if (bar.watchers < watchers) fewer += bar.titles
    if (bar.watchers > largest) largest = bar.watchers
  }
  if (titles === 0) return undefined
  if (fewer === 0) return watchers >= largest ? undefined : 'niche'
  if (watchers >= largest) return 'mostWatched'

  const share = fewer / titles
  if (share >= LEVEL_FLOORS.mostWatched) return 'mostWatched'
  if (share >= LEVEL_FLOORS.popular) return 'popular'
  if (share >= LEVEL_FLOORS.familiar) return 'familiar'
  return 'niche'
}
