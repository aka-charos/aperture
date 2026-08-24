/**
 * Job Definitions
 * Central registry of all background jobs
 */

import type { JobDefinition } from './types.js'

export const jobDefinitions: JobDefinition[] = [
  // === User Sync Job ===
  {
    name: 'sync-users',
    description: 'Sync users from media server (imports new users, updates email/admin status)',
    cron: '*/30 * * * *', // Every 30 minutes
  },
  // === Movie Jobs ===
  {
    name: 'sync-movies',
    description: 'Sync movies from media server',
    cron: process.env.SYNC_CRON || '0 3 * * *',
  },
  {
    name: 'generate-movie-embeddings',
    description: 'Generate AI embeddings for movies',
    cron: null,
  },
  {
    name: 'sync-movie-watch-history',
    description: 'Sync watched movies from media server for all users',
    cron: process.env.SYNC_CRON || '0 3 * * *',
  },
  {
    name: 'generate-movie-recommendations',
    description: 'Generate AI movie recommendations for users',
    cron: process.env.RECS_CRON || '0 4 * * *',
  },
  {
    name: 'full-reset-movie-recommendations',
    description: 'Deletes ALL movie recommendations, then rebuilds from scratch. Use after major algorithm or embedding model changes.',
    cron: null,
    manualOnly: true,
  },
  {
    name: 'sync-movie-libraries',
    description: 'Build Aperture movie libraries with AI recommendations (STRM or symlinks)',
    cron: process.env.PERMS_CRON || '0 5 * * *',
  },
  // === Series Jobs ===
  {
    name: 'sync-series',
    description: 'Sync TV series and episodes from media server',
    cron: process.env.SYNC_CRON || '0 3 * * *',
  },
  {
    name: 'generate-series-embeddings',
    description: 'Generate AI embeddings for TV series and episodes',
    cron: null,
  },
  {
    name: 'sync-series-watch-history',
    description: 'Sync watched episodes from media server for all users',
    cron: process.env.SYNC_CRON || '0 3 * * *',
  },
  {
    name: 'generate-series-recommendations',
    description: 'Generate AI TV series recommendations for users',
    cron: process.env.RECS_CRON || '0 4 * * *',
  },
  {
    name: 'full-reset-series-recommendations',
    description: 'Deletes ALL series recommendations, then rebuilds from scratch. Use after major algorithm or embedding model changes.',
    cron: null,
    manualOnly: true,
  },
  {
    name: 'sync-series-libraries',
    description: 'Build Aperture series libraries with AI recommendations (STRM or symlinks)',
    cron: process.env.PERMS_CRON || '0 5 * * *',
  },
  // === Explanations only (both media types) ===
  {
    name: 'refresh-recommendation-explanations',
    description:
      "Rewrites the AI explanation on everyone's current recommendations without re-scoring anything. Use after changing the Text Generation model, or to repair explanations that fell back to generic text.",
    cron: null,
    manualOnly: true,
  },
  // === Title analysis (per title, from retrieved sources, shared by all users) ===
  {
    name: 'generate-title-analysis',
    description:
      'Writes a critic-informed analysis for titles that have none, current recommendations first. Each title costs a web search, a few page fetches and one model call — all self-hosted, so there is no quota, only time. Needs the retrieval service configured in Settings > Integrations and the Title Analysis role in Settings > AI.',
    cron: null,
    manualOnly: true,
  },
  // === Evaluation (both media types) ===
  {
    name: 'evaluate-recommender',
    description:
      "Measures the retrieval half of the recommender against a held-out slice of each viewer's history, and prints what a handful of well-known titles are actually nearest to, raw and mean-centred. Reads only; changes nothing. The neighbour dump is the part to judge a change on -- the numbers are a floor check against a random and a rating-only baseline, and tuning anything to maximise them would make the recommender worse.",
    cron: null,
    manualOnly: true,
  },
  // === Embedding centering (both media types) ===
  {
    name: 'refresh-embedding-centering',
    description:
      "Recomputes the library mean and rewrites every title's mean-centred vector. Subtracting the mean removes the direction every canonical text shares (they all describe a film, in one template), which on the measured library lifts ndcg@100 from 20.5% to 31.9%. Reads nothing users see and changes no recommendation on its own -- a profile keeps whatever space it was built in until rebuild-taste-profiles is run, which is what makes this safe to run at any time. Run it after any re-embed.",
    cron: null,
    manualOnly: true,
  },
  // === Taste Profiles (both media types) ===
  {
    name: 'rebuild-taste-profiles',
    description:
      "Rebuilds every user's taste profile, clusters and detected preferences from their current watch history. Use after changes to how taste is calculated — profiles otherwise only refresh when they age past their own interval.",
    cron: null,
    manualOnly: true,
  },
  // === Top Picks Jobs ===
  {
    name: 'refresh-top-picks',
    description: 'Refresh global Top Picks libraries based on popularity',
    cron: '0 6 * * *',
  },
  {
    name: 'auto-request-top-picks',
    description: 'Automatically request missing Top Picks content via Seerr',
    cron: '0 0 * * 0', // Weekly on Sunday at midnight (configurable via settings)
  },
  // === Trakt Sync Job ===
  {
    name: 'sync-trakt-ratings',
    description: 'Sync ratings from Trakt for all connected users',
    cron: '0 */6 * * *', // Every 6 hours
  },
  // === LLDAP Email Sync Job ===
  {
    name: 'sync-lldap-emails',
    description: 'Import user emails from LLDAP by matching usernames (optional, admin-configured)',
    cron: '15 3 * * *', // Daily at 3:15 AM
  },
  // === Shows You Watch (favorites sync) ===
  {
    name: 'sync-watching-favorites',
    description:
      'Reconcile Shows You Watch with media server series favorites (Emby/Jellyfin) for all users',
    cron: '0 */4 * * *', // Every 4 hours (stagger from STRM job in Admin → Jobs)
  },
  // === Assistant Suggestions Job ===
  {
    name: 'refresh-assistant-suggestions',
    description: 'Refresh personalized assistant suggestions for all users',
    // Weekly, Sunday midnight — must match ENV_DEFAULTS in @aperture/core
    // jobConfig.ts, which is what the runtime scheduler actually uses.
    cron: '0 0 * * 0',
  },
  // === Metadata Enrichment Job ===
  {
    name: 'enrich-metadata',
    description:
      'Enrich with TMDb (keywords, collections, crew) and OMDb (RT/Metacritic scores, awards, languages, countries)',
    cron: null, // Manual by default
  },
  // === Studio Logo Enrichment Job ===
  {
    name: 'enrich-studio-logos',
    description: 'Fetch studio and network logos from TMDB',
    cron: '0 5 * * *', // Daily at 5 AM
  },
  // === Ratings Refresh Job ===
  // Deliberately NOT part of enrich-metadata. Enrichment selects a row that has
  // never been enriched or whose schema version is behind, with no TTL at all,
  // which is correct for a plot or a cast list and wrong for a number that moves
  // every week. Measured live, that froze one film's IMDb vote count 28% below
  // the truth, and the error is biased: a new release's rating decays from an
  // enthusiastic start, so stale copies systematically overrate recent films.
  //
  // Every source inside it is opt-in, so a scheduled run on an instance that has
  // enabled none does nothing and says so, rather than failing.
  {
    name: 'refresh-ratings',
    description:
      'Refresh ratings that change over time, from sources that publish current numbers. IMDb ships its own daily dataset — one 8 MB download covers the whole library with no API key and no quota. Sources are opt-in in Settings > Integrations > Ratings Refresh.',
    cron: '30 2 * * *', // Daily, ahead of the recommendation run
  },
  // === MDBList Enrichment Job ===
  {
    name: 'enrich-mdblist',
    description:
      'Enrich with MDBList (Letterboxd scores, MDBList scores, streaming providers, keywords)',
    cron: '0 7 * * *', // Daily at 7 AM
  },
  // === Database Backup Job ===
  {
    name: 'backup-database',
    description: 'Create a full database backup',
    cron: '0 2 * * *', // Daily at 2 AM
  },
  // === Auth Cleanup Job ===
  {
    name: 'cleanup-auth-state',
    description: 'Delete expired/idle sessions and stale failed-login counters',
    cron: '30 3 * * *', // Daily at 3:30 AM
  },
  // === AI Pricing Cache Job ===
  {
    name: 'refresh-ai-pricing',
    description: 'Refresh LLM pricing data from Helicone API',
    cron: '0 0 * * 0', // Weekly on Sunday at midnight
  },
  // === Discovery Suggestions Job ===
  {
    name: 'generate-discovery-suggestions',
    description: 'Generate AI-powered suggestions for content not in your library',
    cron: '0 6 * * *', // Daily at 6 AM
  },
  // === Library gap analysis (TMDB collections vs movies table) ===
  {
    name: 'refresh-library-gaps',
    description:
      'Compare TMDB movie collections to your library and store missing titles (does not request via Seerr)',
    cron: null,
  },
]
