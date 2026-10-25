import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControl,
  InputLabel,
  LinearProgress,
  ListItemText,
  MenuItem,
  OutlinedInput,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import RefreshIcon from '@mui/icons-material/Refresh'
import SaveIcon from '@mui/icons-material/Save'
import SendIcon from '@mui/icons-material/Send'
import ScienceOutlinedIcon from '@mui/icons-material/ScienceOutlined'
import {
  api,
  type AudienceSummary,
  type Delivery,
  type Newsletter,
  type NewsletterGroup,
  type NewsletterOptions,
} from './api'
import { NewsletterBodyEditor } from './NewsletterBodyEditor'
import { FALLBACK_DEFAULT_FIELDS, FALLBACK_TITLE_FIELDS } from './fields'
import { StatusChip } from './StatusChip'

const PREVIEW_DEBOUNCE_MS = 1200
const POLL_MS = 2000

interface Preview {
  subject: string
  html: string
  language: string
}

export function NewsletterEditor({
  id,
  options,
  onBack,
  onOpen,
}: {
  id: string
  options: NewsletterOptions | null
  onBack: () => void
  onOpen: (id: string) => void
}) {
  const { t } = useTranslation()
  const [newsletter, setNewsletter] = useState<Newsletter | null>(null)
  const [groups, setGroups] = useState<NewsletterGroup[]>([])
  const [subject, setSubject] = useState('')
  const [preheader, setPreheader] = useState('')
  const [groupIds, setGroupIds] = useState<string[]>([])
  const [content, setContent] = useState<Record<string, unknown> | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [audience, setAudience] = useState<AudienceSummary | null>(null)
  const [previewLanguage, setPreviewLanguage] = useState<string>('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [confirmSend, setConfirmSend] = useState(false)
  const [busy, setBusy] = useState<'test' | 'send' | null>(null)
  const [deliveries, setDeliveries] = useState<Delivery[] | null>(null)

  // A send that reached anyone is history: what the rest get on a retry must be
  // what the first recipients got, so only an untouched failure stays editable
  // (core newsletter/store.ts `updateNewsletter` holds the same rule).
  const editable =
    newsletter?.status === 'draft' || (newsletter?.status === 'failed' && newsletter.sentCount === 0)
  const canSend = newsletter?.status === 'draft' || newsletter?.status === 'failed'

  const load = useCallback(async () => {
    try {
      const [{ newsletter: loaded }, { groups: list }] = await Promise.all([
        api<{ newsletter: Newsletter }>(`/api/newsletters/${id}`),
        api<{ groups: NewsletterGroup[] }>('/api/newsletter-groups'),
      ])
      setNewsletter(loaded)
      setGroups(list)
      setSubject(loaded.subject)
      setPreheader(loaded.preheader)
      setGroupIds(loaded.groupIds)
      setContent(loaded.content)
      setDirty(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (options && !previewLanguage) setPreviewLanguage(options.defaultLanguage)
  }, [options, previewLanguage])

  // While a send runs, follow it; afterwards, list who got it.
  useEffect(() => {
    if (newsletter?.status !== 'sending') return
    const timer = setInterval(() => {
      api<{ newsletter: Newsletter }>(`/api/newsletters/${id}`)
        .then(({ newsletter: next }) => setNewsletter(next))
        .catch(() => undefined)
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [id, newsletter?.status])

  useEffect(() => {
    if (!newsletter || newsletter.status === 'draft' || newsletter.status === 'sending') {
      setDeliveries(null)
      return
    }
    api<{ deliveries: Delivery[] }>(`/api/newsletters/${id}/deliveries`)
      .then(({ deliveries: list }) => setDeliveries(list))
      .catch(() => setDeliveries([]))
  }, [id, newsletter])

  // Who the chosen groups reach, from the rules the send uses.
  useEffect(() => {
    if (groupIds.length === 0) {
      setAudience(null)
      return
    }
    let cancelled = false
    api<AudienceSummary>('/api/newsletters/audience', { method: 'POST', json: { groupIds } })
      .then((summary) => !cancelled && setAudience(summary))
      .catch(() => !cancelled && setAudience(null))
    return () => {
      cancelled = true
    }
  }, [groupIds])

  // The preview follows the editor, a little behind it. A slow answer to an
  // older version is dropped.
  const previewSeq = useRef(0)
  const refreshPreview = useCallback(async () => {
    if (!content || !previewLanguage) return
    const seq = ++previewSeq.current
    setPreviewing(true)
    try {
      const result = await api<Preview>('/api/newsletters/preview', {
        method: 'POST',
        json: { subject, preheader, content, groupIds, language: previewLanguage },
      })
      if (seq === previewSeq.current) setPreview(result)
    } catch (err) {
      if (seq === previewSeq.current) setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (seq === previewSeq.current) setPreviewing(false)
    }
  }, [content, groupIds, preheader, previewLanguage, subject])

  useEffect(() => {
    const timer = setTimeout(() => void refreshPreview(), PREVIEW_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [refreshPreview])

  const save = useCallback(async (): Promise<boolean> => {
    if (!content) return false
    setSaving(true)
    setError(null)
    try {
      const { newsletter: saved } = await api<{ newsletter: Newsletter }>(`/api/newsletters/${id}`, {
        method: 'PUT',
        json: { subject, preheader, content, groupIds },
      })
      setNewsletter(saved)
      setDirty(false)
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return false
    } finally {
      setSaving(false)
    }
  }, [content, groupIds, id, preheader, subject])

  const sendTest = async () => {
    if (!content) return
    setBusy('test')
    setError(null)
    setNotice(null)
    try {
      const result = await api<{ to: string }>('/api/newsletters/test', {
        method: 'POST',
        json: { subject, preheader, content, groupIds, language: previewLanguage },
      })
      setNotice(t('newsletters.editor.testSent', { to: result.to }))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  const send = async () => {
    setConfirmSend(false)
    setBusy('send')
    setError(null)
    try {
      if (dirty && !(await save())) return
      await api(`/api/newsletters/${id}/send`, { method: 'POST' })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  const duplicate = async () => {
    try {
      const { newsletter: copy } = await api<{ newsletter: Newsletter }>(`/api/newsletters/${id}/duplicate`, {
        method: 'POST',
      })
      onOpen(copy.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  if (!newsletter || !content) {
    return error ? <Alert severity="error">{error}</Alert> : <LinearProgress />
  }

  const recipientCount = audience?.recipients.length ?? 0
  const languageLabel = (code: string) => options?.languages.find((l) => l.code === code)?.label ?? code
  const availableFields = options?.titleFields ?? FALLBACK_TITLE_FIELDS
  const defaultFields = options?.defaultTitleFields ?? FALLBACK_DEFAULT_FIELDS

  return (
    <Stack spacing={2}>
      <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" useFlexGap>
        <Button startIcon={<ArrowBackIcon />} onClick={onBack}>
          {t('newsletters.editor.back')}
        </Button>
        <StatusChip status={newsletter.status} />
        <Box sx={{ flex: 1 }} />
        {editable && (
          <>
            <Button
              startIcon={busy === 'test' ? <CircularProgress size={16} /> : <ScienceOutlinedIcon />}
              disabled={busy !== null}
              onClick={() => void sendTest()}
            >
              {t('newsletters.editor.sendTest')}
            </Button>
            <Button
              variant="outlined"
              startIcon={saving ? <CircularProgress size={16} /> : <SaveIcon />}
              disabled={saving || !dirty}
              onClick={() => void save()}
            >
              {dirty ? t('newsletters.editor.save') : t('newsletters.editor.saved')}
            </Button>
          </>
        )}
        {!editable && (
          <Button startIcon={<ContentCopyIcon />} onClick={() => void duplicate()}>
            {t('newsletters.editor.duplicate')}
          </Button>
        )}
        {canSend && (
          <Button
            variant="contained"
            startIcon={busy === 'send' ? <CircularProgress size={16} color="inherit" /> : <SendIcon />}
            disabled={
              busy !== null ||
              !!options?.sendingProblem ||
              // A partly-sent retry goes to whoever is left, whatever the groups reach now.
              (editable && (!subject.trim() || groupIds.length === 0 || recipientCount === 0))
            }
            onClick={() => setConfirmSend(true)}
          >
            {newsletter.status === 'failed' ? t('newsletters.editor.retry') : t('newsletters.editor.send')}
          </Button>
        )}
      </Stack>

      {options?.sendingProblemText && canSend && (
        <Alert severity="warning">{t('newsletters.editor.cannotSend', { reason: options.sendingProblemText })}</Alert>
      )}
      {newsletter.status === 'failed' && newsletter.lastError && (
        <Alert severity="error">{t('newsletters.editor.lastError', { error: newsletter.lastError })}</Alert>
      )}
      {newsletter.status === 'sending' && (
        <Alert severity="info" icon={<CircularProgress size={18} />}>
          {t('newsletters.editor.sendingProgress', {
            sent: newsletter.sentCount,
            total: newsletter.recipientCount ?? 0,
          })}
        </Alert>
      )}
      {newsletter.status === 'sent' && (
        <Alert severity="success">
          {t('newsletters.editor.sentSummary', {
            sent: newsletter.sentCount,
            date: newsletter.sentAt ? new Date(newsletter.sentAt).toLocaleString() : '',
          })}
        </Alert>
      )}
      {error && (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {notice && (
        <Alert severity="success" onClose={() => setNotice(null)}>
          {notice}
        </Alert>
      )}

      <Box
        sx={{
          display: 'grid',
          gap: 2,
          gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) minmax(0, 1fr)' },
          alignItems: 'start',
        }}
      >
        <Stack spacing={2}>
          <TextField
            label={t('newsletters.editor.subject')}
            value={subject}
            disabled={!editable}
            onChange={(event) => {
              setSubject(event.target.value)
              setDirty(true)
            }}
            inputProps={{ maxLength: 200 }}
            fullWidth
          />
          <TextField
            label={t('newsletters.editor.preheader')}
            helperText={t('newsletters.editor.preheaderHelp')}
            value={preheader}
            disabled={!editable}
            onChange={(event) => {
              setPreheader(event.target.value)
              setDirty(true)
            }}
            inputProps={{ maxLength: 200 }}
            fullWidth
          />
          <FormControl fullWidth disabled={!editable}>
            <InputLabel id="newsletter-groups-label">{t('newsletters.editor.groups')}</InputLabel>
            <Select
              labelId="newsletter-groups-label"
              multiple
              value={groupIds}
              onChange={(event) => {
                const value = event.target.value
                setGroupIds(typeof value === 'string' ? value.split(',') : value)
                setDirty(true)
              }}
              input={<OutlinedInput label={t('newsletters.editor.groups')} />}
              renderValue={(selected) => (
                <Stack direction="row" gap={0.5} flexWrap="wrap">
                  {selected.map((groupId) => (
                    <Chip key={groupId} size="small" label={groups.find((g) => g.id === groupId)?.name ?? '—'} />
                  ))}
                </Stack>
              )}
            >
              {groups.length === 0 && (
                <MenuItem disabled>
                  <ListItemText primary={t('newsletters.editor.noGroups')} />
                </MenuItem>
              )}
              {groups.map((group) => (
                <MenuItem key={group.id} value={group.id}>
                  <Checkbox size="small" checked={groupIds.includes(group.id)} />
                  <ListItemText
                    primary={group.name}
                    secondary={t('newsletters.groups.counts', {
                      members: group.memberCount ?? 0,
                      recipients: group.recipientCount ?? 0,
                    })}
                  />
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          {audience && (
            <Typography variant="body2" color={recipientCount === 0 ? 'warning.main' : 'text.secondary'}>
              {recipientCount === 0
                ? t('newsletters.editor.noRecipients')
                : t('newsletters.editor.audience', {
                    count: recipientCount,
                    languages: Object.entries(audience.byLanguage)
                      .map(([code, n]) => `${languageLabel(code)} ${n}`)
                      .join(', '),
                  })}
            </Typography>
          )}

          {editable ? (
            <NewsletterBodyEditor
              key={newsletter.id}
              initialContent={content}
              availableFields={availableFields}
              defaultFields={defaultFields}
              onChange={(doc) => {
                setContent(doc)
                setDirty(true)
              }}
            />
          ) : (
            deliveries && (
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1 }}>
                    {t('newsletters.editor.deliveries', { count: deliveries.length })}
                  </Typography>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>{t('newsletters.editor.recipient')}</TableCell>
                        <TableCell>{t('newsletters.editor.language')}</TableCell>
                        <TableCell>{t('newsletters.editor.result')}</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {deliveries.map((delivery, index) => (
                        <TableRow key={`${delivery.userId ?? delivery.email}-${index}`}>
                          <TableCell>
                            <Typography variant="body2">{delivery.username ?? delivery.email}</Typography>
                            <Typography variant="caption" color="text.secondary">
                              {delivery.email}
                            </Typography>
                          </TableCell>
                          <TableCell>{languageLabel(delivery.language)}</TableCell>
                          <TableCell>
                            {delivery.status === 'sent' ? (
                              <Chip size="small" color="success" label={t('newsletters.editor.delivered')} />
                            ) : (
                              <Typography variant="body2" color="error">
                                {delivery.error}
                              </Typography>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )
          )}
        </Stack>

        <Card variant="outlined" sx={{ position: { md: 'sticky' }, top: { md: 16 } }}>
          <CardContent>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
              <Typography variant="subtitle1" fontWeight={600} sx={{ flex: 1 }}>
                {t('newsletters.editor.preview')}
              </Typography>
              <TextField
                select
                size="small"
                label={t('newsletters.editor.previewLanguage')}
                value={previewLanguage}
                onChange={(event) => setPreviewLanguage(event.target.value)}
                sx={{ minWidth: 150 }}
              >
                {(options?.languages ?? []).map((language) => (
                  <MenuItem key={language.code} value={language.code}>
                    {language.label}
                  </MenuItem>
                ))}
              </TextField>
              <Button size="small" startIcon={<RefreshIcon />} onClick={() => void refreshPreview()} disabled={previewing}>
                {t('newsletters.editor.refresh')}
              </Button>
            </Stack>
            <Typography variant="caption" color="text.secondary" component="p" sx={{ mb: 1 }}>
              {t('newsletters.editor.previewHelp')}
            </Typography>
            {preview ? (
              <>
                <Typography variant="body2" sx={{ mb: 1 }}>
                  <strong>{t('newsletters.editor.subject')}:</strong> {preview.subject || '—'}
                </Typography>
                {/* An empty sandbox: the email's HTML runs no script and reaches nothing of this page. */}
                <Box
                  component="iframe"
                  title={t('newsletters.editor.preview')}
                  sandbox=""
                  srcDoc={preview.html}
                  sx={{
                    width: '100%',
                    height: 640,
                    border: 0,
                    borderRadius: 1,
                    bgcolor: '#f4f4f7',
                    opacity: previewing ? 0.5 : 1,
                  }}
                />
              </>
            ) : (
              <LinearProgress />
            )}
          </CardContent>
        </Card>
      </Box>

      <Dialog open={confirmSend} onClose={() => setConfirmSend(false)}>
        <DialogTitle>{t('newsletters.editor.confirmTitle')}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {editable
              ? t('newsletters.editor.confirmBody', { count: recipientCount, subject: subject.trim() })
              : t('newsletters.editor.confirmRetry', { subject: subject.trim() })}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmSend(false)}>{t('common.cancel')}</Button>
          <Button variant="contained" startIcon={<SendIcon />} onClick={() => void send()}>
            {t('newsletters.editor.sendNow')}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}
