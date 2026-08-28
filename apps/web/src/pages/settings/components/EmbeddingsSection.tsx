/**
 * Everything about the embedding tables: which sets this instance holds, and
 * whether episodes are embedded at all.
 *
 * Lifted out of `AISetupSection`, which had grown into four unrelated panels
 * stacked behind one tab — the provider roles, these two, the spend dashboard
 * and the cost estimator. Each is now its own route, so a page is one subject.
 * The components below are unchanged; only their address is new.
 */
import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Box,
  Typography,
  Card,
  CardContent,
  CircularProgress,
  Chip,
  Alert,
  AlertTitle,
  IconButton,
  Switch,
  FormControlLabel,
  Button,
  alpha,
} from '@mui/material'
import {
  Delete as DeleteIcon,
  Storage as StorageIcon,
  LiveTv as LiveTvIcon,
} from '@mui/icons-material'

interface EmbeddingSetPending {
  movies: number
  series: number
  episodes: number
  total: number
}

interface EmbeddingSet {
  model: string
  dimensions: number
  movieCount: number
  seriesCount: number
  episodeCount: number
  totalCount: number
  isActive: boolean
  /** ISO. When the oldest row was first written; null for an empty set. */
  firstGeneratedAt: string | null
  /** ISO. Most recent write; null for an empty set. */
  lastGeneratedAt: string | null
  /** Null when the API could not measure it — render as unknown, never as zero. */
  pending: EmbeddingSetPending | null
  /** Decided by the API. The bundle never holds the rule, only the colour. */
  status: 'ready' | 'incomplete' | 'empty' | 'unknown'
}

interface EmbeddingSetsReport {
  sets: EmbeddingSet[]
  activeModel: string | null
  activeDimensions: number | null
  episodeEmbeddingsEnabled: boolean
  library: { movies: number; series: number; episodes: number }
}

const SET_STATUS_COLOR: Record<EmbeddingSet['status'], 'success' | 'warning' | 'default'> = {
  ready: 'success',
  incomplete: 'warning',
  empty: 'default',
  unknown: 'default',
}

/**
 * What this instance holds per embedding model, and what switching would cost.
 *
 * Embedding rows are keyed by model, every read filters on it, and nothing is
 * ever deleted implicitly — so the old set survives a model change and a switch
 * back reuses it. All of that is invisible at the dropdown, which is where the
 * decision is actually made.
 *
 * The panel used to hide itself unless a *second* set already existed
 * (`sets.length <= 1`), which is precisely backwards: it appeared only after
 * the admin had committed to the switch it was meant to inform. It now renders
 * whenever anything is stored or a model is configured.
 *
 * `status` and `pending` are computed server-side. A row count cannot answer
 * "is this set ready" on its own — a fully populated set still needs work when
 * CANONICAL_TEXT_VERSION moves or titles were re-enriched — and the rule that
 * decides it lives in core, which this bundle must never import.
 */
