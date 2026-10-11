/**
 * How an LLDAP account lines up with an Aperture one. Pure, no database.
 *
 * Two readers ask these questions and must get the same answers: the email
 * import (`sync.ts`), which copies each account's address, and the account
 * drift report (`users/accountDrift.ts`), which shows an admin what that
 * import will and will not find. A rule copied into both is how the report
 * comes to say an address will be imported while the import skips it.
 */
import { isEmailAddress } from '../email/rules.js'

/**
 * The key an account is matched on: the username, ignoring case. LLDAP stores
 * user ids lowercased and the media server keeps the case it was given, so a
 * case-sensitive comparison would miss every account with a capital letter.
 * Nothing else is folded — no trimming, no accent stripping — because two
 * names that differ in more than case are two accounts.
 */
export function directoryUsernameKey(username: string): string {
  return username.toLowerCase()
}

export type LldapEmailState =
  | { state: 'none' }
  | { state: 'unusable'; raw: string }
  | { state: 'usable'; email: string }

/**
 * What an LLDAP account's email field gives the import. LLDAP does not
 * validate the field, so an address is imported only when the mail transport
 * would accept it (`isEmailAddress`, the test the settings page applies too).
 */
export function lldapEmailState(raw: string | null | undefined): LldapEmailState {
  const trimmed = (raw ?? '').trim()
  if (!trimmed) return { state: 'none' }
  if (!isEmailAddress(trimmed)) return { state: 'unusable', raw: trimmed }
  return { state: 'usable', email: trimmed }
}
