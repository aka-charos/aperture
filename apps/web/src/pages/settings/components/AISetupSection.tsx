/**
 * AI Setup Section - Card-based AI provider configuration for Admin Settings
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
  IconButton,
  Divider,
  alpha,
  Switch,
  FormControlLabel,
  Button,
} from '@mui/material'
import {
  Delete as DeleteIcon,
  Storage as StorageIcon,
  LiveTv as LiveTvIcon,
} from '@mui/icons-material'
import type { AIFunction } from '../../../components/AIFunctionCard'
import { AISetupCardGrid } from '../../../components/AISetupCardGrid'
import { type FunctionConfig } from '../../../components/aiProviderInfo'
import { CostEstimatorSection } from './CostEstimatorSection'
import { InferenceDashboardSection } from './InferenceDashboardSection'

interface AIConfig {
  embeddings: FunctionConfig | null
  chat: FunctionConfig | null
  textGeneration: FunctionConfig | null
  exploration: FunctionConfig | null
}

interface EmbeddingSet {
  model: string
  dimensions: number
  movieCount: number
  seriesCount: number
  episodeCount: number
  totalCount: number
  isActive: boolean
}

/**
 * Component to manage embedding sets - view and delete old embedding sets
 */
function EmbeddingSetsManager() {
  const { t } = useTranslation()
  const [sets, setSets] = useState<EmbeddingSet[]>([])
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fetchSets = useCallback(async () => {
    try {
      const res = await fetch('/api/settings/ai/embeddings/sets', { credentials: 'include' })
      if (res.ok) {
        const data = await res.json()
        setSets(data.sets || [])
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

  const handleDelete = async (model: string) => {
    if (!confirm(t('settingsAiSetup.confirmDeleteSet', { model }))) {
      return
    }

    setDeleting(model)
    setError(null)
    try {
      const res = await fetch(`/api/settings/ai/embeddings/sets/${encodeURIComponent(model)}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || t('settingsAiSetup.deleteFailed'))
      }
      // Refresh the list
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

  // Don't show if no sets or only one active set
  if (sets.length <= 1) {
    return null
  }

  const inactiveSets = sets.filter(s => !s.isActive)
  if (inactiveSets.length === 0) {
    return null
  }

  return (
    <Card sx={{ mt: 3 }}>
      <CardContent>
        <Box display="flex" alignItems="center" gap={1} mb={2}>
          <StorageIcon color="primary" />
          <Typography variant="h6">{t('settingsAiSetup.embeddingSetsTitle')}</Typography>
          <Chip 
            size="small" 
            label={t('settingsAiSetup.setsCount', { count: sets.length })} 
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
          {sets.map((set) => (
            <Box
              key={set.model}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 2,
                p: 1.5,
                borderRadius: 1,
                bgcolor: set.isActive ? alpha('#4caf50', 0.1) : 'background.default',
                border: 1,
                borderColor: set.isActive ? 'success.main' : 'divider',
              }}
            >
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Box display="flex" alignItems="center" gap={1}>
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
                </Box>
                <Typography variant="caption" color="text.secondary">
                  {t('settingsAiSetup.statsLine', {
                    dimensions: set.dimensions,
                    movies: set.movieCount.toLocaleString(),
                    series: set.seriesCount.toLocaleString(),
                    episodes: set.episodeCount.toLocaleString(),
                  })}
                </Typography>
              </Box>
              
              {!set.isActive && (
                <IconButton
                  size="small"
                  color="error"
                  onClick={() => handleDelete(set.model)}
                  disabled={deleting === set.model}
                  title={t('settingsAiSetup.deleteSetTooltip')}
                >
                  {deleting === set.model ? (
                    <CircularProgress size={16} />
                  ) : (
                    <DeleteIcon fontSize="small" />
                  )}
                </IconButton>
              )}
            </Box>
          ))}
        </Box>
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

export function AISetupSection() {
  const { t } = useTranslation()
  const [config, setConfig] = useState<AIConfig | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch('/api/settings/ai', { credentials: 'include' })
      if (res.ok) {
        const data = await res.json()
        setConfig(data.config)
      }
    } catch {
      // Ignore
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchConfig()
  }, [fetchConfig])

  const handleSave = async (fn: AIFunction, fnConfig: FunctionConfig) => {
    const res = await fetch(`/api/settings/ai/${fn}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(fnConfig),
    })
    if (!res.ok) {
      const err = await res.json()
      throw new Error(err.error || t('settingsAiSetup.saveFailed'))
    }
    // Refresh config
    fetchConfig()
  }

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" py={4}>
        <CircularProgress />
      </Box>
    )
  }

  return (
    <Box>
      {/* Header */}
      <Box mb={3}>
        <Typography variant="h5" fontWeight={600} gutterBottom>
          {t('settingsAiSetup.pageTitle')}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t('settingsAiSetup.pageSubtitle')}
        </Typography>
      </Box>

      <AISetupCardGrid config={config} onSave={handleSave} variant="settings" />

      {/* Episode embeddings: optional, and the largest table when on */}
      <EpisodeEmbeddingsCard />

      {/* Embedding Sets Manager */}
      <EmbeddingSetsManager />

      {/* What it actually cost (OpenRouter only — it's the one provider that
          reports per-call spend). Renders nothing otherwise, so the estimator
          below stays the whole story for everyone else. */}
      <Divider sx={{ my: 4 }} />
      <InferenceDashboardSection />

      {/* Cost Estimator */}
      <Divider sx={{ my: 4 }} />
      <CostEstimatorSection />
    </Box>
  )
}
