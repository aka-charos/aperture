/**
 * What to do with one answer from the job progress route, and how a restore being
 * watched is remembered. Pure, so the rules can be tested without a browser.
 *
 * A restore makes most answers temporary: while its transaction is open the API
 * answers 503, and the admin's session may be gone for good once it commits. The
 * job is still running in the server's memory, so none of that means it ended.
 * A refusal is different: the route answers 503 rather than 401 while it cannot
 * judge a session, so a 401 means this credential will not work, and asking again
 * would never end.
 */

export type PollDecision =
  /** A real answer: read it. */
  | 'read'
  /** Says nothing about the job: ask again. */
  | 'wait'
  /** Refused, with nothing to try instead. */
  | 'authLost'
  /** The server no longer holds this job. */
  | 'gone'

export function decidePoll(answer: { status: number; isJson: boolean }): PollDecision {
  if (answer.status === 401 || answer.status === 403) return 'authLost'
  if (answer.status === 404) return 'gone'
  // A 503 from the restore gate, or a proxy's HTML page during a restart.
  if (answer.status < 200 || answer.status >= 300 || !answer.isJson) return 'wait'
  return 'read'
}

/**
 * A poll with no answer to read: no connection, a request that outlived
 * `POLL_TIMEOUT_MS`, a proxy's page. The token route answers from memory right through
 * a restore, so a long silence means this page cannot reach the server, and saying
 * nothing would look like a frozen panel. It says so and keeps asking, because the
 * job may still end and the next answer tells how.
 */
export const CONTACT_LOST_AFTER_MS = 60_000

/** Aborted past this, so a poll the network swallowed cannot wait forever. */
export const POLL_TIMEOUT_MS = 15_000

export function hasLostContact(lastAnswerAt: number, now: number): boolean {
  return now - lastAnswerAt >= CONTACT_LOST_AFTER_MS
}

/**
 * Why tracking ended. A job this tab rejoined and never read finished while the page
 * was away: the server forgets a finished job after a few minutes. How it ended is
 * not known here, so this is reported as neither a success nor a failure. A job it was
 * watching and then lost is a different message, since it may not have ended at all.
 */
export function lostReason(
  decision: 'authLost' | 'gone',
  rejoinedAndNotYetRead: boolean
): 'authLost' | 'gone' | 'finishedUnseen' {
  return decision === 'gone' && rejoinedAndNotYetRead ? 'finishedUnseen' : decision
}

/** Enough to pick a restore back up after the page was left or reloaded. */
export interface SavedRestore {
  jobId: string
  token: string
}

export function parseSavedRestore(raw: string | null): SavedRestore | null {
  if (!raw) return null
  try {
    const saved = JSON.parse(raw) as Partial<SavedRestore> | null
    if (typeof saved?.jobId !== 'string' || typeof saved.token !== 'string') return null
    return { jobId: saved.jobId, token: saved.token }
  } catch {
    return null
  }
}
