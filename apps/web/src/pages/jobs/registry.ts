import type { JobCategory } from './types'

/**
 * The job catalogue as pure data: which jobs exist, how they are grouped, and
 * what each one is called.
 *
 * Split out of `constants.tsx` because that module holds the icons, which are
 * JSX — and the settings search needs this list without a DOM, the same way
 * `admin/nav/registry.ts` is pure so its test can load it under plain
 * `node --test`. Keeping one list rather than a second one beside it is the
 * whole point: the search index and the page that renders the cards read the
 * same array, so a job cannot be searchable but absent, or present but
 * unfindable.
 *
 * This really is an allowlist rather than a mirror of the API's registry — a
 * job missing from every category renders no card, so it has no Run button
 * and, worse, no Cancel button, however correctly it is registered server-side.
 */

export const MOVIE_JOB_CATEGORIES: JobCategory[] = [
  {
    titleKey: 'admin.jobsPage.categories.movieSync.title',
    descriptionKey: 'admin.jobsPage.categories.movieSync.description',
    color: '#3b82f6',
    jobs: ['sync-movies', 'sync-movie-watch-history'],
  },
  {
    titleKey: 'admin.jobsPage.categories.movieAi.title',
    descriptionKey: 'admin.jobsPage.categories.movieAi.description',
    color: '#8b5cf6',
    jobs: ['generate-movie-embeddings', 'generate-movie-recommendations', 'full-reset-movie-recommendations'],
  },
  {
    titleKey: 'admin.jobsPage.categories.movieLib.title',
    descriptionKey: 'admin.jobsPage.categories.movieLib.description',
    color: '#6366f1',
    jobs: ['sync-movie-libraries'],
  },
]

export const SERIES_JOB_CATEGORIES: JobCategory[] = [
  {
    titleKey: 'admin.jobsPage.categories.seriesSync.title',
    descriptionKey: 'admin.jobsPage.categories.seriesSync.description',
    color: '#0891b2',
    jobs: ['sync-series', 'sync-series-watch-history'],
  },
  {
    titleKey: 'admin.jobsPage.categories.seriesAi.title',
    descriptionKey: 'admin.jobsPage.categories.seriesAi.description',
    color: '#7c3aed',
    jobs: ['generate-series-embeddings', 'generate-series-recommendations', 'full-reset-series-recommendations'],
  },
  {
    titleKey: 'admin.jobsPage.categories.seriesLib.title',
    descriptionKey: 'admin.jobsPage.categories.seriesLib.description',
    color: '#4f46e5',
    jobs: ['sync-series-libraries'],
  },
]

export const GLOBAL_JOB_CATEGORIES: JobCategory[] = [
  {
    titleKey: 'admin.jobsPage.categories.globalMeta.title',
    descriptionKey: 'admin.jobsPage.categories.globalMeta.description',
    color: '#10b981',
    jobs: ['enrich-metadata', 'enrich-studio-logos', 'enrich-mdblist'],
  },
  {
    titleKey: 'admin.jobsPage.categories.globalCurated.title',
    descriptionKey: 'admin.jobsPage.categories.globalCurated.description',
    color: '#f59e0b',
    jobs: ['refresh-top-picks', 'auto-request-top-picks', 'sync-watching-favorites'],
  },
  {
    titleKey: 'admin.jobsPage.categories.globalDiscovery.title',
    descriptionKey: 'admin.jobsPage.categories.globalDiscovery.description',
    color: '#ec4899',
    jobs: ['generate-discovery-suggestions'],
  },
  // Taste profiles are per-user but span both media types, so they belong here
  // rather than under Movies or Series.
  {
    titleKey: 'admin.jobsPage.categories.globalTaste.title',
    descriptionKey: 'admin.jobsPage.categories.globalTaste.description',
    color: '#a855f7',
    jobs: ['refresh-embedding-centering', 'rebuild-taste-profiles'],
  },
  // Same reasoning: one pass covers both media types.
  {
    titleKey: 'admin.jobsPage.categories.globalExplanations.title',
    descriptionKey: 'admin.jobsPage.categories.globalExplanations.description',
    color: '#06b6d4',
    jobs: ['refresh-recommendation-explanations'],
  },
  {
    titleKey: 'admin.jobsPage.categories.globalAnalysis.title',
    descriptionKey: 'admin.jobsPage.categories.globalAnalysis.description',
    color: '#e91e63',
    jobs: ['generate-title-analysis'],
  },
  // Its own category rather than a line inside Metadata Enrichment, because
  // the distinction is the entire point of the job: metadata is written once
  // and stays correct, ratings move every week, and filing this under
  // "Metadata" is how it would end up back behind the stamp-once predicate.
  {
    titleKey: 'admin.jobsPage.categories.globalRatings.title',
    descriptionKey: 'admin.jobsPage.categories.globalRatings.description',
    color: '#f97316',
    jobs: ['refresh-ratings'],
  },
  // A measuring instrument rather than a step in any pipeline, so it gets its
  // own category: filing it under Taste Profiles would suggest it changes
  // something, and it deliberately writes nothing at all.
  {
    titleKey: 'admin.jobsPage.categories.globalEvaluation.title',
    descriptionKey: 'admin.jobsPage.categories.globalEvaluation.description',
    color: '#14b8a6',
    jobs: ['evaluate-recommender'],
  },
  {
    titleKey: 'admin.jobsPage.categories.globalIntegrations.title',
    descriptionKey: 'admin.jobsPage.categories.globalIntegrations.description',
    color: '#ed1c24',
    jobs: ['sync-trakt-ratings', 'refresh-ai-pricing', 'sync-lldap-emails'],
  },
]

