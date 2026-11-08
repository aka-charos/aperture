/**
 * Telling "the database is being restored" apart from "you are not signed in".
 *
 * While a restore's transaction is open the API answers every route 503 with this
 * code. That says nothing about the session, so a page loading then waits and asks
 * again rather than drawing the sign-in page, where signing in could only fail.
 */

export const DATABASE_RESTORE_RETRY_MS = 3000

/** Pure, so the rule can be tested without a browser. */
export function isDatabaseRestoringAnswer(status: number, body: unknown): boolean {
  if (status !== 503 || typeof body !== 'object' || body === null) return false
  return (body as { code?: unknown }).code === 'DATABASE_RESTORING'
}

/** Reads a copy, so the caller can still read the response. */
export async function answerIsDatabaseRestoring(response: Response): Promise<boolean> {
  if (response.status !== 503) return false
  const body: unknown = await response.clone().json().catch(() => null)
  return isDatabaseRestoringAnswer(response.status, body)
}
