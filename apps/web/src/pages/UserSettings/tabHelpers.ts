/**
 * `home` is last on purpose: it is rendered only for an Emby account (managed
 * home rows are Emby-only), and a tab left out at the END shifts no other tab's
 * index. Anywhere else, hiding it would send every later tab's address to the
 * wrong panel.
 */
export const USER_SETTINGS_TAB_KEYS = ['watcher', 'algorithm', 'preferences', 'home'] as const

/** Tabs shown only to some accounts: an address naming one lands on the first tab otherwise. */
export const CONDITIONAL_TAB_KEYS: ReadonlySet<UserSettingsTabKey> = new Set(['home'])

export type UserSettingsTabKey = (typeof USER_SETTINGS_TAB_KEYS)[number]

/**
 * Addresses that no longer name a tab, and where they should land instead.
 *
 * `profile` was a tab until its read-only half (avatar, username, display name,
 * media server, role -- every field disabled, all of it already in the account
 * menu header) was deleted and its one editable part, the email address and
 * notification opt-in, moved into Preferences. So a bookmark or an old link to
 * `?tab=profile` resolves *there*, where the thing it could actually change now
 * lives. Falling through to the default would silently land on Watcher
 * Identity, which shares nothing with what the link asked for.
 */
const LEGACY_TAB_ALIASES: Record<string, UserSettingsTabKey> = {
  profile: 'preferences',
}

export function userSettingsTabIndexFromParam(tab: string | null): number {
  if (!tab) return 0
  const resolved = LEGACY_TAB_ALIASES[tab] ?? tab
  const idx = USER_SETTINGS_TAB_KEYS.indexOf(resolved as UserSettingsTabKey)
  return idx >= 0 ? idx : 0
}

export function userSettingsTabParamFromIndex(index: number): string {
  return USER_SETTINGS_TAB_KEYS[index] ?? USER_SETTINGS_TAB_KEYS[0]
}
