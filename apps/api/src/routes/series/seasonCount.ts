/**
 * How many seasons of a show the library holds, counted from its episodes.
 *
 * `series.total_seasons` is the media server's `ChildCount`, and Emby does not
 * return it on the item listing the sync reads: measured live, every one of 986
 * shows stored NULL, so the Browse seasons sort fell through to title order and
 * the seasons filter could only empty the list. The episodes table is what the
 * library actually holds, which is also the population the watched pill counts
 * (`watching/watchedItems.ts`), so a show reading "3 seasons" here and "24/30"
 * on its poster agree.
 *
 * Season 0 is specials and is left out, as the poster pill leaves it out. A show
 * with no synced episodes reads NULL rather than 0, so it sorts last in both
 * directions instead of heading the "fewest" list.
 *
 * Correlated on the unaliased `series` table, which is how the list and range
 * queries read it. `idx_episodes_season (series_id, season_number)` answers it
 * from the index.
 */
export const LIBRARY_SEASON_COUNT_SQL = `(
  SELECT NULLIF(COUNT(DISTINCT e.season_number), 0)::int
  FROM episodes e
  WHERE e.series_id = series.id AND e.season_number > 0
)`
