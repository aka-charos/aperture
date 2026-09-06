/**
 * Does `job_config` still agree with the job catalogue about what exists?
 *
 * There are three lists of job names and only two of them can be checked
 * against each other by anything in this repo. `definitions.ts` is the registry
 * of what a job IS; `JOB_SCHEDULE_DEFAULTS` (core) is a seed cadence for a job
 * with no row yet; `jobDefaults.test.ts` compares those two. The third is the
 * `job_config` TABLE, and it is the one the scheduler actually reads --
 * `initializeScheduler` builds its cron tasks from `getAllJobConfigs()`, which
 * merges DB rows over the seed map and never consults `definitions.ts` at all.
 *
 * So a row naming a job that no longer exists gets scheduled, fires on time,
 * and throws `Unknown job` in the executor. Nothing in the build can see it,
 * because no test can reach the database.
 *
 * That is not hypothetical. `generate-recommendations` and `sync-watch-history`
 * were split by media type in January; the code side finished and neither
 * rename deleted the row the old name left behind. Both failed nightly for
 * months -- 00:00 and 01:00 UTC on the live instance -- while every static
 * check stayed green. Migration `0164` removed those two. This is what notices
 * the next pair.
 *
 * Deliberately a WARNING and nothing else. An orphan row is a rename somebody
 * has not finished, and the two safe-looking automatic responses are both
 * wrong: deleting it at boot would destroy a row an in-progress rename still
 * wants, and refusing to start would take the whole instance down over two
 * lines of log noise. A migration is how rows get removed, by someone who knows
 * which rename it belonged to.
 */

import { createChildLogger, type JobConfig } from '@aperture/core'

const logger = createChildLogger('jobs-config-drift')

export interface OrphanJobConfig {
  jobName: string
  /**
   * Whether the scheduler will actually try to run it.
   *
   * An orphan that is disabled or manual-only is inert clutter -- it can never
   * reach the executor, so it costs nothing but a confusing row on the Schedule
   * tab. An orphan with a live cadence is the one that fails on a timer, and
   * the two want different urgency from whoever reads the log.
   */
  willBeScheduled: boolean
  scheduleType: JobConfig['scheduleType']
  isEnabled: boolean
}

export interface JobConfigDrift {
  orphans: OrphanJobConfig[]
  /** Orphans the scheduler will try to run, i.e. the ones that fail on a timer. */
  scheduled: OrphanJobConfig[]
}

/**
 * Compare stored job configs against the catalogue.
 *
 * Pure, so the decision is testable without a database -- the same split as
 * `sourceFloor.ts` and `pending.ts` in core, and for the same reason: the whole
 * point of this module is a comparison nothing else can make, so the comparison
 * itself must not need a live Postgres to exercise.
 *
 * Only checks one direction. A REGISTERED job with no row is fine and is
 * already covered by `jobDefaults.test.ts`: `getJobConfig` falls back to the
 * seed cadence, and to manual-only when there is not even one of those.
 */
export function findJobConfigDrift(
  configs: readonly JobConfig[],
  registeredNames: Iterable<string>
): JobConfigDrift {
  const registered = new Set(registeredNames)

  const orphans = configs
    .filter((config) => !registered.has(config.jobName))
    .map((config) => ({
      jobName: config.jobName,
      // Mirrors `scheduleToCron`, which returns null -- and therefore schedules
      // nothing -- for exactly these two cases. If that rule ever changes this
      // has to change with it, or the log will describe a row as inert while
      // the scheduler runs it.
      willBeScheduled: config.isEnabled && config.scheduleType !== 'manual',
      scheduleType: config.scheduleType,
      isEnabled: config.isEnabled,
    }))
    .sort((a, b) => a.jobName.localeCompare(b.jobName))

  return { orphans, scheduled: orphans.filter((o) => o.willBeScheduled) }
}

/**
 * Log the comparison. Called once at boot, before the scheduler reads the table.
 *
 * Never throws: this is a diagnostic, and an instance that cannot read
 * `job_config` is about to fail at scheduling anyway, far more loudly.
 */
export async function reportJobConfigDrift(
  loadConfigs: () => Promise<JobConfig[]>,
  registeredNames: Iterable<string>
): Promise<JobConfigDrift | null> {
  let configs: JobConfig[]
  try {
    configs = await loadConfigs()
  } catch (err) {
    logger.debug({ err }, 'Could not read job_config to check it against the catalogue')
    return null
  }

  const drift = findJobConfigDrift(configs, registeredNames)
  if (drift.orphans.length === 0) return drift

  logger.warn(
    {
      orphans: drift.orphans.map((o) => o.jobName),
      willBeScheduled: drift.scheduled.map((o) => o.jobName),
    },
    `${drift.orphans.length} job_config row(s) name a job this build does not have` +
      (drift.scheduled.length > 0
        ? `, and ${drift.scheduled.length} of them will be scheduled and fail with "Unknown job" on every firing: ` +
          `${drift.scheduled.map((o) => o.jobName).join(', ')}. ` +
          `Left over from a rename that did not delete the old row -- remove them in a migration (see 0164).`
        : `. None are schedulable, so they are clutter rather than failures, but they still make ` +
          `job_config disagree with the catalogue -- remove them in a migration (see 0164).`)
  )

  return drift
}
