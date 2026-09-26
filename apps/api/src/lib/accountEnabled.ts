/**
 * Account access — `users.is_enabled` — and the one place it is still derived.
 *
 * `is_enabled` decides who can sign in, which sessions and API keys still work
 * and who can be viewed as, and it opens the WHERE clause of every per-user job.
 *
 * **It is an explicit admin decision.** It used to be derived from the feature
 * switches everywhere (F-127): an account could sign in while Movies, Series,
 * Discover or Collections was on. That made the switches do two jobs, so the
 * only way to shut someone out was to switch every feature off — discarding how
 * the account was set up — and letting them back in meant re-ticking all of it
 * from memory. `PUT /api/users/:id` now writes it ONLY from an explicit
 * `isEnabled`, and a feature switch never moves it (F-135).
 *
 * **Derivation survives where a writer offers no access control of its own**:
 * the setup wizard's per-user Recommendations switch and the admin import.
 * There the checkboxes are the only way to say "this person uses the app", so
 * initial access follows initial features. That is what the two functions
 * below are for, and nothing else should call them.
 *
 * Three switches count: Recommendations (which replaced Movies and Series,
 * F-136), Discover because a Discover-only viewer is a supported population
 * (F-104), and Collections because it is a permission only a signed-in person
 * can use. Request depends on Discover, and Email only permits notifications,
 * so neither enables an account by itself.
 *
 * An admin who is ALREADY enabled stays enabled with every switch off, so the
 * setup wizard cannot lock the admin running it out. It never enables an admin
 * who was not: the user sync imports every Emby admin switched off.
 */

export const ACCOUNT_SWITCH_COLUMNS = [
  'recommendations_enabled',
  'discover_enabled',
  'collections_enabled',
] as const

export type AccountSwitchColumn = (typeof ACCOUNT_SWITCH_COLUMNS)[number]

export interface AccountEnabledInput {
  recommendationsEnabled: boolean
  discoverEnabled: boolean
  collectionsEnabled: boolean
  isAdmin: boolean
  /** Whether the account was enabled before this write; false for a new row. */
  wasEnabled: boolean
}

/** The rule for a row being written whole, as an INSERT does. */
export function isAccountEnabled(account: AccountEnabledInput): boolean {
  return (
    account.recommendationsEnabled ||
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

/**
 * Why an access change must be refused, or null when it may go ahead.
 *
 * Turning off your own access ends your session on the spot, and nobody else
 * may be left who can turn it back on. Neither the login route nor the session
 * lookup exempts admins, so this is the only thing standing between an admin
 * and a lockout they cannot undo from the app. Turning it ON is always allowed
 * — an admin can only be making that request if they already have access.
 */
export function accessChangeRefusal(change: {
  actorId: string
  targetId: string
  isEnabled: boolean | undefined
}): string | null {
  if (change.isEnabled === false && change.actorId === change.targetId) {
    return 'You cannot turn off your own access.'
  }
  return null
}
