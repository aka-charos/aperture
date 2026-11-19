/**
 * The problems you have reported, and the conversation on each.
 *
 * A thread is a report plus replies: the server splits the two, because the
 * backing service stores the reporter's own words as the thread's first
 * comment and rendering every comment uniformly would show the report twice.
 *
 * Lives in `components/` rather than beside My Requests so the admin view can
 * mount the same thing with `scope="all"` — the pattern the requests table
 * already uses.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link as RouterLink } from 'react-router-dom'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  Divider,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import {
  DEFAULT_ISSUE_LIST_CHOICE,
  ISSUE_KIND_FILTERS,
  ISSUE_SORTS,
  ISSUE_STATE_FILTERS,
  type IssueListChoice,
} from './issueListChoice'

export interface IssueComment {
  id: number
  message: string
  author: string | null
  createdAt: string
}

export interface Issue {
  id: number
  kind: 'video' | 'audio' | 'subtitles' | 'other'
  state: 'open' | 'resolved'
  mediaType: 'movie' | 'series'
  tmdbId: number
  description: string | null
  problemSeason: number | null
  problemEpisode: number | null
  reportedBy: string | null
  libraryMediaId: string | null
  libraryTitle: string | null
  comments: IssueComment[]
  createdAt: string
  updatedAt: string
}

interface MyIssuesPanelProps {
  /** 'all' asks for every user's issues; the server narrows it for non-admins. */
  scope?: 'mine' | 'all'
  /** The filter and order, held by the page so it outlives the tab. */
  choice?: IssueListChoice
  onChoiceChange?: (next: IssueListChoice) => void
}

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function IssueRow({
  issue,
  onReplied,
  onNotify,
}: {
  issue: Issue
  onReplied: () => void
  onNotify: (message: string, severity: 'success' | 'error') => void
}) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const [reply, setReply] = useState('')
  const [posting, setPosting] = useState(false)

  const title = issue.libraryTitle ?? t('myIssues.unknownTitle', { tmdbId: issue.tmdbId })
  const scope =
    issue.problemSeason == null
      ? null
      : issue.problemEpisode == null
        ? t('myIssues.scopeSeason', { season: issue.problemSeason })
        : t('myIssues.scopeEpisode', { season: issue.problemSeason, episode: issue.problemEpisode })

  const postReply = async () => {
    setPosting(true)
    try {
      const res = await fetch(`/api/issues/${issue.id}/comment`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: reply.trim() }),
      })
      const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string }
      if (!res.ok) throw new Error(body.message || body.error || t('myIssues.errorReply'))
      setReply('')
      onReplied()
    } catch (e) {
      onNotify(e instanceof Error ? e.message : t('myIssues.errorReply'), 'error')
    } finally {
      setPosting(false)
    }
  }

  return (
    <Paper variant="outlined" sx={{ borderRadius: 2, p: 2 }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1}
        alignItems={{ xs: 'stretch', sm: 'flex-start' }}
      >
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            {issue.libraryMediaId ? (
              <Typography
                component={RouterLink}
                to={
                  issue.mediaType === 'movie'
                    ? `/movies/${issue.libraryMediaId}`
                    : `/series/${issue.libraryMediaId}`
                }
                fontWeight={600}
                sx={{ color: 'inherit', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}
              >
                {title}
              </Typography>
            ) : (
              <Typography fontWeight={600}>{title}</Typography>
            )}
            <Chip size="small" variant="outlined" label={t(`reportIssue.kinds.${issue.kind}`)} />
            <Chip
              size="small"
              label={t(`myIssues.state.${issue.state}`)}
              color={issue.state === 'resolved' ? 'success' : 'warning'}
            />
            {scope && <Chip size="small" variant="outlined" label={scope} />}
          </Stack>

          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
            {issue.reportedBy
              ? t('myIssues.reportedByOn', { name: issue.reportedBy, date: formatDate(issue.createdAt) })
              : t('myIssues.reportedOn', { date: formatDate(issue.createdAt) })}
          </Typography>

          {issue.description && (
            <Typography variant="body2" sx={{ mt: 1, whiteSpace: 'pre-wrap' }}>
              {issue.description}
            </Typography>
          )}
        </Box>

        <Button
          size="small"
          onClick={() => setExpanded((v) => !v)}
          sx={{ alignSelf: 'flex-start' }}
          endIcon={expanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
        >
          {t('myIssues.replies', { count: issue.comments.length })}
        </Button>
      </Stack>

      <Collapse in={expanded} unmountOnExit>
        <Divider sx={{ my: 2 }} />
        <Stack spacing={1.5}>
          {issue.comments.length === 0 && (
            <Typography variant="body2" color="text.secondary">
              {t('myIssues.noReplies')}
            </Typography>
          )}
          {issue.comments.map((comment) => (
            <Box key={comment.id}>
              <Typography variant="caption" color="text.secondary">
                {comment.author ?? t('myIssues.unknownAuthor')} · {formatDate(comment.createdAt)}
              </Typography>
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                {comment.message}
              </Typography>
            </Box>
          ))}

          <Stack direction="row" spacing={1} alignItems="flex-start">
            <TextField
              size="small"
              fullWidth
              multiline
              minRows={1}
              placeholder={t('myIssues.replyPlaceholder')}
              value={reply}
              onChange={(e) => setReply(e.target.value)}
            />
            <Button
              variant="outlined"
              onClick={() => void postReply()}
              disabled={posting || reply.trim().length === 0}
            >
              {t('myIssues.reply')}
            </Button>
          </Stack>
        </Stack>
      </Collapse>
    </Paper>
  )
}

export function MyIssuesPanel({
  scope = 'mine',
  choice = DEFAULT_ISSUE_LIST_CHOICE,
  onChoiceChange,
}: MyIssuesPanelProps) {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage ?? i18n.language
  const [issues, setIssues] = useState<Issue[]>([])
  const [loading, setLoading] = useState(true)
  const [unavailable, setUnavailable] = useState(false)
  const [unlinked, setUnlinked] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ message: string; severity: 'success' | 'error' } | null>(null)
  const [truncated, setTruncated] = useState(false)
  const { state: stateFilter, kind: kindFilter, sort } = choice
  const filtersActive = stateFilter !== 'all' || kindFilter !== 'all'
  const change = (patch: Partial<IssueListChoice>) => onChoiceChange?.({ ...choice, ...patch })
  /**
   * Each load is numbered and only the newest may write: a list asked for an
   * earlier choice can finish after a later one and must not replace it.
   */
  const latestLoad = useRef(0)

  const load = useCallback(async () => {
    const thisLoad = ++latestLoad.current
    const current = () => thisLoad === latestLoad.current
    setLoading(true)
    setError(null)
    setUnavailable(false)
    try {
      const url = new URL('/api/issues', window.location.origin)
      if (scope === 'all') url.searchParams.set('scope', 'all')
      if (stateFilter !== 'all') url.searchParams.set('filter', stateFilter)
      if (kindFilter !== 'all') url.searchParams.set('kind', kindFilter)
      if (sort !== DEFAULT_ISSUE_LIST_CHOICE.sort) url.searchParams.set('sort', sort)
      if (lang) url.searchParams.set('lang', lang)
      const res = await fetch(url.toString(), { credentials: 'include' })
      if (!current()) return

      if (res.status === 503) {
        setIssues([])
        setUnavailable(true)
        return
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string }
        throw new Error(body.message || body.error || t('myIssues.errorLoad'))
      }

      const data = (await res.json()) as { issues?: Issue[]; unlinked?: boolean; truncated?: boolean }
      if (!current()) return
      setIssues(data.issues ?? [])
      setUnlinked(data.unlinked === true)
      setTruncated(data.truncated === true)
    } catch (e) {
      if (!current()) return
      setIssues([])
      setError(e instanceof Error ? e.message : t('myIssues.errorLoad'))
    } finally {
      if (current()) setLoading(false)
    }
  }, [scope, stateFilter, kindFilter, sort, lang, t])

  useEffect(() => {
    void load()
  }, [load])

  // Kept up while loading, so changing a filter does not make the controls jump away.
  const controls = !unavailable && !unlinked && (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
      <FormControl size="small" sx={{ minWidth: 180 }}>
        <InputLabel id="issue-state-filter">{t('myIssues.filters.status')}</InputLabel>
        <Select
          labelId="issue-state-filter"
          label={t('myIssues.filters.status')}
          value={stateFilter}
          onChange={(e) => change({ state: e.target.value as IssueListChoice['state'] })}
        >
          {ISSUE_STATE_FILTERS.map((f) => (
            <MenuItem key={f} value={f}>
              {f === 'all' ? t('myIssues.filters.statusAll') : t(`myIssues.state.${f}`)}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      <FormControl size="small" sx={{ minWidth: 180 }}>
        <InputLabel id="issue-kind-filter">{t('myIssues.filters.kind')}</InputLabel>
        <Select
          labelId="issue-kind-filter"
          label={t('myIssues.filters.kind')}
          value={kindFilter}
          onChange={(e) => change({ kind: e.target.value as IssueListChoice['kind'] })}
        >
          {ISSUE_KIND_FILTERS.map((f) => (
            <MenuItem key={f} value={f}>
              {f === 'all' ? t('myIssues.filters.kindAll') : t(`reportIssue.kinds.${f}`)}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      <FormControl size="small" sx={{ minWidth: 200 }}>
        <InputLabel id="issue-sort">{t('myIssues.filters.sortBy')}</InputLabel>
        <Select
          labelId="issue-sort"
          label={t('myIssues.filters.sortBy')}
          value={sort}
          onChange={(e) => change({ sort: e.target.value as IssueListChoice['sort'] })}
        >
          {ISSUE_SORTS.map((option) => (
            <MenuItem key={option} value={option}>
              {t(`myIssues.sort.${option}`)}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
    </Stack>
  )

  if (loading) {
    return (
      <Stack spacing={2}>
        {controls}
        <Box display="flex" justifyContent="center" py={6}>
          <CircularProgress />
        </Box>
      </Stack>
    )
  }

  return (
    <Stack spacing={2}>
      {controls}

      {notice && (
        <Alert severity={notice.severity} onClose={() => setNotice(null)}>
          {notice.message}
        </Alert>
      )}

      {/* Stated rather than rendered as an empty list: "nobody reported
          anything" and "reporting is switched off" look identical in a list
          and mean opposite things. */}
      {unavailable && <Alert severity="warning">{t('myIssues.unavailable')}</Alert>}

      {unlinked && !unavailable && <Alert severity="info">{t('myIssues.unlinked')}</Alert>}

      {error && (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {!unavailable && !unlinked && !error && issues.length === 0 && (
        <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
          {filtersActive ? t('myIssues.emptyFiltered') : t('myIssues.empty')}
        </Typography>
      )}

      {truncated && (
        <Typography variant="caption" color="text.secondary">
          {t('myIssues.truncated')}
        </Typography>
      )}

      {issues.map((issue) => (
        <IssueRow
          key={issue.id}
          issue={issue}
          onReplied={() => {
            setNotice({ message: t('myIssues.replyPosted'), severity: 'success' })
            void load()
          }}
          onNotify={(message, severity) => setNotice({ message, severity })}
        />
      ))}
    </Stack>
  )
}
