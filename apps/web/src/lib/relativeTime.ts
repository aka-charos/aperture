/**
 * "3 days ago" for any surface. Moved here from the gap-analysis listing when
 * the Shared page needed the same wording; `listing.ts` re-exports it so its
 * test and page are unchanged.
 */

export type RelativeUnit = 'minute' | 'hour' | 'day' | 'month' | 'year'

/**
 * A value and unit for `Intl.RelativeTimeFormat`. Floors rather than rounds, so
 * 359 days reads "11 months ago" and never "12 months ago" beside a date in
 * last year's April; zero is a positive 0, which formats as "now" rather than
 * "0 minutes ago".
 */
export function relativeTimeParts(then: Date, now: Date): { value: number; unit: RelativeUnit } {
  const delta = then.getTime() - now.getTime()
  const sign = delta < 0 ? -1 : 1
  const signed = (n: number) => (n === 0 ? 0 : sign * n)
  const minutes = Math.abs(delta) / 60_000
  if (minutes < 60) return { value: signed(Math.floor(minutes)), unit: 'minute' }
  const hours = minutes / 60
  if (hours < 24) return { value: signed(Math.floor(hours)), unit: 'hour' }
  const days = hours / 24
  if (days < 30) return { value: signed(Math.floor(days)), unit: 'day' }
  if (days < 365) return { value: signed(Math.floor(days / 30)), unit: 'month' }
  return { value: signed(Math.floor(days / 365)), unit: 'year' }
}

/** `then` relative to `now` in the reader's language ("yesterday", "3 days ago"). */
export function formatRelativeTime(then: Date, now: Date, locale: string): string {
  const { value, unit } = relativeTimeParts(then, now)
  return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(value, unit)
}
