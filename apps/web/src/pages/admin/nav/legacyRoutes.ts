/**
 * Addresses the admin console used before it was split into one route per
 * section, mapped to where each one now lives.
 *
 * The old page addressed a *panel* through query params — `?tab=ai-recs&
 * aiSub=algorithm` — so five in-app links, a release note and any bookmark an
 * operator kept all point at URLs that no longer resolve. The shim is frozen:
 * nothing new is ever added here, which is why it costs nothing to keep.
 *
 * Pure, so `registry.test.ts` can assert every target is a real entry path.
 */

/** `?tab=` values the old settings page understood. */
const TAB_TARGETS: Record<string, string> = {
  setup: '/admin/library/server',
  'ai-llm': '/admin/ai/roles',
  'ai-recs': '/admin/recommendations/algorithm',
  'top-picks': '/admin/recommendations/top-picks',
  watching: '/admin/recommendations/watching',
  maintenance: '/admin/ops/poster-repair',
  system: '/admin/appearance/branding',
}

/** `?setupSub=` refined `?tab=setup`; `?aiSub=` refined `?tab=ai-recs`. */
const SUB_TAB_TARGETS: Record<string, string> = {
  // setupSub
  media: '/admin/library/server',
  integrations: '/admin/integrations/tmdb',
  'genre-discovery': '/admin/recommendations/genre-strips',
  // aiSub
  output: '/admin/recommendations/output',
  features: '/admin/recommendations/explanations',
  algorithm: '/admin/recommendations/algorithm',
}

/** Admin pages that were siblings of the settings page and are now leaves. */
export const LEGACY_ADMIN_PATHS: Record<string, string> = {
  '/admin/users': '/admin/access/users',
  '/admin/jobs': '/admin/ops/jobs',
  '/admin/translations': '/admin/appearance/translations',
  '/admin/gaps': '/admin/library/gaps',
  '/admin/settings': '/admin/library/server',
}

/**
 * Where an old settings link should land. The sub-tab wins when it names one,
 * because it was the more specific half of the address; an unrecognised value
 * falls back to the tab, and an unrecognised tab to the console's first
 * section rather than to a dead end.
 */
export function resolveLegacySettingsPath(params: URLSearchParams): string {
  const sub = params.get('setupSub') ?? params.get('aiSub')
  if (sub && SUB_TAB_TARGETS[sub]) return SUB_TAB_TARGETS[sub]

  const tab = params.get('tab')
  if (tab && TAB_TARGETS[tab]) return TAB_TARGETS[tab]

  return '/admin/library/server'
}

/** Every destination this shim can produce — the test checks they all exist. */
export function legacyTargets(): string[] {
  return [
    ...Object.values(TAB_TARGETS),
    ...Object.values(SUB_TAB_TARGETS),
    ...Object.values(LEGACY_ADMIN_PATHS),
    resolveLegacySettingsPath(new URLSearchParams()),
  ]
}
