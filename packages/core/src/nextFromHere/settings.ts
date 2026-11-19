/**
 * The stored size of a title page's suggestion list (summarySize.ts holds the
 * rule). One `system_settings` row; absent means the default.
 */

import { getSystemSetting, setSystemSetting } from '../settings/systemSettings.js'
import {
  SUMMARY_SIZE_DEFAULT,
  SUMMARY_SIZE_MAX,
  SUMMARY_SIZE_MIN,
  readSummarySize,
  summarySizeProblem,
  type SummarySizeLimits,
} from './summarySize.js'

const KEY = 'next_summary_size'

export async function getNextSummarySize(): Promise<number> {
  return readSummarySize(await getSystemSetting(KEY))
}

export async function getNextSummarySizeLimits(): Promise<SummarySizeLimits> {
  return {
    value: await getNextSummarySize(),
    default: SUMMARY_SIZE_DEFAULT,
    min: SUMMARY_SIZE_MIN,
    max: SUMMARY_SIZE_MAX,
  }
}

/** Throws a RangeError naming the problem for a value `summarySizeProblem` refuses. */
export async function setNextSummarySize(value: number): Promise<void> {
  const problem = summarySizeProblem(value)
  if (problem) throw new RangeError(`Suggestions on a title page ${problem}`)
  await setSystemSetting(KEY, String(value), "Suggestions on a title's page (Next from here)")
}
