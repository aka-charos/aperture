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
