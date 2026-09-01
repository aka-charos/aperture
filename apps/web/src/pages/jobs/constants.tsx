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
import BiotechIcon from '@mui/icons-material/Biotech'
import { JOB_DISPLAY_NAME_KEYS, titleCaseJobName } from './registry'
import { getAppName } from '@/lib/branding'

// The catalogue itself is pure data and lives in ./registry, so the settings
// search can read it without pulling in these icons. Import it from there
// directly — re-exporting it through this module makes eslint's react-refresh
// rule treat every export here as a possible component, and the file lints
// clean only while it holds no pass-throughs.

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
  'evaluate-recommender': <BiotechIcon />,
  'refresh-embedding-centering': <PsychologyIcon />,
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
  'evaluate-recommender': '#14b8a6',
  'refresh-embedding-centering': '#a855f7',
  'refresh-recommendation-explanations': '#06b6d4',
  'generate-title-analysis': '#e91e63',
  'refresh-ratings': '#f97316',
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
  return titleCaseJobName(name)
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
