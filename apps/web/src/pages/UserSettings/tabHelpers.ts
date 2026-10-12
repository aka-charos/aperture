/**
 * The settings tabs, by what each is about rather than where its data is
 * stored:
 *
 * - `recommendations` — everything that decides what this viewer is offered
 * - `display` — how things look while browsing
 * - `account` — their address, email opt-in and linked services
 * - `home` — their Emby home screen rows (Emby accounts only)
 *
 * Tabs are addressed by KEY, never by position. They used to be a position in
 * a JSX list, which is why a tab shown to only some accounts had to go last: a
 * hidden tab anywhere else renumbered every tab after it. Two tabs are
 * conditional now (`account` when it has nothing on it, `home` off Emby), so
 * position could not work.
 */
export const USER_SETTINGS_TAB_KEYS = ['recommendations', 'display', 'account', 'home'] as const

export type UserSettingsTabKey = (typeof USER_SETTINGS_TAB_KEYS)[number]

/**
 * Addresses that no longer name a tab, and where they should land instead —
 * where the thing an old link could change now lives, never just the default.
 *
 * - `watcher` (Watcher Identity) and `algorithm` (AI Algorithm) held the
 *   taste and recommendation settings, now all on Recommendations.
 * - `preferences` was a mix; most of it (poster badges, the similarity graph)
 *   is Display.
 * - `profile` was deleted earlier; its one editable part, the email address
 *   and notification opt-in, is on Account.
 */
const LEGACY_TAB_ALIASES: Record<string, UserSettingsTabKey> = {
  watcher: 'recommendations',
  algorithm: 'recommendations',
  preferences: 'display',
  profile: 'account',
}

function isTabKey(value: string): value is UserSettingsTabKey {
  return (USER_SETTINGS_TAB_KEYS as readonly string[]).includes(value)
}

/** The tab an address names, following retired names; the first tab for anything else. */
export function userSettingsTabFromParam(tab: string | null): UserSettingsTabKey {
  if (!tab) return USER_SETTINGS_TAB_KEYS[0]
  const resolved = Object.prototype.hasOwnProperty.call(LEGACY_TAB_ALIASES, tab) ? LEGACY_TAB_ALIASES[tab] : tab
  return isTabKey(resolved) ? resolved : USER_SETTINGS_TAB_KEYS[0]
}

/** The tab to show: the one asked for if this viewer has it, else the first one they do. */
export function visibleUserSettingsTab(
  tab: UserSettingsTabKey,
  visible: readonly UserSettingsTabKey[]
): UserSettingsTabKey {
  return visible.includes(tab) ? tab : (visible[0] ?? USER_SETTINGS_TAB_KEYS[0])
}
