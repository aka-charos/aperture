import type { TFunction } from 'i18next'

/** A length of time in milliseconds, in the reader's language. */
export function formatDurationMs(ms: number, t: TFunction): string {
  if (ms < 1000) return t('common.duration.ms', { ms })
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return t('common.duration.sec', { sec })
  const min = Math.floor(sec / 60)
  const remainingSec = sec % 60
  if (min < 60) return t('common.duration.minSec', { min, sec: remainingSec })
  const hr = Math.floor(min / 60)
  const remainingMin = min % 60
  return t('common.duration.hrMin', { hr, min: remainingMin })
}
