/**
 * The two predicates every watch-stats query shares.
 *
 * They live here because the drill-in has to agree with the number on the
 * chip it was opened from: a "7 films" badge that opens a list of five is a
 * bug report, and the only way that cannot happen is for the count and the
 * list to be filtering on the same text. `wh` is the `watch_history` alias
 * and `lc` the `library_config` alias in every caller.
 */

/**
 * Genuinely-watched history — played, replayed, or resumed in progress.
 * Excludes bookmark-only favorites (favorited but never played), matching
 * the watch history page.
 */
export const WATCHED_SQL =
  '(wh.played = true OR wh.play_count > 0 OR COALESCE(wh.playback_position_ticks, 0) > 0)'

/**
 * Titles from a library the viewer can see. An instance with no
 * `library_config` rows at all has never configured libraries, so
 * everything counts.
 */
export const LIBRARY_ENABLED_SQL =
  '(NOT EXISTS (SELECT 1 FROM library_config) OR lc.is_enabled = true)'
