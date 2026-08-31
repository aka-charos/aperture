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
 *
 * THE COUNT HAS TO BE CUMULATIVE, and for a long time it was not. This is
 * called on every append once a job is over budget, and each call recomputed
 * the total from the list in front of it — a list already condensed, whose
 * marker it then dropped and replaced. In steady state that is one new entry
 * per call, so a job that had actually discarded thousands of lines reported
 * "2 earlier entries not kept" and looked complete. A 40-minute evaluation run
 * was read as having lost 201 entries when it had lost several times that,
 * and the missing half was the comparison the run existed to produce. So a
 * marker carries its own count in `data`, and a later condense adds to it
 * rather than starting over. Detection is on that field and not on the
 * message text, which is prose and could be translated or reworded.
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

/** Tag on the synthetic entry, so a later pass can recognise its own work. */
const ELISION_MARKER = 'aperture:log-elision'

interface ElisionData {
  marker: typeof ELISION_MARKER
  elided: number
}

/** How many real entries an entry stands for: 0 unless it is a marker. */
function elidedBy(entry: JobLogEntry | undefined): number {
  const data = entry?.data as Partial<ElisionData> | undefined
  if (!data || data.marker !== ELISION_MARKER) return 0
  return typeof data.elided === 'number' && Number.isFinite(data.elided) ? data.elided : 0
}

export function condenseLogs<T extends JobLogEntry>(logs: T[], limit: number): T[] {
  if (limit <= 0) return []
  if (logs.length <= limit) return logs

  // One slot goes to the marker, so the arithmetic below has to account for it
  // or the result would be limit + 1 entries.
  const head = Math.min(LOG_HEAD_ENTRIES, Math.max(0, limit - 2))
  const tail = limit - head - 1

  // Everything between the two kept ends is about to go. A marker already in
  // there is not one lost entry, it is however many it was standing for.
  let elided = 0
  for (let i = head; i < logs.length - tail; i++) {
    const carried = elidedBy(logs[i])
    elided += carried > 0 ? carried : 1
  }

  const marker = {
    timestamp: logs[head]?.timestamp ?? new Date(),
    level: 'info' as const,
    message: `… ${elided.toLocaleString()} earlier entries not kept …`,
    data: { marker: ELISION_MARKER, elided } satisfies ElisionData,
  } as unknown as T

  return [...logs.slice(0, head), marker, ...logs.slice(logs.length - tail)]
}
