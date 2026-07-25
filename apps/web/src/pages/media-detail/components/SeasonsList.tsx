import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Box, Typography, Card, CardContent, Avatar, Chip, Button, alpha } from '@mui/material'
import StarIcon from '@mui/icons-material/Star'
import TvIcon from '@mui/icons-material/Tv'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import CloudDownloadIcon from '@mui/icons-material/CloudDownload'
import PlayCircleOutlineIcon from '@mui/icons-material/PlayCircleOutline'
import { getProxiedImageUrl } from '@aperture/ui'
import { useServerDisplayName } from '../../../hooks/useServerDisplayName'
import { computeMissingSeasons } from '../missingSeasons'
import type { Series, Episode } from '../types'

interface SeasonsListProps {
  seasons: Record<number, Episode[]>
  series: Series
}

type EpisodeWatchState = 'watched' | 'in-progress' | 'unwatched'

function episodeWatchState(e: Episode): EpisodeWatchState {
  if (e.played || (e.play_count ?? 0) > 0) return 'watched'
  if ((e.progress_percent ?? 0) > 0) return 'in-progress'
  return 'unwatched'
}

type SeasonStatus = 'complete' | 'in-progress' | 'not-started'

interface SeasonRollup {
  total: number
  watched: number
  inProgress: number
  status: SeasonStatus
}

function rollupSeason(episodes: Episode[]): SeasonRollup {
  let watched = 0
  let inProgress = 0
  for (const e of episodes) {
    const state = episodeWatchState(e)
    if (state === 'watched') watched++
    else if (state === 'in-progress') inProgress++
  }
  const total = episodes.length
  const status: SeasonStatus =
    total > 0 && watched >= total
      ? 'complete'
      : watched > 0 || inProgress > 0
        ? 'in-progress'
        : 'not-started'
  return { total, watched, inProgress, status }
}

interface PresentEntry {
  kind: 'present'
  seasonNumber: number
  episodes: Episode[]
  rollup: SeasonRollup
}

interface MissingEntry {
  kind: 'missing'
  seasonNumber: number
  episodeCount: number
}

type SeasonEntry = PresentEntry | MissingEntry

