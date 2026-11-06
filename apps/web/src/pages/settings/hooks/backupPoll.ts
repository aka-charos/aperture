/**
 * What to do with one answer from the job progress route. Pure, so the rules can
 * be tested without a browser.
 *
 * A restore makes most answers temporary: while its transaction is open the API
 * answers 503, and the admin's session may be gone for good once it commits. The
 * job is still running in the server's memory, so none of that means it ended.
 * Only the job's own terminal status, read from a real answer, ends tracking.
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

export function decidePoll(answer: { status: number; hasToken: boolean; isJson: boolean }): PollDecision {
  if (answer.status === 401 || answer.status === 403) return answer.hasToken ? 'wait' : 'authLost'
  if (answer.status === 404) return 'gone'
  // A 503 from the restore gate, or a proxy's HTML page during a restart.
  if (answer.status < 200 || answer.status >= 300 || !answer.isJson) return 'wait'
  return 'read'
}
