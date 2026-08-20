import React from 'react'
import type { TFunction } from 'i18next'
import MovieIcon from '@mui/icons-material/Movie'
import TvIcon from '@mui/icons-material/Tv'
import PsychologyIcon from '@mui/icons-material/Psychology'
import HistoryIcon from '@mui/icons-material/History'
import RecommendIcon from '@mui/icons-material/Recommend'
import FolderIcon from '@mui/icons-material/Folder'
import AutorenewIcon from '@mui/icons-material/Autorenew'
import TrendingUpIcon from '@mui/icons-material/TrendingUp'
import SyncIcon from '@mui/icons-material/Sync'
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh'
import FavoriteIcon from '@mui/icons-material/Favorite'
import BusinessIcon from '@mui/icons-material/Business'
import StreamIcon from '@mui/icons-material/Stream'
import AttachMoneyIcon from '@mui/icons-material/AttachMoney'
import ExploreIcon from '@mui/icons-material/Explore'
import SendIcon from '@mui/icons-material/Send'
import AlternateEmailIcon from '@mui/icons-material/AlternateEmail'
import FingerprintIcon from '@mui/icons-material/Fingerprint'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome'
import TheatersIcon from '@mui/icons-material/Theaters'
import StarHalfIcon from '@mui/icons-material/StarHalf'
import type { JobCategory } from './types'
import { getAppName } from '@/lib/branding'

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
    jobs: ['rebuild-taste-profiles'],
  },
  // Same reasoning: one pass covers both media types. Note this list is an
  // allowlist and the only thing that renders a job card — a job missing from
  // every category has no Run button and, more to the point, no Cancel button,
  // however correctly it is registered in the API.
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

export const JOB_ICONS: Record<string, React.ReactNode> = {
  'sync-movies': <MovieIcon />,
  'generate-movie-embeddings': <PsychologyIcon />,
  'sync-movie-watch-history': <HistoryIcon />,
  'generate-movie-recommendations': <RecommendIcon />,
  'full-reset-movie-recommendations': <AutorenewIcon />,
  'sync-movie-libraries': <FolderIcon />,
  'sync-series': <TvIcon />,
  'generate-series-embeddings': <PsychologyIcon />,
  'sync-series-watch-history': <HistoryIcon />,
  'generate-series-recommendations': <RecommendIcon />,
  'full-reset-series-recommendations': <AutorenewIcon />,
  'sync-series-libraries': <FolderIcon />,
  'enrich-metadata': <AutoFixHighIcon />,
  'enrich-studio-logos': <BusinessIcon />,
  'enrich-mdblist': <StreamIcon />,
  'refresh-top-picks': <TrendingUpIcon />,
  'auto-request-top-picks': <SendIcon />,
  'sync-watching-favorites': <FavoriteIcon />,
  'sync-trakt-ratings': <SyncIcon />,
  'refresh-ai-pricing': <AttachMoneyIcon />,
  'generate-discovery-suggestions': <ExploreIcon />,
  'sync-lldap-emails': <AlternateEmailIcon />,
  'rebuild-taste-profiles': <FingerprintIcon />,
  'refresh-recommendation-explanations': <AutoAwesomeIcon />,
  'generate-title-analysis': <TheatersIcon />,
  'refresh-ratings': <StarHalfIcon />,
}

export const JOB_COLORS: Record<string, string> = {
  'sync-movies': '#3b82f6',
  'generate-movie-embeddings': '#a855f7',
  'sync-movie-watch-history': '#f59e0b',
  'generate-movie-recommendations': '#22c55e',
  'full-reset-movie-recommendations': '#8b5cf6',
  'sync-movie-libraries': '#6366f1',
  'sync-series': '#0891b2',
  'generate-series-embeddings': '#c026d3',
  'sync-series-watch-history': '#ea580c',
  'generate-series-recommendations': '#16a34a',
  'full-reset-series-recommendations': '#7c3aed',
  'sync-series-libraries': '#4f46e5',
  'enrich-metadata': '#10b981',
  'enrich-studio-logos': '#14b8a6',
  'enrich-mdblist': '#6366f1',
  'refresh-top-picks': '#f59e0b',
  'auto-request-top-picks': '#f97316',
  'sync-watching-favorites': '#e11d48',
  'sync-trakt-ratings': '#ed1c24',
  'refresh-ai-pricing': '#22c55e',
  'generate-discovery-suggestions': '#ec4899',
  'sync-lldap-emails': '#0ea5e9',
  'rebuild-taste-profiles': '#a855f7',
  'refresh-recommendation-explanations': '#06b6d4',
  'generate-title-analysis': '#e91e63',
  'refresh-ratings': '#f97316',
}