export function SeasonsList({ seasons, series }: SeasonsListProps) {
  const { t } = useTranslation()
  const serverName = useServerDisplayName()

  // Merge on-server seasons with aired-but-absent ones so the rail reads as a
  // single sequence (S1 done → S2 in progress → S3 missing).
  const missingSeasons = computeMissingSeasons(series, seasons)
  const entries: SeasonEntry[] = [
    ...Object.keys(seasons)
      .map(Number)
      .map<PresentEntry>((sn) => ({
        kind: 'present',
        seasonNumber: sn,
        episodes: seasons[sn],
        rollup: rollupSeason(seasons[sn]),
      })),
    ...missingSeasons.map<MissingEntry>((m) => ({
      kind: 'missing',
      seasonNumber: m.season_number,
      episodeCount: m.episode_count,
    })),
  ].sort((a, b) => a.seasonNumber - b.seasonNumber)

  // Ordered list of every on-server episode, used for overall progress and the
  // resume / next-up target.
  const flatEpisodes = entries.flatMap((e) => (e.kind === 'present' ? e.episodes : []))
  const overallTotal = flatEpisodes.length
  const overallWatched = flatEpisodes.filter((e) => episodeWatchState(e) === 'watched').length
  const anyWatched = overallWatched > 0
  const resumeEpisode = flatEpisodes.find((e) => episodeWatchState(e) === 'in-progress')
  const nextEpisode = anyWatched
    ? flatEpisodes.find((e) => episodeWatchState(e) === 'unwatched')
    : undefined
  const ctaEpisode = resumeEpisode ?? nextEpisode
  const nextUpId = nextEpisode?.id

  const [selectedSeason, setSelectedSeason] = useState(
    () => ctaEpisode?.season_number ?? entries[0]?.seasonNumber ?? 1
  )

  if (entries.length === 0) {
    return (
      <Card sx={{ backgroundColor: 'background.paper', borderRadius: 2 }}>
        <CardContent>
          <Typography variant="h6" fontWeight={600} gutterBottom>
            {t('mediaDetail.seasons.title')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('mediaDetail.seasons.noEpisodes')}
          </Typography>
        </CardContent>
      </Card>
    )
  }

  const activeEntry = entries.find((e) => e.seasonNumber === selectedSeason) ?? entries[0]

  const seasonLabel = (seasonNumber: number) =>
    seasonNumber === 0
      ? t('mediaDetail.seasons.specials')
      : t('mediaDetail.seasons.seasonN', { n: seasonNumber })

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return null
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }

  const handleResume = () => {
    if (!ctaEpisode) return
    setSelectedSeason(ctaEpisode.season_number)
  }

  return (
    <Card sx={{ backgroundColor: 'background.paper', borderRadius: 2 }}>
      <CardContent>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 1.5,
            flexWrap: 'wrap',
            mb: 2,
          }}
        >
          <Box>
            <Typography variant="h6" fontWeight={600}>
              {t('mediaDetail.seasons.title')}
            </Typography>
            {overallTotal > 0 && (
              <Typography variant="caption" color="text.secondary">
                {t('mediaDetail.seasons.overallProgress', {
                  watched: overallWatched,
                  total: overallTotal,
                })}
              </Typography>
            )}
          </Box>
          {ctaEpisode && (
            <Button
              variant="outlined"
              size="small"
              startIcon={<PlayCircleOutlineIcon />}
              onClick={handleResume}
              sx={{ borderRadius: 2, textTransform: 'none' }}
            >
              {resumeEpisode
                ? t('mediaDetail.seasons.resume', {
                    season: ctaEpisode.season_number,
                    episode: ctaEpisode.episode_number,
                  })
                : t('mediaDetail.seasons.playNext', {
                    season: ctaEpisode.season_number,
                    episode: ctaEpisode.episode_number,
                  })}
            </Button>
          )}
        </Box>

        {/* Season rail — each season carries its own status at a glance */}
        <Box sx={{ display: 'flex', gap: 1, overflowX: 'auto', pb: 1, mb: 2 }}>
          {entries.map((entry) => (
            <SeasonPill
              key={entry.seasonNumber}
              entry={entry}
              label={seasonLabel(entry.seasonNumber)}
              selected={entry.seasonNumber === activeEntry.seasonNumber}
              onSelect={() => setSelectedSeason(entry.seasonNumber)}
              completeLabel={t('mediaDetail.seasons.statusComplete')}
              countLabel={
                entry.kind === 'present'
                  ? t('mediaDetail.seasons.seasonWatchedCount', {
                      watched: entry.rollup.watched,
                      total: entry.rollup.total,
                    })
                  : t('mediaDetail.seasons.seasonMissingCount', { count: entry.episodeCount })
              }
            />
          ))}
        </Box>

        {activeEntry.kind === 'missing' ? (
          <MissingSeasonPanel
            seasonNumber={activeEntry.seasonNumber}
            episodeCount={activeEntry.episodeCount}
            serverName={serverName}
          />
        ) : (
          <>
            <SeasonSummary rollup={activeEntry.rollup} />
            <Box sx={{ mt: 1.5 }}>
              {activeEntry.episodes.map((episode) => (
                <EpisodeRow
                  key={episode.id}
                  episode={episode}
                  state={episodeWatchState(episode)}
                  isNextUp={episode.id === nextUpId}
                  formatDate={formatDate}
                />
              ))}
            </Box>
          </>
        )}

        <SeasonsLegend hasMissing={missingSeasons.length > 0} />
      </CardContent>
    </Card>
  )
}

