/**
 * MissingSeasonsCard Component
 *
 * Surfaces episodes that have aired (per TMDB) but are absent from the media
 * server — whole seasons and partial gaps alike — and offers the Seerr request
 * flow. The request action stays available even when nothing is missing, so
 * future seasons can still be requested.
 */

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Box,
  Typography,
  Card,
  CardContent,
  Chip,
  Button,
  Snackbar,
  Alert,
  CircularProgress,
} from '@mui/material'
import ReportProblemOutlinedIcon from '@mui/icons-material/ReportProblemOutlined'
import CloudDownloadIcon from '@mui/icons-material/CloudDownload'
import {
  SeasonSelectModal,
  type SeasonInfo,
} from '../../discovery/components/SeasonSelectModal'
import { useSeerrRequest } from '../../discovery/hooks/useSeerrRequest'
import { useServerDisplayName } from '../../../hooks/useServerDisplayName'
import type { Series, SeasonAvailability } from '../types'

interface MissingSeasonsCardProps {
  series: Series
  seasonAvailability: SeasonAvailability[]
}

export function MissingSeasonsCard({ series, seasonAvailability }: MissingSeasonsCardProps) {
  const { t } = useTranslation()
  const { fetchTVDetails, submitRequest } = useSeerrRequest()
  const serverName = useServerDisplayName()
  const [canRequest, setCanRequest] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [modalSeasons, setModalSeasons] = useState<SeasonInfo[]>([])
  const [loadingSeasons, setLoadingSeasons] = useState(false)
  const [snackbar, setSnackbar] = useState<{
    open: boolean
    message: string
    severity: 'success' | 'error'
  }>({ open: false, message: '', severity: 'success' })

  const tmdbId = series.tmdb_id ? parseInt(series.tmdb_id, 10) : null

  // Aired-but-absent episodes, computed server-side (the airing season is
  // capped at what has actually aired, so unaired episodes never count).
  const gaps = seasonAvailability.filter((s) => s.missing_episodes > 0)
  const totalMissing = gaps.reduce((sum, s) => sum + s.missing_episodes, 0)

  // Seerr request availability (endpoint reports canRequest=false when Seerr
  // is not configured or requests are disabled for this user)
  useEffect(() => {
    if (!tmdbId) return
    let cancelled = false
    fetch(`/api/seerr/status/tv/${tmdbId}`, { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { canRequest?: boolean } | null) => {
        if (!cancelled && data) setCanRequest(data.canRequest === true)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [tmdbId])

  // Nothing to report and nothing to request — stay out of the way.
  if (gaps.length === 0 && !canRequest) {
    return null
  }

  const handleOpenRequest = async () => {
    if (!tmdbId) return
    setLoadingSeasons(true)
    try {
      const details = await fetchTVDetails(tmdbId)
      if (details) {
        // Seerr's season statuses only reflect Seerr requests, not what is
        // already on the media server — preselect the seasons with real gaps,
        // and fall back to every season when nothing is missing (so future
        // seasons can still be requested).
        const gapNumbers = new Set(gaps.map((s) => s.season_number))
        const offered =
          gapNumbers.size > 0
            ? details.seasons.filter((s) => gapNumbers.has(s.seasonNumber))
            : details.seasons
        setModalSeasons(offered)
        setModalOpen(true)
      } else {
        setSnackbar({
          open: true,
          message: t('mediaDetail.missingSeasons.requestFailed'),
          severity: 'error',
        })
      }
    } finally {
      setLoadingSeasons(false)
    }
  }

  const handleSubmit = async (selectedSeasons: number[]) => {
    if (!tmdbId) return
    const result = await submitRequest(tmdbId, 'series', series.title, undefined, selectedSeasons)
    setModalOpen(false)
    setSnackbar({
      open: true,
      message: result.success
        ? t('mediaDetail.missingSeasons.requestSuccess')
        : result.error || t('mediaDetail.missingSeasons.requestFailed'),
      severity: result.success ? 'success' : 'error',
    })
  }

  const hasGaps = gaps.length > 0

  return (
    <Card
      sx={{
        backgroundColor: 'background.paper',
        borderRadius: 2,
        ...(hasGaps ? { borderLeft: 3, borderLeftColor: 'error.main' } : {}),
      }}
    >
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: hasGaps ? 1.5 : 1 }}>
          {hasGaps ? (
            <ReportProblemOutlinedIcon sx={{ color: 'error.main', fontSize: 20 }} />
          ) : (
            <CloudDownloadIcon sx={{ color: 'text.secondary', fontSize: 20 }} />
          )}
          <Typography variant="h6" fontWeight={600}>
            {hasGaps
              ? serverName
                ? t('mediaDetail.missingSeasons.titleNamed', { serverName })
                : t('mediaDetail.missingSeasons.title')
              : t('mediaDetail.missingSeasons.completeTitle')}
          </Typography>
        </Box>

        {hasGaps ? (
          <>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
              {t('mediaDetail.missingSeasons.summary', { count: totalMissing })}
            </Typography>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: canRequest ? 2 : 0 }}>
              {gaps.map((s) => (
                <Chip
                  key={s.season_number}
                  label={
                    s.episodes_on_server === 0
                      ? t('mediaDetail.missingSeasons.seasonChip', {
                          n: s.season_number,
                          count: s.missing_episodes,
                        })
                      : t('mediaDetail.missingSeasons.seasonPartialChip', {
                          n: s.season_number,
                          missing: s.missing_episodes,
                          aired: s.aired_episodes ?? 0,
                        })
                  }
                  size="small"
                  variant="outlined"
                  color="error"
                />
              ))}
            </Box>
          </>
        ) : (
          <Typography variant="body2" color="text.secondary" sx={{ mb: canRequest ? 2 : 0 }}>
            {serverName
              ? t('mediaDetail.missingSeasons.completeBodyNamed', { serverName })
              : t('mediaDetail.missingSeasons.completeBody')}
          </Typography>
        )}

        {canRequest && (
          <Button
            variant="outlined"
            color={hasGaps ? 'error' : 'inherit'}
            size="small"
            startIcon={
              loadingSeasons ? <CircularProgress size={16} color="inherit" /> : <CloudDownloadIcon />
            }
            onClick={handleOpenRequest}
            disabled={loadingSeasons}
            sx={{ borderRadius: 2 }}
          >
            {hasGaps
              ? serverName
                ? t('mediaDetail.missingSeasons.requestNamed', { serverName })
                : t('mediaDetail.missingSeasons.request')
              : t('mediaDetail.missingSeasons.requestSeasons')}
          </Button>
        )}
      </CardContent>

      <SeasonSelectModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmit={handleSubmit}
        title={series.title}
        seasons={modalSeasons}
      />

      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar((prev) => ({ ...prev, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={() => setSnackbar((prev) => ({ ...prev, open: false }))}
          severity={snackbar.severity}
          sx={{ width: '100%' }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Card>
  )
}
