/**
 * Whether a user account is enabled — the one rule for every writer of
 * `users.is_enabled`.
 *
 * `is_enabled` decides who can sign in, which sessions and API keys still work
 * and who can be viewed as, and it opens the WHERE clause of every per-user job.
 * It has no meaning apart from the switches beside it on the Users page: an
 * account is enabled when one of its feature switches is on.
 *
 * It used to be worked out separately at each writer, from Movies and Series
 * alone, and `PUT /api/users/:id` cleared it only when both arrived OFF in the
 * same request — while the Users page sends one switch per request. An account
 * switched off one switch at a time therefore stayed enabled: it could still sign
 * in, its API keys still worked, and it still got personal Emby home rows, under a
 * row of switches that all read off (F-127).
 *
 * Four switches count. Discover counts because a Discover-only viewer is a
 * supported population (F-104); Collections because it is a permission only a
 * signed-in person can use. Request depends on Discover, and Email only permits
 * notifications, so neither enables an account by itself.
 *
 * An admin who is ALREADY enabled stays enabled with every switch off. Neither the
 * login route nor the session lookup exempts admins, so without this an admin who
 * switches off their own recommendations loses the console they would need to
 * switch them back on. It never enables an admin who was not: the user sync
 * imports every Emby admin switched off, and turning them all on is not this
 * rule's decision.
 */

export const ACCOUNT_SWITCH_COLUMNS = [
  'movies_enabled',
  'series_enabled',
  'discover_enabled',
  'collections_enabled',
] as const

export type AccountSwitchColumn = (typeof ACCOUNT_SWITCH_COLUMNS)[number]

export interface AccountEnabledInput {
  moviesEnabled: boolean
  seriesEnabled: boolean
  discoverEnabled: boolean
  collectionsEnabled: boolean
  isAdmin: boolean
  /** Whether the account was enabled before this write; false for a new row. */
  wasEnabled: boolean
}

/** The rule for a row being written whole, as an INSERT does. */
export function isAccountEnabled(account: AccountEnabledInput): boolean {
  return (
    account.moviesEnabled ||
    account.seriesEnabled ||
    account.discoverEnabled ||
    account.collectionsEnabled ||
    (account.isAdmin && account.wasEnabled)
  )
}

/**
 * The same rule as a SQL expression, for an UPDATE of `users`.
 *
 * Every expression in one UPDATE's SET list reads the row as it was BEFORE the
 * statement. So a switch the statement also writes must be given its new value
 * in `written` (normally its bind parameter): the bare column would read the old
 * value, and the account would follow the switch one save late. `is_admin` and
 * `is_enabled` are read as they were, which is what the admin clause needs.
 */
export function accountEnabledSql(written: Partial<Record<AccountSwitchColumn, string>> = {}): string {
  const switches = ACCOUNT_SWITCH_COLUMNS.map((column) => written[column] ?? column)
  return `(${[...switches, '(is_admin AND is_enabled)'].join(' OR ')})`
}
