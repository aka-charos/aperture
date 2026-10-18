/**
 * The guided tours: the welcome tour that starts on a new account's first
 * sign-in, and one per screen that "Show me around" opens.
 *
 * Pure data plus one resolver, pinned by `tours.test.ts`, which fails on an
 * anchor no element carries (`data-tour="…"` somewhere in apps/web/src), a
 * missing string, or a guide page that does not exist. The text of a step is
 * `onboarding.tours.<tour>.<step>.title` / `.body`.
 *
 * A step with no anchor, or whose anchor is not on screen (the phone's closed
 * menu, a widget the screen did not draw), is shown as a card in the middle of
 * the screen with the same words. A step is never skipped for want of an
 * anchor: what it says is still true, only where it points is missing.
 */

export type TourId =
  | 'welcome'
  | 'home'
  | 'browse'
  | 'title'
  | 'recommendations'
  | 'explore'
  | 'settings-recommendations'

/** An instance switch rather than a permission (`/api/onboarding` decides it). */
export type TourFeature = 'watching'

/** Something a step can open besides a guide page. */
export type TourAction = 'recommenderExplainer'

export type TourPlacement = 'top' | 'bottom' | 'left' | 'right'

/** The picture on a step's card; `TourOverlay` maps each to an icon. */
export type TourIcon =
  | 'sparkle'
  | 'star'
  | 'search'
  | 'chat'
  | 'compass'
  | 'help'
  | 'person'
  | 'checklist'
  | 'stats'
  | 'rows'
  | 'tabs'
  | 'filter'
  | 'grid'
  | 'film'
  | 'play'
  | 'article'
  | 'graph'
  | 'tune'
  | 'playlist'
  | 'heart'
  | 'refresh'

export interface TourListItem {
  /** `onboarding.tours.<tour>.<step>.items.<id>` */
  id: string
  capability?: string
  feature?: TourFeature
}

export interface TourStep {
  id: string
  icon: TourIcon
  /** The `data-tour` value of the element this step points at. */
  anchor?: string
  /** Shown only when the server grants this capability. */
  capability?: string
  feature?: TourFeature
  placement?: TourPlacement
  /** "Read more": a user guide page, and optionally a heading on it. */
  doc?: { slug: string; anchor?: string }
  action?: TourAction
  /** A list under the text, each line shown only when the person has it; no lines left, no step. */
  items?: readonly TourListItem[]
}

export interface Tour {
  id: TourId
  steps: readonly TourStep[]
}

