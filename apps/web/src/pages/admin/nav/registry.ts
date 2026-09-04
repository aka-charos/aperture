/**
 * The one place the admin console's shape is written down.
 *
 * This module is the single source for three things that were previously three
 * hand-maintained lists that could disagree: the nav tree, the route table, and
 * the settings search index. It is deliberately **pure data** — no JSX, no
 * React, no MUI — so `registry.test.ts` can load it under the repo's
 * `node --import tsx --test` without a DOM. The icons and the components live
 * beside it in `elements.tsx`, keyed by the same ids, and the test pins the two
 * halves together.
 *
 * Adding a section means adding an entry here and an element there. Omitting
 * the entry does not leave the section half-registered the way a missing
 * `JOB_CATEGORIES` key leaves a job — it produces no route at all, so the
 * section is unreachable rather than quietly missing its controls.
 *
 * Depth is capped at two levels, group then leaf, permanently. A group that
 * outgrows roughly a dozen leaves splits into two groups; it never grows a
 * third tier. That rule is what keeps the tab-strip failure this replaced from
 * returning in a different shape.
 */

/** Groups are ordered here, and the nav column renders them in this order. */
export const ADMIN_GROUP_IDS = [
  'overview',
  'library',
  'integrations',
  'ai',
  'recommendations',
  'appearance',
  'access',
  'ops',
] as const

export type AdminGroupId = (typeof ADMIN_GROUP_IDS)[number]

export interface AdminGroup {
  id: AdminGroupId
  /**
   * The path segment under `/admin`. Empty for `overview`, whose single entry
   * is the index route — the console has to land somewhere, and that somewhere
   * should not be a group heading.
   */
  segment: string
  labelKey: string
}

export const ADMIN_GROUPS: readonly AdminGroup[] = [
  { id: 'overview', segment: '', labelKey: 'adminNav.groups.overview' },
  { id: 'library', segment: 'library', labelKey: 'adminNav.groups.library' },
  { id: 'integrations', segment: 'integrations', labelKey: 'adminNav.groups.integrations' },
  { id: 'ai', segment: 'ai', labelKey: 'adminNav.groups.ai' },
  { id: 'recommendations', segment: 'recommendations', labelKey: 'adminNav.groups.recommendations' },
  { id: 'appearance', segment: 'appearance', labelKey: 'adminNav.groups.appearance' },
  { id: 'access', segment: 'access', labelKey: 'adminNav.groups.access' },
  { id: 'ops', segment: 'ops', labelKey: 'adminNav.groups.ops' },
]

/**
 * A precondition the console can check before offering a destination. Genre
 * strips are meaningless without TMDB, which the old page expressed as a
 * `disabled` prop on one `<Tab>` plus a redirect effect; here it is a property
 * of the entry, so the nav, the search index and the route all agree.
 */
export type AdminGate = 'tmdbConfigured'

/**
 * A control worth reaching by name. Optional and deliberately partial: every
 * entry is searchable by its own title for free, and fields are added for the
 * ~40 controls of 127 that people actually hunt for. `anchor` is the DOM id the
 * section must carry, and search navigates to `path#anchor`.
 */
export interface AdminField {
  anchor: string
  labelKey: string
  /** Untranslated technical terms, same rationale as `AdminEntry.aliases`. */
  aliases?: readonly string[]
}

export interface AdminEntry {
  /** Stable, unique, and the last segment of the URL. */
  id: string
  group: AdminGroupId
  /**
   * Path segment under the group. Empty only for the overview index.
   * Kept separate from `id` so an id can be renamed without breaking a
   * bookmark, and so a URL can read better than a variable name.
   */
  segment: string
  titleKey: string
  blurbKey: string
  /**
   * Search aliases, written here rather than in `translation.json` on purpose.
   * These are technical identifiers ("omdb", "pgvector", "cron"), not UI copy —
   * keeping them out of i18n means they cannot be translated away, so they keep
   * working for an operator running the console in any of the 15 locales.
   */
  aliases: readonly string[]
  gate?: AdminGate
  fields?: readonly AdminField[]
  /**
   * True for the five destinations that were full pages before they were leaves
   * and already announce themselves to the app bar. The shell publishes a title
   * for everything else — the 36 section components are cards, not pages, and
   * none of them has ever had a heading of its own.
   *
   * The flag exists so there is exactly one publisher per route. Two would not
   * error; they would race, and the loser is decided by effect ordering rather
   * than by anything a reader of either file could see.
   */
  ownsHeading?: boolean
}

