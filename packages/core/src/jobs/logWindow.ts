/**
 * Trim a job's log to a budget while keeping the half that explains the run.
 *
 * WHY NOT JUST KEEP THE LAST N. That is what this did, and for a long job it
 * throws away the most useful lines. A title-analysis pass over 200 titles
 * writes two entries per title, so a 100-entry tail is the last fifty titles
 * and nothing else: the opening line saying how many titles were pending and
 * which retrieval mode was in use is gone, the first successes are gone, and
 * what survives is the most repetitive stretch of the run. Measured on the run
 * that prompted this, the visible history began at "[152/200]" — every line
 * that would have explained what the job set out to do had been dropped, and
 * the 197 identical failures were kept.
 *
 * A run is legible from its two ends. The beginning says what was attempted and
 * how the early items went; the end says how it finished. The middle of a long
 * job is by nature the repetitive part, and it is the part a reader scrolls
 * past. So this keeps a head, keeps as much tail as the budget allows, and
 * replaces what it dropped with one entry saying how many entries that was —
 * because a gap the reader cannot see is worse than a smaller log.
 */

export interface JobLogEntry {
  timestamp: Date
  // Mirrors the levels LogEntry carries, debug included: this helper trims a
  // list, it does not get an opinion about what may be in it.
  level: 'info' | 'warn' | 'error' | 'debug'
  message: string
  data?: unknown
}

/**
 * Entries kept from the start of the run.
 *
 * Enough for the job's own summary line plus the first several units of work,
 * which together answer "what was this trying to do, and did it ever work?".
 */
export const LOG_HEAD_ENTRIES = 30

export function condenseLogs<T extends JobLogEntry>(logs: T[], limit: number): T[] {
  if (limit <= 0) return []
  if (logs.length <= limit) return logs

  // One slot goes to the marker, so the arithmetic below has to account for it
  // or the result would be limit + 1 entries.
  const head = Math.min(LOG_HEAD_ENTRIES, Math.max(0, limit - 2))
  const tail = limit - head - 1
  const elided = logs.length - head - tail

  const marker = {
    timestamp: logs[head]?.timestamp ?? new Date(),
    level: 'info' as const,
    message: `… ${elided.toLocaleString()} earlier entries not kept …`,
  } as T

  return [...logs.slice(0, head), marker, ...logs.slice(logs.length - tail)]
}