const JOB_DISPLAY_NAME_KEYS: Record<string, string> = {
  'sync-movie-libraries': 'admin.jobsPage.jobNames.syncMovieLibraries',
  'sync-series-libraries': 'admin.jobsPage.jobNames.syncSeriesLibraries',
  'full-reset-movie-recommendations': 'admin.jobsPage.jobNames.fullResetMovieRecommendations',
  'full-reset-series-recommendations': 'admin.jobsPage.jobNames.fullResetSeriesRecommendations',
  // Auto title-casing turns "lldap" into "Lldap" — the acronym needs its own key.
  'sync-lldap-emails': 'admin.jobsPage.jobNames.syncLldapEmails',
}

// Only reached when a caller has no `t` to hand; the translated names above are
// the normal path. A function rather than a const because the brand is fetched
// after this module is imported — baked in at import time it would always read
// as the default, however the instance is named.
function legacyJobName(name: string): string | undefined {
  switch (name) {
    case 'sync-movie-libraries':
      return `Build ${getAppName()} Movie Libraries`
    case 'sync-series-libraries':
      return `Build ${getAppName()} Series Libraries`
    case 'full-reset-movie-recommendations':
      return 'Full Reset Movie Recommendations'
    case 'full-reset-series-recommendations':
      return 'Full Reset Series Recommendations'
    default:
      return undefined
  }
}

export function formatJobName(name: string, t?: TFunction): string {
  const key = JOB_DISPLAY_NAME_KEYS[name as keyof typeof JOB_DISPLAY_NAME_KEYS]
  if (t && key) return t(key)
  const legacy = legacyJobName(name)
  if (legacy) return legacy
  return name
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

export function formatRelativePastTime(dateString: string, t: TFunction): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffSec = Math.floor(diffMs / 1000)
  const diffMin = Math.floor(diffSec / 60)
  const diffHour = Math.floor(diffMin / 60)
  const diffDay = Math.floor(diffHour / 24)

  if (diffDay > 7) {
    return date.toLocaleDateString()
  }
  if (diffDay > 0) {
    return t('admin.jobsPage.ui.timeDaysAgo', { count: diffDay })
  }
  if (diffHour > 0) {
    return t('admin.jobsPage.ui.timeHoursAgo', { count: diffHour })
  }
  if (diffMin > 0) {
    return t('admin.jobsPage.ui.timeMinutesAgo', { count: diffMin })
  }
  return t('admin.jobsPage.ui.timeJustNow')
}

export function formatJobDurationMsOrDash(ms: number | null | undefined, t: TFunction): string {
  if (ms == null || ms <= 0) return t('admin.jobsPage.ui.dash')
  return formatJobDurationMs(ms, t)
}

export function formatJobDurationMs(ms: number, t: TFunction): string {
  if (ms < 1000) return t('admin.jobsPage.ui.durationMs', { ms })
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return t('admin.jobsPage.ui.durationSec', { sec })
  const min = Math.floor(sec / 60)
  const remainingSec = sec % 60
  if (min < 60) return t('admin.jobsPage.ui.durationMinSec', { min, sec: remainingSec })
  const hr = Math.floor(min / 60)
  const remainingMin = min % 60
  return t('admin.jobsPage.ui.durationHrMin', { hr, min: remainingMin })
}

export function formatCron(cron: string | null): string {
  if (!cron) return 'Manual only'
  const parts = cron.split(' ')
  if (parts.length >= 5) {
    const hour = parseInt(parts[1])
    const ampm = hour >= 12 ? 'PM' : 'AM'
    const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour
    return `Daily at ${displayHour}:00 ${ampm}`
  }
  return cron
}

export function getElapsedTime(startedAt: string, t: TFunction): string {
  const start = new Date(startedAt).getTime()
  const now = Date.now()
  const elapsed = Math.floor((now - start) / 1000)
  const minutes = Math.floor(elapsed / 60)
  const seconds = elapsed % 60
  return minutes > 0
    ? t('admin.jobsPage.ui.elapsedMinSec', { min: minutes, sec: seconds })
    : t('admin.jobsPage.ui.elapsedSec', { sec: seconds })
}