function EmbeddingSetsManager() {
  const { t } = useTranslation()
  const [report, setReport] = useState<EmbeddingSetsReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fetchSets = useCallback(async () => {
    try {
      const res = await fetch('/api/settings/ai/embeddings/sets', { credentials: 'include' })
      if (res.ok) {
        const data = await res.json()
        setReport(data)
      }
    } catch {
      // Ignore
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchSets()
  }, [fetchSets])

  const handleDelete = async (set: EmbeddingSet) => {
    if (!confirm(t('settingsAiSetup.confirmDeleteSet', { model: set.model }))) {
      return
    }

    const key = `${set.model}|${set.dimensions}`
    setDeleting(key)
    setError(null)
    try {
      const res = await fetch(
        `/api/settings/ai/embeddings/sets/${encodeURIComponent(set.model)}?dimensions=${set.dimensions}`,
        { method: 'DELETE', credentials: 'include' }
      )
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || t('settingsAiSetup.deleteFailed'))
      }
      fetchSets()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('settingsAiSetup.deleteSetError'))
    } finally {
      setDeleting(null)
    }
  }

  if (loading) {
    return null
  }

  // Nothing configured and nothing stored — there is no decision to inform.
  if (!report || (report.sets.length === 0 && !report.activeModel)) {
    return null
  }

  const activeSet = report.sets.find((s) => s.isActive) ?? null
  const activeNeedsWork =
    activeSet != null && (activeSet.status === 'incomplete' || activeSet.status === 'empty')

  /**
   * When the set was written. A single date when it was generated in one pass,
   * a range when the job has been back since — which is the honest shape, given
   * new arrivals get embedded into an existing set as they sync.
   */
  const generatedLabel = (set: EmbeddingSet): string | null => {
    if (!set.firstGeneratedAt) return null
    const first = new Date(set.firstGeneratedAt)
    const last = set.lastGeneratedAt ? new Date(set.lastGeneratedAt) : first
    const firstText = first.toLocaleDateString()
    const lastText = last.toLocaleDateString()
    return firstText === lastText
      ? t('settingsAiSetup.generatedOn', { date: firstText })
      : t('settingsAiSetup.generatedRange', { first: firstText, last: lastText })
  }

  const statusLabel = (set: EmbeddingSet): string => {
    if (set.status === 'ready') return t('settingsAiSetup.setReady')
    if (set.status === 'empty') return t('settingsAiSetup.setEmpty')
    if (set.status === 'unknown') return t('settingsAiSetup.setUnknown')
    // No `count` key: passing one sends i18next down the plural-resolution path
    // for a string that has no plural forms defined.
    return t('settingsAiSetup.setPending', {
      formatted: (set.pending?.total ?? 0).toLocaleString(),
    })
  }

  return (
    <Card sx={{ mt: 3 }}>
      <CardContent>
        <Box display="flex" alignItems="center" gap={1} mb={2}>
          <StorageIcon color="primary" />
          <Typography variant="h6">{t('settingsAiSetup.embeddingSetsTitle')}</Typography>
          {/* `total`, not `count`: a `count` key sends i18next into plural
              resolution, and 15 locales with different plural rules would each
              need their own forms for a chip that is just a number. */}
          <Chip
            size="small"
            label={t('settingsAiSetup.setsCount', { total: report.sets.length })}
            sx={{ ml: 'auto' }}
          />
        </Box>

        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t('settingsAiSetup.embeddingSetsBody')}
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {report.sets.map((set) => {
            const key = `${set.model}|${set.dimensions}`
            return (
              <Box
                key={key}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 2,
                  p: 1.5,
                  borderRadius: 1,
                  bgcolor: set.isActive
                    ? (theme) => alpha(theme.palette.success.main, 0.1)
                    : 'background.default',
                  border: 1,
                  borderColor: set.isActive ? 'success.main' : 'divider',
                }}
              >
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
                    <Typography
                      variant="body2"
                      fontWeight={set.isActive ? 600 : 400}
                      sx={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {set.model}
                    </Typography>
                    {set.isActive && (
                      <Chip size="small" label={t('settingsAiSetup.chipActive')} color="success" />
                    )}
                    <Chip
                      size="small"
                      variant="outlined"
                      label={statusLabel(set)}
                      color={SET_STATUS_COLOR[set.status]}
                    />
                  </Box>
                  <Typography variant="caption" color="text.secondary" display="block">
                    {t('settingsAiSetup.statsLine', {
                      dimensions: set.dimensions,
                      movies: set.movieCount.toLocaleString(),
                      movieTotal: report.library.movies.toLocaleString(),
                      series: set.seriesCount.toLocaleString(),
                      seriesTotal: report.library.series.toLocaleString(),
                      episodes: set.episodeCount.toLocaleString(),
                    })}
                  </Typography>
                  {generatedLabel(set) && (
                    <Typography variant="caption" color="text.secondary" display="block">
                      {generatedLabel(set)}
                    </Typography>
                  )}
                  {set.status === 'incomplete' && set.pending && (
                    <Typography variant="caption" color="warning.main" display="block">
                      {t('settingsAiSetup.pendingBreakdown', {
                        movies: set.pending.movies.toLocaleString(),
                        series: set.pending.series.toLocaleString(),
                        episodes: set.pending.episodes.toLocaleString(),
                      })}
                    </Typography>
                  )}
                </Box>

                {!set.isActive && set.totalCount > 0 && (
                  <IconButton
                    size="small"
                    color="error"
                    onClick={() => handleDelete(set)}
                    disabled={deleting === key}
                    title={t('settingsAiSetup.deleteSetTooltip')}
                  >
                    {deleting === key ? (
                      <CircularProgress size={16} />
                    ) : (
                      <DeleteIcon fontSize="small" />
                    )}
                  </IconButton>
                )}
              </Box>
            )
          })}
        </Box>

        {/* The sequence after a model change. Rebuilding taste profiles is the
            step everyone misses: item vectors moving does not move a stored
            centroid, and the recommender keeps using the old one until the
            profile goes stale on its own — up to 30 days later. Centering runs
            before it because buildTasteProfile records which space it was built
            in. */}
        <Alert severity={activeNeedsWork ? 'warning' : 'info'} sx={{ mt: 2 }}>
          <AlertTitle>
            {activeNeedsWork
              ? t('settingsAiSetup.sequenceTitleNeeded')
              : t('settingsAiSetup.sequenceTitle')}
          </AlertTitle>
          <Typography variant="body2" sx={{ mb: 1 }}>
            {t('settingsAiSetup.sequenceIntro')}
          </Typography>
          <Box component="ol" sx={{ pl: 2.5, m: 0, '& li': { mb: 0.5 } }}>
            <Typography component="li" variant="body2">
              {t('settingsAiSetup.sequenceStepEmbeddings')}
            </Typography>
            <Typography component="li" variant="body2">
              {t('settingsAiSetup.sequenceStepCentering')}
            </Typography>
            <Typography component="li" variant="body2">
              {t('settingsAiSetup.sequenceStepProfiles')}
            </Typography>
            <Typography component="li" variant="body2">
              {t('settingsAiSetup.sequenceStepRecommendations')}
            </Typography>
          </Box>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
            {t('settingsAiSetup.sequenceNote')}
          </Typography>
        </Alert>
      </CardContent>
    </Card>
  )
}

