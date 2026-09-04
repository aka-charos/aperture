/**
 * "Something wrong with this?" — the entry point for reporting a problem.
 *
 * Renders nothing at all unless the backing service holds a record of this
 * title, which the status endpoint answers as a decided `canReportIssue`.
 * That is an instance-level fact (is the integration configured, has it
 * scanned this library); whether *this* viewer's account is linked is checked
 * at submit instead, because that one is per-user and fixable, and a control
 * that silently vanishes teaches nobody what to do.
 */
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert, Box, Button, Paper, Snackbar, Typography } from '@mui/material'
import ReportProblemOutlinedIcon from '@mui/icons-material/ReportProblemOutlined'
import { ReportIssueDialog } from '../../../components/ReportIssueDialog'

interface ReportIssueCardProps {
  title: string
  tmdbId: number
  mediaType: 'movie' | 'series'
  seasons?: number[]
}

export function ReportIssueCard({ title, tmdbId, mediaType, seasons = [] }: ReportIssueCardProps) {
  const { t } = useTranslation()
  const [canReport, setCanReport] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [reported, setReported] = useState(false)

  useEffect(() => {
    if (!tmdbId) return
    let cancelled = false
    const path = mediaType === 'movie' ? 'movie' : 'tv'
    void fetch(`/api/seerr/status/${path}/${tmdbId}`, { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { canReportIssue?: boolean } | null) => {
        // Absent reads as false: an older server that does not send the field
        // cannot accept the report either.
        if (!cancelled) setCanReport(data?.canReportIssue === true)
      })
      .catch(() => {
        if (!cancelled) setCanReport(false)
      })
    return () => {
      cancelled = true
    }
  }, [tmdbId, mediaType])

  if (!canReport) return null

  return (
    <>
      <Paper variant="outlined" sx={{ borderRadius: 2, p: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <ReportProblemOutlinedIcon fontSize="small" color="action" />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="subtitle2">{t('reportIssue.cardTitle')}</Typography>
            <Typography variant="caption" color="text.secondary">
              {t('reportIssue.cardBody')}
            </Typography>
          </Box>
          <Button size="small" variant="outlined" onClick={() => setDialogOpen(true)}>
            {t('reportIssue.cardAction')}
          </Button>
        </Box>
      </Paper>

      <ReportIssueDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title={title}
        tmdbId={tmdbId}
        mediaType={mediaType}
        seasons={seasons}
        onReported={() => setReported(true)}
      />

      <Snackbar
        open={reported}
        autoHideDuration={6000}
        onClose={() => setReported(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="success" variant="filled" onClose={() => setReported(false)}>
          {t('reportIssue.reported')}
        </Alert>
      </Snackbar>
    </>
  )
}
