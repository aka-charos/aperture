import type { FastifyPluginAsync } from 'fastify'
import healthRoutes from './health/index.js'
import setupRoutes from './setup/index.js'
import apiRoutes from './api.js'
import authRoutes from './auth/index.js'
import usersRoutes from './users/index.js'
import moviesRoutes from './movies/index.js'
import seriesRoutes from './series/index.js'
import ratingsRoutes from './ratings/index.js'
import recommendationsRoutes from './recommendations/index.js'
import channelsRoutes from './channels/index.js'
import jobsRoutes from './jobs/index.js'
import settingsRoutes from './settings/index.js'
import topPicksRoutes from './top-picks/index.js'
import traktRoutes from './trakt/index.js'
import mdblistRoutes from './mdblist/index.js'
import dashboardRoutes from './dashboard/index.js'
import imageRoutes from './images/index.js'
import mediaProxyRoutes from './media-proxy/index.js'
import assistantRoutes from './assistant/index.js'
import searchRoutes from './search/index.js'
import discoverRoutes from './discover/index.js'
import watchingRoutes from './watching/index.js'
import backupRoutes from './backup/index.js'
import maintenanceRoutes from './maintenance/index.js'
import apiErrorsRoutes from './apiErrors/index.js'
import similarityRoutes from './similarity/index.js'
import graphPlaylistRoutes from './graphPlaylists/index.js'
import favoritesRoutes from './favorites/index.js'
import discoveryRoutes from './discovery/index.js'
import seerrRoutes from './seerr/index.js'
import issueRoutes from './issues/index.js'
import gapAnalysisRoutes from './gap-analysis/index.js'
import apiKeysRoutes from './apiKeys/index.js'
import logoRoutes from './logo/index.js'
import i18nRoutes from './i18n/index.js'
import brandingRoutes from './branding/index.js'
import inferenceRoutes from './inference/index.js'
import analysisRoutes from './analysis/index.js'

const routes: FastifyPluginAsync = async (fastify) => {
  // Register health check routes
  await fastify.register(healthRoutes)

  // Register setup routes (public - for first-run wizard)
  await fastify.register(setupRoutes)

  // Register API routes
  await fastify.register(apiRoutes)

  // Register auth routes
  await fastify.register(authRoutes)

  // Register users routes
  await fastify.register(usersRoutes)

  // Register movies routes
  await fastify.register(moviesRoutes)

  // Register series routes
  await fastify.register(seriesRoutes)

  // Register ratings routes
  await fastify.register(ratingsRoutes)

  // Register recommendations routes
  await fastify.register(recommendationsRoutes)

  // Register channels routes
  await fastify.register(channelsRoutes)

  // Register jobs routes
  await fastify.register(jobsRoutes)

  // Register settings routes
  await fastify.register(settingsRoutes)

  // Register top picks routes
  await fastify.register(topPicksRoutes)

  // Register Trakt routes
  await fastify.register(traktRoutes)

  // Register MDBList routes
  await fastify.register(mdblistRoutes)

  // Register dashboard routes
  await fastify.register(dashboardRoutes)

  // Register image routes
  await fastify.register(imageRoutes)

  // Register media proxy routes (for proxying Emby/Jellyfin images)
  await fastify.register(mediaProxyRoutes)

  // Register assistant routes
  await fastify.register(assistantRoutes)

  // Register search routes
  await fastify.register(searchRoutes)

  // Register discover routes (person/studio browsing)
  await fastify.register(discoverRoutes)

  // Register watching routes
  await fastify.register(watchingRoutes)

  // Register backup routes
  await fastify.register(backupRoutes)

  // Register maintenance routes
  await fastify.register(maintenanceRoutes)

  // Register API errors routes
  await fastify.register(apiErrorsRoutes)

  // Register similarity routes (for explore/similar features)
  await fastify.register(similarityRoutes)

  // Register graph playlist routes
  await fastify.register(graphPlaylistRoutes)

  // Register favorites routes (mark suggestions as media-server favorites)
  await fastify.register(favoritesRoutes)

  // Register discovery routes (missing content suggestions)
  await fastify.register(discoveryRoutes)

  // Register Seerr routes (content requests)
  await fastify.register(seerrRoutes)

  // Issue reporting (problems with a title, proxied to Seerr)
  await fastify.register(issueRoutes)

  // Admin Gap Analysis (movie collection completeness)
  await fastify.register(gapAnalysisRoutes)

  // Register API keys routes
  await fastify.register(apiKeysRoutes)

  // Register logo route (for Swagger UI branding)
  await fastify.register(logoRoutes)

  // Register i18n routes (runtime UI string overrides from a mounted dir)
  await fastify.register(i18nRoutes)

  // Register branding routes (the instance's display name; GET is public
  // because the login page and setup wizard render it before any session)
  await fastify.register(brandingRoutes)

  // Register inference routes (AI spend ledger, admin dashboard)
  await fastify.register(inferenceRoutes)

  // Register title-analysis routes (grounded per-title critical analysis,
  // cached forever and shared by every user — see core/src/analysis)
  await fastify.register(analysisRoutes)
}

export default routes