function EpisodeRow({
  episode,
  state,
  isNextUp,
  formatDate,
}: {
  episode: Episode
  state: EpisodeWatchState
  isNextUp: boolean
  formatDate: (d: string | null) => string | null
}) {
  const { t } = useTranslation()
  const isWatched = state === 'watched'
  const isInProgress = state === 'in-progress'
  const pct = episode.progress_percent ?? 0
  const minutesLeft =
    isInProgress && episode.runtime_minutes
      ? Math.max(1, Math.round(episode.runtime_minutes * (1 - pct / 100)))
      : null

  return (
    <Box
      sx={{
        display: 'flex',
        gap: 1.5,
        p: 1.5,
        mb: 1,
        borderRadius: 1,
        bgcolor: 'background.default',
        opacity: isWatched ? 0.82 : 1,
        border: isInProgress ? 1 : 0,
        borderColor: 'warning.main',
        alignItems: 'flex-start',
      }}
    >
      {/* Thumbnail with resume bar for in-progress */}
      <Box sx={{ position: 'relative', width: 80, height: 45, flexShrink: 0 }}>
        <Avatar
          variant="rounded"
          src={getProxiedImageUrl(episode.poster_url)}
          sx={{ width: 80, height: 45, bgcolor: 'grey.800' }}
        >
          <TvIcon />
        </Avatar>
        {isInProgress && (
          <Box
            sx={{
              position: 'absolute',
              left: 0,
              bottom: 0,
              height: 4,
              width: `${Math.min(100, Math.max(3, pct))}%`,
              bgcolor: 'warning.main',
              borderBottomLeftRadius: 4,
            }}
          />
        )}
      </Box>

      {/* Title, meta, and always-visible description */}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Typography variant="body2" color="text.secondary" sx={{ minWidth: 35 }}>
            E{episode.episode_number}
          </Typography>
          <Typography variant="body1" fontWeight={500}>
            {episode.title}
          </Typography>
          {episode.community_rating && (
            <Chip
              icon={<StarIcon sx={{ fontSize: 14 }} />}
              label={Number(episode.community_rating).toFixed(1)}
              size="small"
              sx={{
                height: 20,
                '& .MuiChip-label': { px: 0.5, fontSize: '0.7rem' },
                '& .MuiChip-icon': { ml: 0.5, color: 'warning.main' },
              }}
            />
          )}
          {isNextUp && (
            <Chip
              label={t('mediaDetail.seasons.nextUp')}
              size="small"
              color="primary"
              variant="outlined"
              sx={{ height: 20, '& .MuiChip-label': { px: 0.75, fontSize: '0.7rem' } }}
            />
          )}
        </Box>
        <Box sx={{ display: 'flex', gap: 2, mt: 0.5, alignItems: 'center', flexWrap: 'wrap' }}>
          {episode.premiere_date && (
            <Typography variant="caption" color="text.secondary">
              {formatDate(episode.premiere_date)}
            </Typography>
          )}
          {episode.runtime_minutes && !isInProgress && (
            <Typography variant="caption" color="text.secondary">
              {episode.runtime_minutes}m
            </Typography>
          )}
          {isInProgress && (
            <Typography variant="caption" color="warning.main" fontWeight={500}>
              {minutesLeft
                ? t('mediaDetail.seasons.continueMinutesLeft', { percent: pct, mins: minutesLeft })
                : t('mediaDetail.seasons.continuePercent', { percent: pct })}
            </Typography>
          )}
        </Box>
        {episode.overview && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {episode.overview}
          </Typography>
        )}
      </Box>

      {/* Watch-state indicator */}
      <Box sx={{ flexShrink: 0, mt: 0.5 }}>
        <EpisodeStateIndicator
          state={state}
          watchedLabel={t('mediaDetail.seasons.legendWatched')}
          unwatchedLabel={t('mediaDetail.seasons.legendUnwatched')}
        />
      </Box>
    </Box>
  )
}

function SeasonPill({
  entry,
  label,
  selected,
  onSelect,
  completeLabel,
  countLabel,
}: {
  entry: SeasonEntry
  label: string
  selected: boolean
  onSelect: () => void
  completeLabel: string
  countLabel: string
}) {
  const isMissing = entry.kind === 'missing'
  const status = entry.kind === 'present' ? entry.rollup.status : 'missing'
  const watchedPct =
    entry.kind === 'present' && entry.rollup.total > 0
      ? (entry.rollup.watched / entry.rollup.total) * 100
      : 0
  const inProgressPct =
    entry.kind === 'present' && entry.rollup.total > 0
      ? (entry.rollup.inProgress / entry.rollup.total) * 100
      : 0

  return (
    <Box
      component="button"
      type="button"
      onClick={onSelect}
      sx={{
        flexShrink: 0,
        minWidth: 148,
        textAlign: 'left',
        cursor: 'pointer',
        borderRadius: 1.5,
        p: 1,
        bgcolor: selected ? 'action.selected' : 'transparent',
        border: selected ? 2 : 1,
        borderStyle: isMissing && !selected ? 'dashed' : 'solid',
        borderColor: selected ? 'primary.main' : 'divider',
        transition: 'border-color 0.15s',
        '&:hover': { borderColor: selected ? 'primary.main' : 'text.disabled' },
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 0.5,
          mb: 0.75,
        }}
      >
        <Typography
          variant="body2"
          fontWeight={500}
          color={isMissing ? 'text.secondary' : 'text.primary'}
        >
          {label}
        </Typography>
        {status === 'complete' && (
          <CheckCircleIcon sx={{ fontSize: 18, color: 'success.main' }} />
        )}
        {status === 'missing' && (
          <CloudDownloadIcon sx={{ fontSize: 18, color: 'error.main' }} />
        )}
      </Box>
      <Box
        sx={{
          display: 'flex',
          height: 5,
          borderRadius: 3,
          overflow: 'hidden',
          bgcolor: (theme) => alpha(theme.palette.text.primary, 0.12),
        }}
      >
        {watchedPct > 0 && <Box sx={{ width: `${watchedPct}%`, bgcolor: 'success.main' }} />}
        {inProgressPct > 0 && (
          <Box sx={{ width: `${inProgressPct}%`, bgcolor: 'warning.main' }} />
        )}
      </Box>
      <Typography
        variant="caption"
        color={
          status === 'complete'
            ? 'success.main'
            : status === 'missing'
              ? 'error.main'
              : 'text.secondary'
        }
        sx={{ display: 'block', mt: 0.5 }}
      >
        {status === 'complete' ? completeLabel : countLabel}
      </Typography>
    </Box>
  )
}

