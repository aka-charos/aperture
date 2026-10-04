/**
 * What of a candidate's `score_breakdown` may leave the server.
 *
 * The column is JSONB written by core's recommender/storage.ts, and for a pick
 * a taste-twin slot placed it holds `twinMatch.donorId`: the user id of the
 * person whose history supplied the title. Every route that read the column
 * sent it whole, so while the insights panel said "someone", the response it
 * rendered from carried the id — and `/api/users/:id/avatar` answers any
 * signed-in user, which turns an id into a face. The donor is named only
 * where the reader may see who they are (a visible connection, decided by
 * `resolveTwinDonor` and sent as its own key), never through this column.
 *
 * Pure and free of runtime imports, so `scoreBreakdown.test.ts` pins it
 * without loading the database pool. The same test scans the route files:
 * one that reads the column must pass it through `publicScoreBreakdown`, or
 * through the assistant's `pickSource`, which derives a label from it and
 * sends nothing of it.
 */

/** The donor's user id on a twin pick; null for every other pick and any unexpected shape. */
export function readTwinDonorId(scoreBreakdown: unknown): string | null {
  if (typeof scoreBreakdown !== 'object' || scoreBreakdown === null) return null
  const twinMatch = (scoreBreakdown as Record<string, unknown>).twinMatch
  if (typeof twinMatch !== 'object' || twinMatch === null) return null
  const donorId = (twinMatch as Record<string, unknown>).donorId
  return typeof donorId === 'string' && donorId.length > 0 ? donorId : null
}

/**
 * The breakdown with the donor's id removed, and nothing else changed. The
 * twin match itself stays — its presence is what the panel keys "this came
 * from a taste twin" on, and its shared title ids are resolved separately.
 * Returns a copy whenever it removes something; the stored row is never
 * mutated.
 */
export function publicScoreBreakdown<T>(scoreBreakdown: T): T {
  if (typeof scoreBreakdown !== 'object' || scoreBreakdown === null || Array.isArray(scoreBreakdown)) {
    return scoreBreakdown
  }
  const breakdown = scoreBreakdown as Record<string, unknown>
  const twinMatch = breakdown.twinMatch
  if (typeof twinMatch !== 'object' || twinMatch === null || !('donorId' in twinMatch)) {
    return scoreBreakdown
  }
  const { donorId: _donorId, ...rest } = twinMatch as Record<string, unknown>
  return { ...breakdown, twinMatch: rest } as T
}
