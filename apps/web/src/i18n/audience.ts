/**
 * Who each translation namespace is written for.
 *
 * The catalogue is one flat file under one i18next namespace, so nothing in
 * the format records who ever sees a given string. That is fine for
 * rendering and wrong for everything else: a translation batch cannot be
 * ordered viewer-first, and the Translations editor can only offer a flat
 * list of every namespace in the file.
 *
 * The split is declared here rather than read off the key prefix, because
 * the prefix does not carry it. CONVENTIONS.md asks for `admin.` or
 * `settingsSection.`; `settingsSection` exists nowhere in the repo, and what
 * actually emerged is thirty-odd `settings<Thing>` namespaces plus `jobsUi`,
 * `topPicksAdmin`, `inferenceDashboard`, `runningJobs`, `setup` and others.
 * There is no prefix that selects them.
 *
 * The question a namespace answers here is **"can someone who is not an
 * admin ever see this string?"** — not "is it about administration". So
 * `admin` means *no non-admin surface reads it*, which is a strong,
 * checkable property; `user` is its complement and deliberately does NOT
 * mean "only viewers see it". The admin console legitimately labels user
 * features (the nav registry reuses the watching, dashboard and playlists
 * namespaces for section titles) and the common namespace is read from both
 * sides — those are viewer-reachable strings, so they are `user`.
 *
 * `audience.test.ts` re-derives both lists from the source tree and fails on
 * drift in either direction, so this is a pinned measurement rather than a
 * list anyone has to maintain by hand.
 */

export type StringAudience = 'admin' | 'user'

/**
 * Source paths (relative to `apps/web/src`, POSIX separators) whose strings
 * only ever render for an admin. Prefix match, so a directory entry covers
 * everything under it.
 *
 * The four page directories are the admin routes. The rest are modules that
 * live outside them and are still admin-only:
 *
 * - `Users.tsx` / `UserDetail.tsx` are admin routes that never moved under
 *   `pages/admin/` — they are wired up in `pages/admin/nav/routes.tsx`.
 * - The `AI*` components and `WebSearchUsagePanel` are the provider-setup
 *   cards, rendered by the settings and setup wizards only.
 * - `ImageUpload` and `TopPicksOutputConfig` are reachable only from those
 *   same two places.
 * - `RunningJobsWidget` and `ExplorationConfigModal` are mounted by
 *   `Layout.tsx`, which every viewer renders, but both return null unless
 *   `user.isAdmin` — so the file's location says nothing and the gate inside
 *   it decides. This is the one class of entry that cannot be derived from
 *   the tree, and the reason this list is written down.
 */
export const ADMIN_SURFACE_PATHS: readonly string[] = [
  'pages/admin/',
  'pages/settings/',
  'pages/jobs/',
  'pages/setup/',
  'pages/Users.tsx',
  'pages/UserDetail.tsx',
  'components/Admin',
  'components/AIFallbackModels.tsx',
  'components/AIFunctionCard.tsx',
  'components/AISetupCardGrid.tsx',
  'components/aiProviderInfo.ts',
  'components/WebSearchUsagePanel.tsx',
  'components/TopPicksOutputConfig.tsx',
  'components/ImageUpload.tsx',
  'components/ExplorationConfigModal.tsx',
  'components/RunningJobsWidget.tsx',
  'hooks/AdminSearchProvider.tsx',
  'hooks/useAdminSearch.ts',
]

/**
 * Namespaces read only from the surfaces above. Sorted; keep it that way so
 * the diff when one moves is one line.
 */
export const ADMIN_ONLY_NAMESPACES: readonly string[] = [
  'admin',
  'adminNav',
  'aiFunctionCard',
  'explorationConfig',
  'imageUpload',
  'inferenceDashboard',
  'jobsUi',
  'runningJobs',
  'settingsAiExplanation',
  'settingsAiSetup',
  'settingsApiKeys',
  'settingsBackup',
  'settingsBranding',
  'settingsChannelsWebExpand',
  'settingsCostEstimator',
  'settingsCrw',
  'settingsDatabase',
  'settingsDeployment',
  'settingsDiscovery',
  'settingsDiscoveryGenreStrips',
  'settingsEvaluation',
  'settingsFileLocations',
  'settingsLegacyEmbeddings',
  'settingsLibraryConfig',
  'settingsLibraryMatchPreview',
  'settingsLibraryTitles',
  'settingsLldap',
  'settingsMdblist',
  'settingsMdblistSelector',
  'settingsMediaServer',
  'settingsOmdb',
  'settingsOutputFormat',
  'settingsPage',
  'settingsPosterDisplay',
  'settingsRatings',
  'settingsRecAlgo',
  'settingsSeerr',
  'settingsStreamingDiscovery',
  'settingsTavily',
  'settingsThemeColors',
  'settingsTmdb',
  'settingsTrakt',
  'settingsWatching',
  'setup',
  'topPicksAdmin',
  'topPicksOutputConfig',
  'webSearchUsage',
]

const ADMIN_ONLY = new Set(ADMIN_ONLY_NAMESPACES)

/** Audience of a top-level namespace. Anything unlisted is viewer-reachable. */
export function namespaceAudience(namespace: string): StringAudience {
  return ADMIN_ONLY.has(namespace) ? 'admin' : 'user'
}

/** Audience of a full dotted key — the namespace is its first segment. */
export function keyAudience(key: string): StringAudience {
  return namespaceAudience(key.split('.')[0])
}

/**
 * Does this source file only ever render for an admin? Takes a path relative
 * to `apps/web/src` with forward slashes. Used by the test that re-derives
 * the list above; nothing at runtime needs it.
 */
export function isAdminSurfacePath(srcRelativePath: string): boolean {
  return ADMIN_SURFACE_PATHS.some((prefix) => srcRelativePath.startsWith(prefix))
}
