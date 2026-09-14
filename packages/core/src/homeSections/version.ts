/**
 * The Emby version floor for managed home sections.
 *
 * Checked live on every run and before the feature can be switched on, never
 * cached: a server can be downgraded after the setting was saved, and the right
 * response then is to skip with a reason, not to fail or to switch the feature
 * off behind the operator's back.
 */

export const MIN_EMBY_VERSION = '4.10.0.40'

/**
 * `4.10.0.40` → `[4, 10, 0, 40]`, padded to four parts. Null for anything that
 * is not two to four dot-separated integers — a garbage version must fail the
 * gate, never pass it by comparing as zeros.
 */
export function parseServerVersion(version: string | null | undefined): number[] | null {
  if (typeof version !== 'string') return null
  const parts = version.trim().split('.')
  if (parts.length < 2 || parts.length > 4) return null
  if (!parts.every((part) => /^\d+$/.test(part))) return null
  const numbers = parts.map((part) => Number(part))
  while (numbers.length < 4) numbers.push(0)
  return numbers
}

/** Negative when a < b, zero when equal, positive when a > b. */
export function compareVersions(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

export function isEmbyVersionSupported(version: string | null | undefined): boolean {
  const parsed = parseServerVersion(version)
  const floor = parseServerVersion(MIN_EMBY_VERSION)
  if (!parsed || !floor) return false
  return compareVersions(parsed, floor) >= 0
}
