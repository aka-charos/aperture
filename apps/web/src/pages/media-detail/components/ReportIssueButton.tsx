/**
 * "Report a problem" — the entry point for reporting a problem with a title.
 *
 * It sits last in the hero's action row rather than in a card at the foot of
 * the page: reporting a problem is something you decide to do while looking at
 * the title, and everything else you can do to a title is up there. It is also
 * the lowest-weight control in that row on purpose — borderless beside the
 * outlined pills — because it is infrequent, and a page should not press
 * someone to file a complaint about the thing they came to watch.
 *
 * Renders nothing at all unless the backing service holds a record of this
 * title, which the status endpoint answers as a decided `canReportIssue`.
 * That is an instance-level fact (is the integration configured, has it
 * scanned this library); whether *this* viewer's account is linked is checked
 * at submit instead, because that one is per-user and fixable, and a control
 * that silently vanishes teaches nobody what to do.
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert, Button, Snackbar, Tooltip } from '@mui/material'
import type { SxProps, Theme } from '@mui/material'
import ReportProblemOutlinedIcon from '@mui/icons-material/ReportProblemOutlined'
import { ReportIssueDialog } from '../../../components/ReportIssueDialog'

interface ReportIssueButtonProps {
  title: string
  tmdbId: number
  mediaType: 'movie' | 'series'
  seasons?: number[]
  /**
   * The action row's shared button styling (height, radius, no shrinking).
   * Passed in rather than restated here, so tuning the row moves this button
   * with the rest of it.
   */
  sx?: SxProps<Theme>
}

export function ReportIssueButton({
  title,
  tmdbId,
  mediaType,
  seasons = [],
  sx,
}: ReportIssueButtonProps) {
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
      <Tooltip title={t('reportIssue.heroTooltip')}>
        <Button
          variant="text"
          color="inherit"
          startIcon={<ReportProblemOutlinedIcon />}
          onClick={() => setDialogOpen(true)}
          sx={[
            {
              color: 'text.secondary',
              '&:hover': { color: 'text.primary', backgroundColor: 'action.hover' },
            },
            // MUI's own merge pattern — sx can be an array or a function, so it
            // cannot simply be spread into an object literal.
            ...(Array.isArray(sx) ? sx : [sx]),
          ]}
        >
          {t('reportIssue.heroAction')}
        </Button>
      </Tooltip>

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
