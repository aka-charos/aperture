/**
 * What an explicit user rating means, in one place.
 *
 * `user_ratings.rating` is `INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 10)`
 * (migration 0053, "10-heart system"), so the scale is guaranteed by the
 * database and does not need detecting. That mattered: taste-profile/builder.ts
 * carried `item.rating > 5 ? item.rating / 10 : item.rating / 5`, an attempt to
 * auto-detect a 1-5 scale that cannot work -- a 3 is either "good out of 5" or
 * "bad out of 10" and nothing in the value says which. The result was a
 * non-monotonic curve where a film rated 5/10 received the MAXIMUM taste weight,
 * tied with a 10/10 and ahead of a 9, while a 6 was weighted below a 4.
 *
 * The bands live here because three separate places encode them -- the two
 * taste builders and getDislikedMovieIds -- and they have to agree.
 */

/** At or below this, the viewer told us they did not like it. */
export const DISLIKED_RATING_MAX = 3

/** At or above this, the viewer told us they did. */
export const LIKED_RATING_MIN = 7

/** The scale's ceiling, fixed by the CHECK constraint on the column. */
export const USER_RATING_SCALE_MAX = 10

/**
 * Whether an explicit rating marks a title as disliked.
 *
 * A disliked title must contribute **nothing** to a taste vector, not merely
 * a little. Both builders used to give it a reduced but still POSITIVE weight
 * -- 0.2 in the legacy path, 0.65 in the primary one -- which pulls the
 * centroid toward the thing the viewer said they disliked, and then everything
 * near that centroid scores higher. A weighted mean can only express "more like
 * this"; there is no weight that means "less like this", so the only correct
 * contribution is zero.
 *
 * Pushing the centroid *away* is a different feature (a similarity penalty at
 * scoring time) and deliberately not attempted here: a negative weight in a
 * weighted mean produces a vector that need not lie anywhere near the data, and
 * cosine against it is not interpretable.
 */
export function isDislikedRating(rating: number | null | undefined): boolean {
  if (rating == null || !Number.isFinite(rating)) return false
  return rating <= DISLIKED_RATING_MAX
}
