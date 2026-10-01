import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link as RouterLink, useNavigate } from 'react-router-dom'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  FormControlLabel,
  Stack,
  Switch,
  Typography,
} from '@mui/material'
import ArchiveOutlinedIcon from '@mui/icons-material/ArchiveOutlined'
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep'
import HomeIcon from '@mui/icons-material/Home'
import { saveLegacyLibraryOutput, useLegacyLibraryOutput } from '@/hooks/legacyLibraryOutput'
import { adminPathFor } from '@/pages/admin/nav/registry'
import { jobConsoleLink } from '@/pages/jobs/registry'

const REMOVE_JOB = 'remove-legacy-libraries'

/**
 * The master switch for legacy library output — the per-viewer AI Picks and
 * shared Top Picks libraries written as STRM files or symlinks — and the one
 * place their removal is offered.
 *
 * Switching off stops writing; the only libraries it costs anyone are ones
 * their owner may no longer fully open, which the library jobs still remove
 * (and the help text says so). Removing everything is a second, confirmed
 * step, because an operator flips a switch to try it, and every viewer losing a
 * library in their media server is not something to learn by trying. Removal is
 * the `remove-legacy-libraries` job rather than a request, so it gets the Jobs
 * console's progress, log and Stop button, and cannot be cut off by a proxy
 * while it deletes libraries one by one.
 */
export function LegacyLibraryOutputCard() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  // Fresh: the count moves when a removal finishes elsewhere, so this card
  // asks again rather than trusting the page load's answer.
  const legacy = useLegacyLibraryOutput({ fresh: true })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [removeStarted, setRemoveStarted] = useState(false)

  const handleToggle = async (enabled: boolean) => {
    setSaving(true)
    setError(null)
    setSuccess(null)
    setRemoveStarted(false)
    try {
      await saveLegacyLibraryOutput(enabled)
      setSuccess(t(enabled ? 'legacyLibraryOutput.card.savedOn' : 'legacyLibraryOutput.card.savedOff'))
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : t('legacyLibraryOutput.card.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const handleRemove = async () => {
    setConfirmOpen(false)
    setRemoving(true)
    setError(null)
    setSuccess(null)
    try {
      const response = await fetch(`/api/jobs/${REMOVE_JOB}/run`, { method: 'POST', credentials: 'include' })
      if (!response.ok) {
        // A 409 says the job is already running or winding down; that sentence
        // is the useful part, so it is shown as-is.
        const data = (await response.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error || t('legacyLibraryOutput.card.removeFailed'))
      }
      setRemoveStarted(true)
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : t('legacyLibraryOutput.card.removeFailed'))
    } finally {
      setRemoving(false)
    }
  }

  const counts = legacy.generatedLibraries
  // Not gated on the count: it is the RECORDED libraries only, and the removal
  // also finds ones a rename left with no record, plus the Top Picks collection
  // and playlist — none of which a count of rows can see.
  const canRemove = legacy.off && !removing

  return (
    <Card sx={{ backgroundColor: 'background.paper', borderRadius: 2 }}>
      <CardContent>
        <Stack direction="row" alignItems="center" gap={1} flexWrap="wrap" mb={1}>
          <ArchiveOutlinedIcon color="primary" />
          <Typography variant="h6">{t('legacyLibraryOutput.card.title')}</Typography>
          <Chip size="small" color="warning" variant="outlined" label={t('legacyLibraryOutput.legacyChip')} />
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          {t('legacyLibraryOutput.card.subtitle')}
        </Typography>
        <Button
          size="small"
          startIcon={<HomeIcon />}
          component={RouterLink}
          to={adminPathFor('home-sections')}
        >
          {t('legacyLibraryOutput.card.homeRowsLink')}
        </Button>

        <Divider sx={{ my: 2 }} />

        <FormControlLabel
          id="legacy-library-output-enabled"
          control={
            <Switch
              checked={legacy.enabled}
              onChange={(e) => void handleToggle(e.target.checked)}
              disabled={!legacy.ready || saving}
            />
          }
          label={
            <Stack direction="row" alignItems="center" gap={1}>
              <Typography variant="body1">{t('legacyLibraryOutput.card.switchLabel')}</Typography>
              {saving && <CircularProgress size={14} />}
            </Stack>
          }
        />
        <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 0.5 }}>
          {legacy.enabled ? t('legacyLibraryOutput.card.switchOnHelp') : t('legacyLibraryOutput.card.switchOffHelpFrozen')}
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mt: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}
        {success && (
          <Alert severity="success" sx={{ mt: 2 }} onClose={() => setSuccess(null)}>
            {success}
          </Alert>
        )}

        {counts && (
          <Box sx={{ mt: 3 }}>
            <Typography variant="subtitle2" gutterBottom>
              {t('legacyLibraryOutput.card.remainingTitle')}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
              {counts.total > 0
                ? t('legacyLibraryOutput.card.remainingCount', {
                    count: counts.total,
                    personal: counts.personal,
                    topPicks: counts.topPicks,
                  })
                : t('legacyLibraryOutput.card.noneRemaining')}
            </Typography>
            <Button
              variant="outlined"
              color="error"
              startIcon={removing ? <CircularProgress size={16} /> : <DeleteSweepIcon />}
              onClick={() => setConfirmOpen(true)}
              disabled={!canRemove}
            >
              {t('legacyLibraryOutput.card.removeButton')}
            </Button>
            {!legacy.off && (
              <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1 }}>
                {t('legacyLibraryOutput.card.removeNeedsOff')}
              </Typography>
            )}
          </Box>
        )}

        {removeStarted && (
          <Alert
            severity="info"
            sx={{ mt: 2 }}
            onClose={() => setRemoveStarted(false)}
            action={
              <Button color="inherit" size="small" onClick={() => navigate(jobConsoleLink(REMOVE_JOB))}>
                {t('legacyLibraryOutput.card.openJob')}
              </Button>
            }
          >
            {t('legacyLibraryOutput.card.removeStarted')}
          </Alert>
        )}
      </CardContent>

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)} maxWidth="sm">
        <DialogTitle>{t('legacyLibraryOutput.card.confirmTitle')}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {t('legacyLibraryOutput.card.confirmBody', { count: counts?.total ?? 0 })}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)}>{t('legacyLibraryOutput.card.cancel')}</Button>
          <Button color="error" variant="contained" onClick={() => void handleRemove()}>
            {t('legacyLibraryOutput.card.confirmAction')}
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  )
}