function SeasonSummary({ rollup }: { rollup: SeasonRollup }) {
  const { t } = useTranslation()
  if (rollup.total === 0) return null
  const watchedPct = (rollup.watched / rollup.total) * 100
  const inProgressPct = (rollup.inProgress / rollup.total) * 100
  return (
    <Box>
      <Box
        sx={{
          display: 'flex',
          height: 6,
          borderRadius: 3,
          overflow: 'hidden',
          bgcolor: (theme) => alpha(theme.palette.text.primary, 0.12),
          mb: 0.5,
        }}
      >
        {watchedPct > 0 && <Box sx={{ width: `${watchedPct}%`, bgcolor: 'success.main' }} />}
        {inProgressPct > 0 && (
          <Box sx={{ width: `${inProgressPct}%`, bgcolor: 'warning.main' }} />
        )}
      </Box>
      <Typography variant="caption" color="text.secondary">
        {t('mediaDetail.seasons.seasonWatchedCount', {
          watched: rollup.watched,
          total: rollup.total,
        })}
        {rollup.inProgress > 0 &&
          ` · ${t('mediaDetail.seasons.seasonInProgressCount', { count: rollup.inProgress })}`}
      </Typography>
    </Box>
  )
}

function EpisodeStateIndicator({
  state,
  watchedLabel,
  unwatchedLabel,
}: {
  state: EpisodeWatchState
  watchedLabel: string
  unwatchedLabel: string
}) {
  if (state === 'watched') {
    return (
      <CheckCircleIcon
        aria-label={watchedLabel}
        sx={{ fontSize: 20, color: 'success.main', flexShrink: 0 }}
      />
    )
  }
  if (state === 'in-progress') {
    return <PlayCircleOutlineIcon sx={{ fontSize: 20, color: 'warning.main', flexShrink: 0 }} />
  }
  return (
    <Box
      role="img"
      aria-label={unwatchedLabel}
      sx={{
        width: 11,
        height: 11,
        borderRadius: '50%',
        border: 1.5,
        borderColor: 'text.disabled',
        flexShrink: 0,
      }}
    />
  )
}

function MissingSeasonPanel({
  seasonNumber,
  episodeCount,
  serverName,
}: {
  seasonNumber: number
  episodeCount: number
  serverName: string | null
}) {
  const { t } = useTranslation()
  return (
    <Box
      sx={{
        display: 'flex',
        gap: 1.5,
        p: 2,
        borderRadius: 1.5,
        border: 1,
        borderColor: 'error.main',
        bgcolor: (theme) => alpha(theme.palette.error.main, 0.08),
      }}
    >
      <CloudDownloadIcon sx={{ color: 'error.main', mt: 0.25 }} />
      <Box>
        <Typography variant="body2" fontWeight={500} gutterBottom>
          {serverName
            ? t('mediaDetail.seasons.notOnServerTitleNamed', { n: seasonNumber, serverName })
            : t('mediaDetail.seasons.notOnServerTitle', { n: seasonNumber })}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {t('mediaDetail.seasons.notOnServerBody', { count: episodeCount })}
        </Typography>
      </Box>
    </Box>
  )
}

function SeasonsLegend({ hasMissing }: { hasMissing: boolean }) {
  const { t } = useTranslation()
  const swatch = (color: string, label: string) => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
      <Box sx={{ width: 9, height: 9, borderRadius: '2px', bgcolor: color }} />
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
    </Box>
  )
  return (
    <Box
      sx={{
        display: 'flex',
        gap: 2,
        flexWrap: 'wrap',
        mt: 2,
        pt: 1.5,
        borderTop: 1,
        borderColor: 'divider',
      }}
    >
      {swatch('success.main', t('mediaDetail.seasons.legendWatched'))}
      {swatch('warning.main', t('mediaDetail.seasons.legendInProgress'))}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <Box
          sx={{
            width: 9,
            height: 9,
            borderRadius: '50%',
            border: 1.5,
            borderColor: 'text.disabled',
          }}
        />
        <Typography variant="caption" color="text.secondary">
          {t('mediaDetail.seasons.legendUnwatched')}
        </Typography>
      </Box>
      {hasMissing && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <CloudDownloadIcon sx={{ fontSize: 13, color: 'error.main' }} />
          <Typography variant="caption" color="text.secondary">
            {t('mediaDetail.seasons.legendMissing')}
          </Typography>
        </Box>
      )}
    </Box>
  )
}