interface EpisodeEmbeddingsState {
  enabled: boolean
  storedCount: number
  episodeCount: number
}

/**
 * Episode embeddings: the largest embedding table, and an optional one.
 *
 * One row per episode against one per show — on a mid-sized library that is
 * hundreds of megabytes and an embedding call for every episode that ever
 * arrives. What it buys is the assistant's episode search, the only thing that
 * can answer a question about what happens *inside* an episode. Both halves of
 * that trade are stated here because neither is obvious from the switch.
 *
 * Turning it off and deleting the rows are deliberately separate actions: the
 * first is free to reverse, the second costs a full re-embed.
 */
function EpisodeEmbeddingsCard() {
  const { t } = useTranslation()
  const [state, setState] = useState<EpisodeEmbeddingsState | null>(null)
  const [saving, setSaving] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchState = useCallback(async () => {
    try {
      const res = await fetch('/api/settings/ai/embeddings/episodes', { credentials: 'include' })
      if (res.ok) setState(await res.json())
    } catch {
      // Ignore — the card simply stays hidden.
    }
  }, [])

  useEffect(() => {
    fetchState()
  }, [fetchState])

  const handleToggle = async (enabled: boolean) => {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/settings/ai/embeddings/episodes', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ enabled }),
      })
      if (!res.ok) throw new Error(t('settingsAiSetup.episodeEmbeddingsSaveFailed'))
      await fetchState()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('settingsAiSetup.episodeEmbeddingsSaveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const handleClear = async () => {
    if (!confirm(t('settingsAiSetup.episodeEmbeddingsClearConfirm'))) return
    setClearing(true)
    setError(null)
    try {
      const res = await fetch('/api/settings/ai/embeddings/episodes/clear', {
        method: 'POST',
        credentials: 'include',
      })
      if (!res.ok) throw new Error(t('settingsAiSetup.episodeEmbeddingsClearFailed'))
      await fetchState()
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t('settingsAiSetup.episodeEmbeddingsClearFailed')
      )
    } finally {
      setClearing(false)
    }
  }

  // A library with no episodes has nothing to decide here.
  if (!state || state.episodeCount === 0) return null

  return (
    <Card sx={{ mt: 3 }}>
      <CardContent>
        <Box display="flex" alignItems="center" gap={1} mb={2}>
          <LiveTvIcon color="primary" />
          <Typography variant="h6">{t('settingsAiSetup.episodeEmbeddingsTitle')}</Typography>
        </Box>

        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t('settingsAiSetup.episodeEmbeddingsBody')}
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        <FormControlLabel
          control={
            <Switch
              checked={state.enabled}
              disabled={saving}
              onChange={(e) => handleToggle(e.target.checked)}
            />
          }
          label={t('settingsAiSetup.episodeEmbeddingsToggle')}
        />

        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
          {t('settingsAiSetup.episodeEmbeddingsStats', {
            stored: state.storedCount.toLocaleString(),
            total: state.episodeCount.toLocaleString(),
          })}
        </Typography>

        {!state.enabled && state.storedCount > 0 && (
          <Box sx={{ mt: 2 }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              {t('settingsAiSetup.episodeEmbeddingsClearBody')}
            </Typography>
            <Button
              size="small"
              color="error"
              variant="outlined"
              onClick={handleClear}
              disabled={clearing}
              startIcon={clearing ? <CircularProgress size={14} /> : <DeleteIcon />}
            >
              {t('settingsAiSetup.episodeEmbeddingsClear')}
            </Button>
          </Box>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * The route's whole content. Kept as a wrapper rather than exporting the two
 * cards separately, so the page cannot be assembled differently in two places.
 */
export function EmbeddingsSection() {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <EmbeddingSetsManager />
      <EpisodeEmbeddingsCard />
    </Box>
  )
}