export const ADMIN_ENTRIES: readonly AdminEntry[] = [
  // ---------------------------------------------------------------- overview
  {
    id: 'overview',
    group: 'overview',
    segment: '',
    titleKey: 'adminNav.overview.title',
    blurbKey: 'adminNav.overview.blurb',
    aliases: ['dashboard', 'home', 'status', 'health'],
    ownsHeading: true,
  },

  // ----------------------------------------------------------------- library
  {
    id: 'media-server',
    group: 'library',
    segment: 'server',
    titleKey: 'adminNav.mediaServer.title',
    blurbKey: 'adminNav.mediaServer.blurb',
    aliases: ['emby', 'jellyfin', 'media server', 'url', 'connection', 'api key'],
  },
  {
    id: 'libraries',
    group: 'library',
    segment: 'libraries',
    titleKey: 'adminNav.libraries.title',
    blurbKey: 'adminNav.libraries.blurb',
    aliases: ['libraries', 'collections', 'sync', 'enabled', 'excluded'],
  },
  {
    id: 'file-locations',
    group: 'library',
    segment: 'paths',
    titleKey: 'adminNav.fileLocations.title',
    blurbKey: 'adminNav.fileLocations.blurb',
    aliases: ['paths', 'strm', 'output', 'directory', 'folder', 'mount'],
  },
  {
    id: 'gap-analysis',
    group: 'library',
    segment: 'gaps',
    titleKey: 'adminNav.gapAnalysis.title',
    blurbKey: 'adminNav.gapAnalysis.blurb',
    aliases: ['gaps', 'missing', 'collections', 'franchise', 'tmdb collection'],
    ownsHeading: true,
  },

  // ------------------------------------------------------------ integrations
  {
    id: 'tmdb',
    group: 'integrations',
    segment: 'tmdb',
    titleKey: 'adminNav.tmdb.title',
    blurbKey: 'adminNav.tmdb.blurb',
    aliases: ['tmdb', 'themoviedb', 'api key', 'metadata', 'posters'],
    fields: [
      { anchor: 'tmdb-api-key', labelKey: 'settingsTmdb.apiKey', aliases: ['tmdb key'] },
      { anchor: 'tmdb-enabled', labelKey: 'settingsTmdb.enableEnrichment' },
    ],
  },
  {
    id: 'omdb',
    group: 'integrations',
    segment: 'omdb',
    titleKey: 'adminNav.omdb.title',
    blurbKey: 'adminNav.omdb.blurb',
    aliases: ['omdb', 'imdb', 'api key', 'plot', 'awards', 'rotten tomatoes'],
    fields: [
      { anchor: 'omdb-api-key', labelKey: 'settingsOmdb.apiKey', aliases: ['omdb key'] },
      { anchor: 'omdb-enabled', labelKey: 'settingsOmdb.enableEnrichment' },
      { anchor: 'omdb-paid-tier', labelKey: 'settingsOmdb.paidTitle', aliases: ['patron', 'rate limit', 'quota'] },
    ],
  },
  {
    id: 'mdblist',
    group: 'integrations',
    segment: 'mdblist',
    titleKey: 'adminNav.mdblist.title',
    blurbKey: 'adminNav.mdblist.blurb',
    aliases: ['mdblist', 'lists', 'api key', 'ratings'],
    fields: [
      { anchor: 'mdblist-api-key', labelKey: 'settingsMdblist.apiKey' },
      { anchor: 'mdblist-enabled', labelKey: 'settingsMdblist.enableIntegration' },
      { anchor: 'mdblist-supporter', labelKey: 'settingsMdblist.supporterTitle', aliases: ['supporter', 'tier'] },
    ],
  },
  {
    id: 'trakt',
    group: 'integrations',
    segment: 'trakt',
    titleKey: 'adminNav.trakt.title',
    blurbKey: 'adminNav.trakt.blurb',
    aliases: ['trakt', 'scrobble', 'ratings sync', 'oauth', 'client id'],
    fields: [
      { anchor: 'trakt-client-id', labelKey: 'settingsTrakt.clientId' },
      { anchor: 'trakt-client-secret', labelKey: 'settingsTrakt.clientSecret' },
      { anchor: 'trakt-redirect-uri', labelKey: 'settingsTrakt.redirectUri', aliases: ['callback', 'oauth'] },
    ],
  },
  {
    id: 'seerr',
    group: 'integrations',
    segment: 'seerr',
    titleKey: 'adminNav.seerr.title',
    blurbKey: 'adminNav.seerr.blurb',
    aliases: ['seerr', 'jellyseerr', 'overseerr', 'requests', 'api key'],
    fields: [
      { anchor: 'seerr-url', labelKey: 'settingsSeerr.seerrUrl', aliases: ['url', 'host'] },
      { anchor: 'seerr-api-key', labelKey: 'settingsSeerr.apiKey' },
    ],
  },
  {
    id: 'lldap',
    group: 'integrations',
    segment: 'lldap',
    titleKey: 'adminNav.lldap.title',
    blurbKey: 'adminNav.lldap.blurb',
    aliases: ['lldap', 'ldap', 'email', 'import', 'directory'],
  },
  {
    id: 'n8n',
    group: 'integrations',
    segment: 'n8n',
    titleKey: 'adminNav.n8n.title',
    blurbKey: 'adminNav.n8n.blurb',
    aliases: ['n8n', 'webhook', 'automation', 'workflow'],
  },
  {
    id: 'tavily',
    group: 'integrations',
    segment: 'tavily',
    titleKey: 'adminNav.tavily.title',
    blurbKey: 'adminNav.tavily.blurb',
    aliases: ['tavily', 'web search', 'grounding', 'api key'],
    fields: [
      { anchor: 'tavily-api-key', labelKey: 'settingsTavily.apiKey' },
      { anchor: 'tavily-max-results', labelKey: 'settingsTavily.maxResults' },
      { anchor: 'tavily-max-content', labelKey: 'settingsTavily.maxContentChars', aliases: ['budget', 'chars'] },
      { anchor: 'tavily-search-depth', labelKey: 'settingsTavily.searchDepth' },
    ],
  },
  {
    id: 'crw',
    group: 'integrations',
    segment: 'crw',
    titleKey: 'adminNav.crw.title',
    blurbKey: 'adminNav.crw.blurb',
    aliases: ['crw', 'fastcrw', 'scrape', 'retrieval', 'search engines', 'title analysis'],
    fields: [
      { anchor: 'crw-enabled', labelKey: 'settingsCrw.enabledLabel' },
      { anchor: 'crw-base-url', labelKey: 'settingsCrw.baseUrlLabel', aliases: ['url', 'host'] },
      { anchor: 'crw-api-key', labelKey: 'settingsCrw.apiKeyLabel' },
      { anchor: 'crw-source-budget', labelKey: 'settingsCrw.sourceBudgetLabel', aliases: ['sources', 'floor'] },
      { anchor: 'crw-analysis-output', labelKey: 'settingsCrw.analysisOutputLabel', aliases: ['max tokens', 'output tokens'] },
    ],
  },
  {
    id: 'streaming',
    group: 'integrations',
    segment: 'streaming',
    titleKey: 'adminNav.streaming.title',
    blurbKey: 'adminNav.streaming.blurb',
    aliases: ['justwatch', 'streaming', 'providers', 'region', 'charts'],
  },
  {
    id: 'ratings-refresh',
    group: 'integrations',
    segment: 'ratings',
    titleKey: 'adminNav.ratingsRefresh.title',
    blurbKey: 'adminNav.ratingsRefresh.blurb',
    aliases: ['ratings', 'imdb dataset', 'refresh', 'vote count', 'tsv'],
  },

  // ---------------------------------------------------------------- ai models
  {
    id: 'ai-roles',
    group: 'ai',
    segment: 'roles',
    titleKey: 'adminNav.aiRoles.title',
    blurbKey: 'adminNav.aiRoles.blurb',
    aliases: [
      'openrouter',
      'gemini',
      'google',
      'groq',
      'ollama',
      'model',
      'provider',
      'api key',
      'free tier',
      'fallback',
      'embeddings model',
      'chat',
      // The retrieval-mode control lives on the embeddings role's card here,
      // not on the Embeddings section — searching for it reached fastCRW.
      'retrieval mode',
      'input type',
      'semantic similarity',
      'task type',
    ],
  },
  {
    id: 'ai-spend',
    group: 'ai',
    segment: 'spend',
    titleKey: 'adminNav.aiSpend.title',
    blurbKey: 'adminNav.aiSpend.blurb',
    aliases: ['spend', 'cost', 'usage', 'tokens', 'openrouter', 'inference'],
  },
  {
    id: 'ai-estimate',
    group: 'ai',
    segment: 'estimate',
    titleKey: 'adminNav.aiEstimate.title',
    blurbKey: 'adminNav.aiEstimate.blurb',
    aliases: ['estimate', 'projection', 'pricing', 'budget'],
  },
  {
    id: 'embeddings',
    group: 'ai',
    segment: 'embeddings',
    titleKey: 'adminNav.embeddings.title',
    blurbKey: 'adminNav.embeddings.blurb',
    aliases: ['embeddings', 'pgvector', 'dimensions', 'vectors', 'centering', 'sets'],
  },

  // --------------------------------------------------------- recommendations
  {
    id: 'algorithm',
    group: 'recommendations',
    segment: 'algorithm',
    titleKey: 'adminNav.algorithm.title',
    blurbKey: 'adminNav.algorithm.blurb',
    aliases: [
      'weights',
      'similarity',
      'novelty',
      'rating',
      'diversity',
      'twin',
      'interest',
      'acclaimed',
      'slots',
      'max candidates',
      'selected count',
      'preference strength',
    ],
    fields: [
      { anchor: 'rec-movie-max-candidates', labelKey: 'settingsRecAlgo.maxCandidatesLabel', aliases: ['pool', 'ann', 'retrieval'] },
      { anchor: 'rec-movie-similarity-weight', labelKey: 'settingsRecAlgo.weightSimilarity', aliases: ['taste match'] },
      { anchor: 'rec-movie-novelty-weight', labelKey: 'settingsRecAlgo.weightDiscovery', aliases: ['novelty', 'discovery'] },
      { anchor: 'rec-movie-rating-weight', labelKey: 'settingsRecAlgo.weightRating', aliases: ['quality', 'imdb'] },
      { anchor: 'rec-movie-diversity-weight', labelKey: 'settingsRecAlgo.weightDiversity', aliases: ['variety', 'mmr'] },
      { anchor: 'rec-movie-interest-slots', labelKey: 'settingsRecAlgo.interestMaxSlots', aliases: ['reserved slots'] },
      { anchor: 'rec-movie-twin-slots', labelKey: 'settingsRecAlgo.twinMaxSlots', aliases: ['taste twin'] },
      { anchor: 'rec-movie-acclaimed-slots', labelKey: 'settingsRecAlgo.acclaimedMaxSlots', aliases: ['acclaimed'] },
      { anchor: 'rec-movie-preference-strength', labelKey: 'settingsRecAlgo.preferenceStrength', aliases: ['nudge', 'boost'] },
      { anchor: 'rec-movie-twin-threshold', labelKey: 'settingsRecAlgo.twinThresholdK', aliases: ['mad', 'threshold'] },
    ],
  },
  {
    id: 'evaluation',
    group: 'recommendations',
    segment: 'evaluation',
    titleKey: 'adminNav.evaluation.title',
    blurbKey: 'adminNav.evaluation.blurb',
    aliases: ['evaluation', 'evaluate', 'benchmark', 'seeds', 'neighbours', 'neighbors', 'ndcg', 'holdout', 'ab test'],
    fields: [
      {
        anchor: 'evaluation-seed-titles',
        labelKey: 'settingsEvaluation.seedsLabel',
        aliases: ['seed titles', 'neighbour dump', 'sample titles'],
      },
    ],
  },
  {
    id: 'explanations',
    group: 'recommendations',
    segment: 'explanations',
    titleKey: 'adminNav.explanations.title',
    blurbKey: 'adminNav.explanations.blurb',
    aliases: ['explanation', 'why', 'ai text', 'reasons'],
  },
  {
    id: 'output-format',
    group: 'recommendations',
    segment: 'output',
    titleKey: 'adminNav.outputFormat.title',
    blurbKey: 'adminNav.outputFormat.blurb',
    aliases: ['strm', 'nfo', 'output', 'format', 'poster overlay'],
  },
  {
    id: 'library-naming',
    group: 'recommendations',
    segment: 'naming',
    titleKey: 'adminNav.libraryNaming.title',
    blurbKey: 'adminNav.libraryNaming.blurb',
    aliases: ['naming', 'prefix', 'library name', 'ai picks'],
  },
  {
    id: 'top-picks',
    group: 'recommendations',
    segment: 'top-picks',
    titleKey: 'adminNav.topPicks.title',
    blurbKey: 'adminNav.topPicks.blurb',
    aliases: ['top picks', 'trending', 'auto request', 'mdblist'],
  },
  {
    id: 'watching',
    group: 'recommendations',
    segment: 'watching',
    titleKey: 'adminNav.watching.title',
    blurbKey: 'adminNav.watching.blurb',
    aliases: ['watching', 'shows you watch', 'upcoming episodes', 'continue'],
  },
  {
    id: 'discovery-tuning',
    group: 'recommendations',
    segment: 'discovery',
    titleKey: 'adminNav.discoveryTuning.title',
    blurbKey: 'adminNav.discoveryTuning.blurb',
    aliases: ['discovery', 'discover', 'seerr', 'candidates', 'pool', 'trakt', 'tmdb', 'tuning'],
    gate: 'tmdbConfigured',
    fields: [
      {
        anchor: 'discovery-max-per-source',
        labelKey: 'settingsDiscovery.maxCandidatesPerSource',
        aliases: ['pages', 'fetch', 'source'],
      },
      {
        anchor: 'discovery-max-enriched',
        labelKey: 'settingsDiscovery.maxEnrichedCandidates',
        aliases: ['enrich', 'cast', 'credits', 'api calls'],
      },
      {
        anchor: 'discovery-max-pool',
        labelKey: 'settingsDiscovery.maxPoolCandidates',
        aliases: ['pool', 'shared', 'ceiling'],
      },
      {
        anchor: 'discovery-pool-age',
        labelKey: 'settingsDiscovery.poolMaxAgeDays',
        aliases: ['prune', 'stale', 'age'],
      },
      {
        anchor: 'discovery-min-vote-count',
        labelKey: 'settingsDiscovery.minVoteCount',
        aliases: ['votes', 'quality', 'floor'],
      },
      {
        anchor: 'discovery-weight-popularity',
        labelKey: 'settingsDiscovery.popularityWeight',
        aliases: ['weight', 'popularity', 'ranking'],
      },
      {
        anchor: 'discovery-weight-measured',
        labelKey: 'settingsDiscovery.measuredTitle',
        aliases: ['measured', 'influence', 'realised', 'realized', 'spread', 'shares'],
      },
    ],
  },
  {
    id: 'genre-strips',
    group: 'recommendations',
    segment: 'genre-strips',
    titleKey: 'adminNav.genreStrips.title',
    blurbKey: 'adminNav.genreStrips.blurb',
    aliases: ['genre', 'strips', 'discover', 'rows', 'tmdb'],
    gate: 'tmdbConfigured',
  },
  {
    id: 'channels-web-expand',
    group: 'recommendations',
    segment: 'channels',
    titleKey: 'adminNav.channelsWebExpand.title',
    blurbKey: 'adminNav.channelsWebExpand.blurb',
    aliases: ['channels', 'playlists', 'web expansion', 'collections'],
  },

  // -------------------------------------------------------------- appearance
  {
    id: 'branding',
    group: 'appearance',
    segment: 'branding',
    titleKey: 'adminNav.branding.title',
    blurbKey: 'adminNav.branding.blurb',
    aliases: ['name', 'logo', 'brand', 'instance name', 'title', 'rename'],
    fields: [
      { anchor: 'branding-name', labelKey: 'settingsBranding.label', aliases: ['app name', 'rename'] },
    ],
  },
  {
    id: 'theme-colors',
    group: 'appearance',
    segment: 'colors',
    titleKey: 'adminNav.themeColors.title',
    blurbKey: 'adminNav.themeColors.blurb',
    aliases: ['colour', 'color', 'theme', 'primary', 'secondary', 'accent'],
  },
  {
    id: 'poster-display',
    group: 'appearance',
    segment: 'posters',
    titleKey: 'adminNav.posterDisplay.title',
    blurbKey: 'adminNav.posterDisplay.blurb',
    aliases: ['poster', 'badge', 'rating badge', 'artwork'],
  },
  {
    id: 'language-defaults',
    group: 'appearance',
    segment: 'language',
    titleKey: 'adminNav.languageDefaults.title',
    blurbKey: 'adminNav.languageDefaults.blurb',
    aliases: ['language', 'locale', 'ui language', 'default'],
  },
  {
    id: 'translations',
    group: 'appearance',
    segment: 'translations',
    titleKey: 'adminNav.translations.title',
    blurbKey: 'adminNav.translations.blurb',
    aliases: ['translation', 'i18n', 'strings', 'override', 'locale'],
    ownsHeading: true,
  },

  // ------------------------------------------------------------------ access
  {
    id: 'users',
    group: 'access',
    segment: 'users',
    titleKey: 'adminNav.users.title',
    blurbKey: 'adminNav.users.blurb',
    aliases: ['users', 'accounts', 'admin', 'enable', 'disable', 'permissions'],
    ownsHeading: true,
  },
  {
    id: 'api-keys',
    group: 'access',
    segment: 'api-keys',
    titleKey: 'adminNav.apiKeys.title',
    blurbKey: 'adminNav.apiKeys.blurb',
    aliases: ['api key', 'token', 'x-api-key', 'integration key'],
  },
  {
    id: 'deployment',
    group: 'access',
    segment: 'deployment',
    titleKey: 'adminNav.deployment.title',
    blurbKey: 'adminNav.deployment.blurb',
    aliases: [
      'proxy',
      'trusted proxies',
      'reverse proxy',
      'cloudflare',
      'tunnel',
      'cookie',
      'https',
      'passwordless',
      'security',
    ],
  },

  // -------------------------------------------------------------- operations
  {
    id: 'jobs',
    group: 'ops',
    segment: 'jobs',
    titleKey: 'adminNav.jobs.title',
    blurbKey: 'adminNav.jobs.blurb',
    aliases: ['jobs', 'schedule', 'cron', 'sync', 'run', 'enrichment', 'background'],
    ownsHeading: true,
  },
  {
    id: 'backup',
    group: 'ops',
    segment: 'backup',
    titleKey: 'adminNav.backup.title',
    blurbKey: 'adminNav.backup.blurb',
    aliases: ['backup', 'restore', 'dump', 'pg_dump', 'snapshot'],
  },
  {
    id: 'poster-repair',
    group: 'ops',
    segment: 'poster-repair',
    titleKey: 'adminNav.posterRepair.title',
    blurbKey: 'adminNav.posterRepair.blurb',
    aliases: ['poster', 'repair', 'broken images', 'artwork', 'maintenance'],
  },
  {
    id: 'logs',
    group: 'ops',
    segment: 'logs',
    titleKey: 'adminNav.logs.title',
    blurbKey: 'adminNav.logs.blurb',
    aliases: ['logs', 'logging', 'verbosity', 'debug', 'level'],
  },
  {
    id: 'database',
    group: 'ops',
    segment: 'database',
    titleKey: 'adminNav.database.title',
    blurbKey: 'adminNav.database.blurb',
    aliases: ['database', 'purge', 'wipe', 'danger', 'reset', 'postgres'],
  },
]

