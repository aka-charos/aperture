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
 * title. That arrives as `canReport`, decided by the status endpoint, which
 * the page asks once and hands to everything needing it — each control asking
 * for itself meant the same call twice for a series with gaps in it. It is an
 * instance-level fact (is the integration configured, has it scanned this
 * library); whether *this* viewer's account is linked is checked at submit
 * instead, because that one is per-user and fixable, and a control that
 * silently vanishes teaches nobody what to do.
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert, Button, Snackbar, Tooltip } from '@mui/material'
import type { SxProps, Theme } from '@mui/material'
import ReportProblemOutlinedIcon from '@mui/icons-material/ReportProblemOutlined'
import { ReportIssueDialog } from '../../../components/ReportIssueDialog'
import { useServerDisplayName } from '../../../hooks/useServerDisplayName'

interface ReportIssueButtonProps {
  title: string
  tmdbId: number
  mediaType: 'movie' | 'series'
  seasons?: number[]
  /** Whether the backend can accept a report against this title at all. */
  canReport: boolean
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
  canReport,
  sx,
}: ReportIssueButtonProps) {
  const { t } = useTranslation()
  const serverName = useServerDisplayName()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [reported, setReported] = useState(false)

  if (!canReport) return null

  return (
    <>
      {/* Name the media server. A report goes to whoever runs the library, not
          to whoever runs this web app, and someone who does not know that
          reports the wrong thing to the wrong people. */}
      <Tooltip
        title={
          serverName
            ? t('reportIssue.heroTooltipNamed', { serverName })
            : t('reportIssue.heroTooltip')
        }
      >
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
