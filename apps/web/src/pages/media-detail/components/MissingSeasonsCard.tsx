/**
 * MissingSeasonsCard Component
 *
 * Flags seasons that have aired (per TMDB) but have no episodes on the media
 * server, and lets the user request them via Seerr when requests are enabled.
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
import type { Series, Episode } from '../types'

interface MissingSeasonsCardProps {
  series: Series
  seasons: Record<number, Episode[]>
}

export function MissingSeasonsCard({ series, seasons }: MissingSeasonsCardProps) {
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

  const today = new Date().toISOString().split('T')[0]
  const serverSeasonNumbers = new Set(Object.keys(seasons).map(Number))
  const missing = (series.tmdb_seasons ?? []).filter(
    (s) =>
      s.season_number >= 1 &&
      s.episode_count > 0 &&
      s.air_date !== null &&
      s.air_date <= today &&
      !serverSeasonNumbers.has(s.season_number)
  )

  // Seerr request availability (endpoint reports canRequest=false when Seerr
  // is not configured or requests are disabled for this user)
  useEffect(() => {
    if (!tmdbId || missing.length === 0) return
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
     
  }, [tmdbId, missing.length])

  if (missing.length === 0) {
    return null
  }

  const handleOpenRequest = async () => {
    if (!tmdbId) return
    setLoadingSeasons(true)
    try {
      const details = await fetchTVDetails(tmdbId)
      if (details) {
        // Seerr's season statuses only reflect Seerr requests, not what is
        // already on the media server — offer only the seasons this card
        // flagged as missing (aired + absent from the server).
        const missingNumbers = new Set(missing.map((s) => s.season_number))
        setModalSeasons(details.seasons.filter((s) => missingNumbers.has(s.seasonNumber)))
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

  return (
    <Card
      sx={{
        backgroundColor: 'background.paper',
        borderRadius: 2,
        borderLeft: 3,
        borderLeftColor: 'warning.main',
      }}
    >
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
          <ReportProblemOutlinedIcon sx={{ color: 'warning.main', fontSize: 20 }} />
          <Typography variant="h6" fontWeight={600}>
            {serverName
              ? t('mediaDetail.missingSeasons.titleNamed', { serverName })
              : t('mediaDetail.missingSeasons.title')}
          </Typography>
        </Box>

        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: canRequest ? 2 : 0 }}>
          {missing.map((s) => (
            <Chip
              key={s.season_number}
              label={t('mediaDetail.missingSeasons.seasonChip', {
                n: s.season_number,
                count: s.episode_count,
              })}
              size="small"
              variant="outlined"
              color="warning"
            />
          ))}
        </Box>

        {canRequest && (
          <Button
            variant="outlined"
            color="warning"
            size="small"
            startIcon={
              loadingSeasons ? <CircularProgress size={16} color="inherit" /> : <CloudDownloadIcon />
            }
            onClick={handleOpenRequest}
            disabled={loadingSeasons}
            sx={{ borderRadius: 2 }}
          >
            {serverName
              ? t('mediaDetail.missingSeasons.requestNamed', { serverName })
              : t('mediaDetail.missingSeasons.request')}
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