export type AdminEntryId = (typeof ADMIN_ENTRIES)[number]['id']

const GROUP_BY_ID = new Map<AdminGroupId, AdminGroup>(ADMIN_GROUPS.map((g) => [g.id, g]))

/** The full address of an entry, e.g. `/admin/integrations/omdb`. */
export function adminEntryPath(entry: AdminEntry): string {
  const group = GROUP_BY_ID.get(entry.group)
  const segments = [group?.segment, entry.segment].filter(Boolean)
  return segments.length ? `/admin/${segments.join('/')}` : '/admin'
}

/**
 * The console address of an entry, by id, for the handful of links that come
 * from outside the console and would otherwise hardcode a path the registry is
 * free to change. Falls back to the console root rather than throwing — a
 * broken link is a worse answer than a general one.
 */
export function adminPathFor(id: string): string {
  const entry = ADMIN_ENTRIES.find((e) => e.id === id)
  return entry ? adminEntryPath(entry) : '/admin'
}

/**
 * The same address relative to the `/admin` route, which is what `<Route path>`
 * takes. An empty string marks the index route.
 */
export function adminEntryRoutePath(entry: AdminEntry): string {
  return adminEntryPath(entry).replace(/^\/admin\/?/, '')
}

export function adminEntriesInGroup(group: AdminGroupId): AdminEntry[] {
  return ADMIN_ENTRIES.filter((e) => e.group === group)
}

/**
 * Which entry a path is showing. Longest match wins so that a detail route
 * (`/admin/access/users/42`) still highlights its parent entry rather than
 * falling through to the overview.
 */
export function adminEntryForPath(pathname: string): AdminEntry | undefined {
  let best: AdminEntry | undefined
  let bestLength = -1
  for (const entry of ADMIN_ENTRIES) {
    const path = adminEntryPath(entry)
    const matches = pathname === path || pathname.startsWith(`${path}/`)
    if (matches && path.length > bestLength) {
      best = entry
      bestLength = path.length
    }
  }
  return best
}
