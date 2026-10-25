import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link as RouterLink, useSearchParams } from 'react-router-dom'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  IconButton,
  LinearProgress,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import GroupsIcon from '@mui/icons-material/Groups'
import { api, EMPTY_DOC, type Newsletter, type NewsletterGroup, type NewsletterOptions } from './api'
import { NewsletterEditor } from './NewsletterEditor'
import { StatusChip } from './StatusChip'

/**
 * The newsletters: a list, and one open in the editor. Which one is open is the
 * address (`?edit=<id>`), so Back closes it and a link reaches it.
 */
export default function NewslettersRoute() {
  const { t } = useTranslation()
  const [searchParams, setSearchParams] = useSearchParams()
  const editing = searchParams.get('edit')
  const [newsletters, setNewsletters] = useState<Newsletter[] | null>(null)
  const [groups, setGroups] = useState<NewsletterGroup[]>([])
  const [options, setOptions] = useState<NewsletterOptions | null>(null)
  const [error, setError] = useState<string | null>(null)

  const open = useCallback(
    (id: string | null) =>
      setSearchParams((prev) => {
        const params = new URLSearchParams(prev)
        if (id) params.set('edit', id)
        else params.delete('edit')
        return params
      }),
    [setSearchParams]
  )

  const load = useCallback(async () => {
    try {
      const [list, groupList] = await Promise.all([
        api<{ newsletters: Newsletter[] }>('/api/newsletters'),
        api<{ groups: NewsletterGroup[] }>('/api/newsletter-groups'),
      ])
      setNewsletters(list.newsletters)
      setGroups(groupList.groups)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  useEffect(() => {
    api<NewsletterOptions>('/api/newsletters/options')
      .then(setOptions)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
  }, [])

  useEffect(() => {
    if (!editing) void load()
  }, [editing, load])

  const create = async () => {
    try {
      const { newsletter } = await api<{ newsletter: Newsletter }>('/api/newsletters', {
        method: 'POST',
        json: { subject: '', preheader: '', content: EMPTY_DOC, groupIds: [] },
      })
      open(newsletter.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const remove = async (newsletter: Newsletter) => {
    if (!window.confirm(t('newsletters.list.confirmDelete', { subject: newsletter.subject || t('newsletters.list.untitled') }))) {
      return
    }
    try {
      await api(`/api/newsletters/${newsletter.id}`, { method: 'DELETE' })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  if (editing) {
    // The editor's field list and analysis parts are the server's; it waits for them.
    if (!options) return error ? <Alert severity="error">{error}</Alert> : <LinearProgress />
    return <NewsletterEditor id={editing} options={options} onBack={() => open(null)} onOpen={(id) => open(id)} />
  }

  const groupName = (id: string) => groups.find((g) => g.id === id)?.name ?? t('newsletters.list.deletedGroup')

  return (
    <Stack spacing={2}>
      {error && (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {options?.sendingProblemText && (
        <Alert severity="warning">{t('newsletters.editor.cannotSend', { reason: options.sendingProblemText })}</Alert>
      )}
      <Card variant="outlined">
        <CardContent>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }} flexWrap="wrap" useFlexGap>
            <Box sx={{ flex: 1, minWidth: 220 }}>
              <Typography variant="subtitle1" fontWeight={600}>
                {t('newsletters.list.title')}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t('newsletters.list.description')}
              </Typography>
            </Box>
            <Button component={RouterLink} to="/admin/communication/groups" startIcon={<GroupsIcon />}>
              {t('newsletters.list.manageGroups')}
            </Button>
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => void create()}>
              {t('newsletters.list.new')}
            </Button>
          </Stack>
          {!newsletters ? (
            <LinearProgress />
          ) : newsletters.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              {t('newsletters.list.empty')}
            </Typography>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('newsletters.editor.subject')}</TableCell>
                  <TableCell>{t('newsletters.editor.groups')}</TableCell>
                  <TableCell>{t('newsletters.list.status')}</TableCell>
                  <TableCell>{t('newsletters.list.updated')}</TableCell>
                  <TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {newsletters.map((newsletter) => (
                  <TableRow key={newsletter.id} hover sx={{ cursor: 'pointer' }} onClick={() => open(newsletter.id)}>
                    <TableCell>
                      <Typography variant="body2" fontWeight={600}>
                        {newsletter.subject || t('newsletters.list.untitled')}
                      </Typography>
                      {newsletter.createdByName && (
                        <Typography variant="caption" color="text.secondary">
                          {newsletter.createdByName}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>{newsletter.groupIds.map(groupName).join(', ') || '—'}</TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={1} alignItems="center">
                        <StatusChip status={newsletter.status} />
                        {newsletter.status !== 'draft' && (
                          <Typography variant="caption" color="text.secondary">
                            {t('newsletters.list.sentCount', {
                              sent: newsletter.sentCount,
                              total: newsletter.recipientCount ?? 0,
                            })}
                          </Typography>
                        )}
                      </Stack>
                    </TableCell>
                    <TableCell>{new Date(newsletter.updatedAt).toLocaleString()}</TableCell>
                    <TableCell align="right" onClick={(event) => event.stopPropagation()}>
                      {newsletter.status !== 'sending' && (
                        <Tooltip title={t('common.delete')}>
                          <IconButton size="small" onClick={() => void remove(newsletter)}>
                            <DeleteOutlineIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </Stack>
  )
}
