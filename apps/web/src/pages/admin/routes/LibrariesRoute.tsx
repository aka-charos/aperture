import { useSettingsData } from '@/pages/settings/hooks'
import { LibraryConfigSection } from '@/pages/settings/components'

/**
 * `LibraryConfigSection` is one of only three sections that take their data as
 * props rather than fetching it themselves, so it needs a route wrapper to hold
 * `useSettingsData`.
 *
 * That hook currently fetches libraries, recommendation config, purge stats,
 * user settings and embedding config in one pass — which was right when a
 * single page rendered all of them and is wasteful now that they sit on three
 * different routes. Splitting it is tracked as its own change; until then this
 * route over-fetches, which is slow rather than wrong.
 */
export default function LibrariesRoute() {
  const settings = useSettingsData(true)

  return (
    <LibraryConfigSection
      libraries={settings.libraries}
      loadingLibraries={settings.loadingLibraries}
      syncingLibraries={settings.syncingLibraries}
      libraryError={settings.libraryError}
      updatingLibrary={settings.updatingLibrary}
      onSync={settings.syncLibrariesFromServer}
      onToggle={settings.toggleLibraryEnabled}
    />
  )
}
