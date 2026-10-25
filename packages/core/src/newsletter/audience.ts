/**
 * Who a newsletter reaches. Pure.
 *
 * Two questions, kept apart because the admin needs to see both:
 *
 * 1. MEMBERSHIP — is this person in the group? A group is a set of rules
 *    (app language, admin or not) plus hand-picked people added or left out
 *    on top. An exclusion wins over everything, an inclusion over the rules.
 *    A group whose rules match "nobody" is a hand-picked list.
 *
 * 2. ELIGIBILITY — may this person be sent a newsletter at all? Only someone
 *    who switched newsletters on themselves, has a usable address, and still
 *    has access. This is the ONE predicate (`newsletterEligibility`): the
 *    audience preview, the send and the test all go through it, so the count
 *    the admin is shown is the count that is sent. Membership never overrides
 *    it — putting someone in a group by hand does not subscribe them.
 *
 * The opt-in is `users.newsletter_opt_in`, default off (0212), and NOT
 * `email_notifications_enabled`, whose default of on was set while that switch
 * did nothing and so proves nobody agreed to anything.
 */
import { isEmailAddress } from '../email/rules.js'
import { isValidAppLocale, type AppLocaleCode } from '../lib/locales.js'

export const GROUP_ROLES = ['any', 'admins', 'viewers'] as const
export type GroupRole = (typeof GROUP_ROLES)[number]

export interface GroupRules {
  /** `none` makes the group a hand-picked list. */
  match: 'rules' | 'none'
  /** App languages the group covers; empty means every language. */
  languages: AppLocaleCode[]
  role: GroupRole
}

export const DEFAULT_GROUP_RULES: GroupRules = { match: 'rules', languages: [], role: 'any' }

/** Stored rules, with anything unrecognised dropped rather than trusted. */
export function readGroupRules(raw: unknown): GroupRules {
  const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const languages = Array.isArray(value.languages)
    ? [...new Set(value.languages.filter((code): code is AppLocaleCode => isValidAppLocale(code as string)))]
    : []
  const role = (GROUP_ROLES as readonly string[]).includes(value.role as string) ? (value.role as GroupRole) : 'any'
  return { match: value.match === 'none' ? 'none' : 'rules', languages, role }
}

export interface AudienceUser {
  id: string
  username: string
  displayName: string | null
  email: string | null
  isAdmin: boolean
  isEnabled: boolean
  providerDisabled: boolean
  optedIn: boolean
  /** The person's effective app language, which is what their email is written in. */
  language: AppLocaleCode
}

export type MemberMode = 'include' | 'exclude'

export function matchesRules(user: AudienceUser, rules: GroupRules): boolean {
  if (rules.match === 'none') return false
  if (rules.languages.length > 0 && !rules.languages.includes(user.language)) return false
  if (rules.role === 'admins' && !user.isAdmin) return false
  if (rules.role === 'viewers' && user.isAdmin) return false
  return true
}

export type MembershipReason = 'rules' | 'included' | 'excluded' | 'none'

/** Whether someone is in a group, and why. */
export function membership(
  user: AudienceUser,
  rules: GroupRules,
  mode: MemberMode | undefined
): { member: boolean; reason: MembershipReason } {
  if (mode === 'exclude') return { member: false, reason: 'excluded' }
  if (mode === 'include') return { member: true, reason: 'included' }
  return matchesRules(user, rules) ? { member: true, reason: 'rules' } : { member: false, reason: 'none' }
}

export type Ineligibility = 'notOptedIn' | 'noAddress' | 'noAccess'

/** Why someone cannot be sent a newsletter, or null when they can. */
export function newsletterEligibility(user: AudienceUser): Ineligibility | null {
  if (!user.isEnabled || user.providerDisabled) return 'noAccess'
  if (!isEmailAddress(user.email)) return 'noAddress'
  if (!user.optedIn) return 'notOptedIn'
  return null
}

export interface GroupDefinition {
  id: string
  rules: GroupRules
  /** userId → mode */
  members: ReadonlyMap<string, MemberMode>
}

/**
 * The people a newsletter goes to: everyone who is a member of at least one of
 * the groups AND eligible, each once, in a stable order.
 */
export function resolveRecipients(
  users: readonly AudienceUser[],
  groups: readonly GroupDefinition[]
): AudienceUser[] {
  return users
    .filter((user) => groups.some((group) => membership(user, group.rules, group.members.get(user.id)).member))
    .filter((user) => newsletterEligibility(user) === null)
    .sort((a, b) => a.username.localeCompare(b.username) || a.id.localeCompare(b.id))
}