export const JOB_CATEGORIES: JobCategory[] = [
  ...MOVIE_JOB_CATEGORIES,
  ...SERIES_JOB_CATEGORIES,
  ...GLOBAL_JOB_CATEGORIES,
]

/**
 * Display names that cannot be derived. Everything else title-cases its id
 * (`sync-movies` reads as "Sync Movies"), which is both what the page shows and
 * what an operator would type — so only the handful where that reads wrong get
 * a string here.
 */
export const JOB_DISPLAY_NAME_KEYS: Record<string, string> = {
  'sync-movie-libraries': 'admin.jobsPage.jobNames.syncMovieLibraries',
  'sync-series-libraries': 'admin.jobsPage.jobNames.syncSeriesLibraries',
  'full-reset-movie-recommendations': 'admin.jobsPage.jobNames.fullResetMovieRecommendations',
  'full-reset-series-recommendations': 'admin.jobsPage.jobNames.fullResetSeriesRecommendations',
  // Auto title-casing turns "lldap" into "Lldap" — the acronym needs its own key.
  'sync-lldap-emails': 'admin.jobsPage.jobNames.syncLldapEmails',
}

/** Every job that has a card, in the order the page lays them out. */
export const ALL_JOB_NAMES: readonly string[] = JOB_CATEGORIES.flatMap((c) => c.jobs)

/** The category a job belongs to, for labelling a search result. */
export function jobCategoryFor(name: string): JobCategory | undefined {
  return JOB_CATEGORIES.find((c) => c.jobs.includes(name))
}

/**
 * The DOM id of a job's card, and the anchor a search result navigates to.
 * One function so the card and the link cannot disagree about the spelling.
 */
export function jobAnchor(name: string): string {
  return `job-${name}`
}

/** The job named by a `#job-…` hash, or null for any other hash. */
export function jobFromAnchor(hash: string): string | null {
  const name = hash.replace(/^#/, '').replace(/^job-/, '')
  return hash.startsWith('#job-') && ALL_JOB_NAMES.includes(name) ? name : null
}

/**
 * Which of the page's four tabs holds a job — 0 Movies, 1 Series, 2 Global.
 *
 * The page unmounts the inactive panels, so a job on another tab has no DOM
 * node at all: a search result for a global job landed on the page with its
 * anchor pointing at nothing, and the scroll silently did nothing. Deriving the
 * index from the same three arrays the page renders is what keeps this honest.
 */
export function jobTabIndex(name: string): number | null {
  const tabs = [MOVIE_JOB_CATEGORIES, SERIES_JOB_CATEGORIES, GLOBAL_JOB_CATEGORIES]
  const index = tabs.findIndex((categories) => categories.some((c) => c.jobs.includes(name)))
  return index === -1 ? null : index
}

/** `sync-movies` → `Sync Movies`. */
export function titleCaseJobName(name: string): string {
  return name
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}