export const TOURS: Record<TourId, Tour> = {
  welcome: {
    id: 'welcome',
    steps: [
      { id: 'intro', icon: 'sparkle' },
      {
        id: 'recommendations',
        icon: 'sparkle',
        anchor: 'nav-recommendations',
        placement: 'right',
        action: 'recommenderExplainer',
        doc: { slug: 'recommendations' },
      },
      { id: 'rating', icon: 'star', doc: { slug: 'ratings' } },
      { id: 'search', icon: 'search', anchor: 'app-search', placement: 'bottom', doc: { slug: 'global-search' } },
      {
        id: 'assistant',
        icon: 'chat',
        anchor: 'nav-assistant',
        placement: 'right',
        capability: 'assistant',
        doc: { slug: 'ai-assistant' },
      },
      {
        id: 'more',
        icon: 'compass',
        items: [
          { id: 'topPicks' },
          { id: 'watching', feature: 'watching' },
          { id: 'discover', capability: 'discover' },
          { id: 'watchThis', capability: 'social' },
          { id: 'collections', capability: 'collections' },
          { id: 'explore' },
        ],
      },
      { id: 'help', icon: 'help', anchor: 'app-help', placement: 'bottom' },
      { id: 'menu', icon: 'person', anchor: 'app-user-menu', placement: 'bottom' },
    ],
  },
  home: {
    id: 'home',
    steps: [
      { id: 'checklist', icon: 'checklist', anchor: 'home-checklist', placement: 'bottom' },
      { id: 'featured', icon: 'sparkle', anchor: 'home-featured', placement: 'bottom', doc: { slug: 'dashboard' } },
      { id: 'stats', icon: 'stats', anchor: 'home-stats', placement: 'bottom', doc: { slug: 'dashboard' } },
      { id: 'rows', icon: 'rows', anchor: 'home-rows', placement: 'top', doc: { slug: 'dashboard' } },
    ],
  },
  browse: {
    id: 'browse',
    steps: [
      { id: 'tabs', icon: 'tabs', anchor: 'browse-tabs', placement: 'bottom' },
      { id: 'filters', icon: 'filter', anchor: 'browse-filters', placement: 'bottom', doc: { slug: 'browse' } },
      { id: 'view', icon: 'grid', anchor: 'browse-view', placement: 'bottom', doc: { slug: 'grid-list-views' } },
      { id: 'open', icon: 'star', anchor: 'browse-results', placement: 'top' },
    ],
  },
  title: {
    id: 'title',
    steps: [
      { id: 'hero', icon: 'film', anchor: 'title-hero', placement: 'bottom' },
      { id: 'actions', icon: 'play', anchor: 'title-actions', placement: 'bottom', doc: { slug: 'ratings' } },
      { id: 'insights', icon: 'sparkle', anchor: 'title-insights', placement: 'top', doc: { slug: 'recommendations' } },
      { id: 'analysis', icon: 'article', anchor: 'title-analysis', placement: 'top', doc: { slug: 'title-analysis' } },
      { id: 'similar', icon: 'graph', anchor: 'title-similar', placement: 'top', doc: { slug: 'similarity-graphs' } },
    ],
  },
  recommendations: {
    id: 'recommendations',
    steps: [
      { id: 'list', icon: 'rows', anchor: 'recs-results', placement: 'top' },
      { id: 'why', icon: 'help', action: 'recommenderExplainer', doc: { slug: 'recommendations' } },
      { id: 'teach', icon: 'tune', doc: { slug: 'user-settings/recommendations' } },
    ],
  },
  explore: {
    id: 'explore',
    steps: [
      { id: 'graph', icon: 'graph', anchor: 'explore-graph', placement: 'top', doc: { slug: 'explore' } },
      { id: 'controls', icon: 'search', anchor: 'explore-controls', placement: 'bottom' },
      { id: 'playlist', icon: 'playlist', doc: { slug: 'playlists' } },
    ],
  },
  'settings-recommendations': {
    id: 'settings-recommendations',
    steps: [
      { id: 'interests', icon: 'heart', anchor: 'settings-interests', placement: 'bottom', doc: { slug: 'user-settings/recommendations' } },
      { id: 'weights', icon: 'tune', anchor: 'settings-weights', placement: 'top' },
      { id: 'rescan', icon: 'refresh', doc: { slug: 'user-settings/recommendations' } },
    ],
  },
}

export function isTourId(value: string): value is TourId {
  return Object.prototype.hasOwnProperty.call(TOURS, value)
}

/** What decides which steps and lines a person sees: the server's answers only. */
export interface TourAudience {
  capabilities: Record<string, boolean | undefined>
  features: Partial<Record<TourFeature, boolean>>
}

function allowed(entry: { capability?: string; feature?: TourFeature }, audience: TourAudience): boolean {
  if (entry.capability && audience.capabilities[entry.capability] !== true) return false
  if (entry.feature && audience.features[entry.feature] !== true) return false
  return true
}

/**
 * The steps this person sees: a gated step or line only when the server
 * granted it, and a list step only with a line left in it. A feature whose
 * answer has not arrived reads as off — a step about a feature someone does
 * not have is worse than one fewer step.
 */
export function resolveSteps(tour: Tour, audience: TourAudience): TourStep[] {
  const steps: TourStep[] = []
  for (const step of tour.steps) {
    if (!allowed(step, audience)) continue
    if (step.items) {
      const items = step.items.filter((item) => allowed(item, audience))
      if (items.length === 0) continue
      steps.push({ ...step, items })
      continue
    }
    steps.push(step)
  }
  return steps
}

/** The i18n key of a step's title or body. */
export function stepKey(tour: TourId, step: string, part: 'title' | 'body'): string {
  return `onboarding.tours.${tour}.${step}.${part}`
}

/** The i18n key of one line of a list step. */
export function stepItemKey(tour: TourId, step: string, item: string): string {
  return `onboarding.tours.${tour}.${step}.items.${item}`
}
