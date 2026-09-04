/**
 * Report a problem with a title.
 *
 * The four kinds are Seerr's own (video, audio, subtitles, other) and arrive
 * as names rather than its integers — the bundle never learns another
 * system's enums. Season and episode are optional and mean "the whole title"
 * when left alone, which is what Seerr's 0 encodes.
 */
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material'

export type IssueKind = 'video' | 'audio' | 'subtitles' | 'other'

const KINDS: IssueKind[] = ['video', 'audio', 'subtitles', 'other']

interface ReportIssueDialogProps {
  open: boolean
  onClose: () => void
  title: string
  tmdbId: number
  mediaType: 'movie' | 'series'
  /** Season numbers to offer, for a series. Empty means no season picker. */
  seasons?: number[]
  onReported?: (issueId: number) => void
}

export function ReportIssueDialog({
  open,
  onClose,
  title,
  tmdbId,
  mediaType,
  seasons = [],
  onReported,
}: ReportIssueDialogProps) {
  const { t } = useTranslation()
  const [kind, setKind] = useState<IssueKind>('video')
  const [message, setMessage] = useState('')
  const [season, setSeason] = useState<number | ''>('')
  const [episode, setEpisode] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setKind('video')
    setMessage('')
    setSeason('')
    setEpisode('')
    setError(null)
    setSubmitting(false)
  }, [open])

  const submit = async () => {
    setSubmitting(true)
    setError(null)
    try {
      const episodeNumber = Number.parseInt(episode, 10)
      const res = await fetch('/api/issues', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tmdbId,
          mediaType,
          kind,
          message: message.trim(),
          ...(season !== '' ? { problemSeason: season } : {}),
          ...(Number.isFinite(episodeNumber) && episodeNumber > 0
            ? { problemEpisode: episodeNumber }
            : {}),
        }),
      })
      const body = (await res.json().catch(() => ({}))) as {
        issueId?: number
        message?: string
        error?: string
      }
      if (!res.ok) {
        // The server passes Seerr's own sentence through, and answers 409 and
        // 422 with something the reader can act on — an unlinked account, or a
        // title Seerr has never scanned.
        throw new Error(body.message || body.error || t('reportIssue.errorSubmit'))
      }
      onReported?.(body.issueId ?? 0)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('reportIssue.errorSubmit'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t('reportIssue.title')}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t('reportIssue.subtitle', { title })}
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        <Stack spacing={2}>
          <FormControl fullWidth size="small">
            <InputLabel id="issue-kind">{t('reportIssue.kind')}</InputLabel>
            <Select
              labelId="issue-kind"
              label={t('reportIssue.kind')}
              value={kind}
              onChange={(e) => setKind(e.target.value as IssueKind)}
            >
              {KINDS.map((k) => (
                <MenuItem key={k} value={k}>
                  {t(`reportIssue.kinds.${k}`)}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {mediaType === 'series' && seasons.length > 0 && (
            <Stack direction="row" spacing={2}>
              <FormControl fullWidth size="small">
                <InputLabel id="issue-season">{t('reportIssue.season')}</InputLabel>
                <Select
                  labelId="issue-season"
                  label={t('reportIssue.season')}
                  value={season}
                  onChange={(e) => setSeason(e.target.value === '' ? '' : Number(e.target.value))}
                >
                  <MenuItem value="">{t('reportIssue.wholeTitle')}</MenuItem>
                  {seasons.map((s) => (
                    <MenuItem key={s} value={s}>
                      {t('reportIssue.seasonNumber', { number: s })}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <TextField
                size="small"
                fullWidth
                label={t('reportIssue.episode')}
                value={episode}
                onChange={(e) => setEpisode(e.target.value.replace(/[^0-9]/g, ''))}
                disabled={season === ''}
                helperText={t('reportIssue.episodeHelp')}
              />
            </Stack>
          )}

          <TextField
            label={t('reportIssue.message')}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            multiline
            minRows={3}
            fullWidth
            placeholder={t('reportIssue.messagePlaceholder')}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={submitting}>
          {t('common.cancel')}
        </Button>
        <Button
          variant="contained"
          onClick={() => void submit()}
          disabled={submitting || message.trim().length === 0}
        >
          {submitting ? t('reportIssue.submitting') : t('reportIssue.submit')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
