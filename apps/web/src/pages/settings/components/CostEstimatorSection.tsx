import React, { useMemo, useRef, useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Box,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  Stack,
  Tooltip,
  IconButton,
  Alert,
  Card,
  CardContent,
  CircularProgress,
  TextField,
} from '@mui/material'
import InfoIcon from '@mui/icons-material/Info'
import PaymentsIcon from '@mui/icons-material/Payments'
import StorageIcon from '@mui/icons-material/Storage'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome'
import ChatIcon from '@mui/icons-material/Chat'
import ComputerIcon from '@mui/icons-material/Computer'
import CloudIcon from '@mui/icons-material/Cloud'

// ============================================================================
// Types
// ============================================================================

interface FunctionPricing {
  provider: string
  providerName: string
  model: string
  modelName: string
  isLocalProvider: boolean
  inputCostPerMillion: number
  outputCostPerMillion: number
  embeddingDimensions?: number
  /**
   * False when no price list knows this model. The costs above are then 0 as a
   * placeholder — showing that as "$0.00" would claim the model is free, which
   * is how this estimator used to report every OpenRouter configuration.
   */
  pricingKnown?: boolean
}

interface AIPricing {
  embeddings: FunctionPricing | null
  chat: FunctionPricing | null
  textGeneration: FunctionPricing | null
  exploration: FunctionPricing | null
  webSearch: FunctionPricing | null
}

/** How to present a role's money: a real price, genuinely free, or unknown. */
type PriceState = 'priced' | 'local' | 'unknown'

function priceState(pricing: FunctionPricing | null | undefined): PriceState {
  if (!pricing) return 'unknown'
  if (pricing.isLocalProvider) return 'local'
  // pricingKnown is optional so an older API response degrades to the old
  // behaviour rather than marking every model unknown.
  return pricing.pricingKnown === false ? 'unknown' : 'priced'
}

interface UserEstimates {
  weeklyMoviesAdded: number
  weeklyShowsAdded: number
  weeklyEpisodesAdded: number
  weeklyChatMessagesPerUser: number
}

interface CostInputs {
  movie: {
    selectedCount: number
    runsPerWeek: number
    schedule: string
    enabledUsers: number
  }
  series: {
    selectedCount: number
    runsPerWeek: number
    schedule: string
    enabledUsers: number
  }
  embeddings?: {
    movie: {
      runsPerWeek: number
      schedule: string
      pendingItems: number
    }
    series: {
      runsPerWeek: number
      schedule: string
      pendingItems: number
      pendingEpisodes: number
    }
  }
  assistant?: {
    runsPerWeek: number
    schedule: string
    enabledUsers: number
  }
  library: {
    totalMovies: number
    totalSeries: number
    totalEpisodes: number
  }
  userEstimates: UserEstimates
}

// Token estimates per item type
const TOKENS_PER_MOVIE = 400
const TOKENS_PER_SERIES = 480 // Movies * 1.2
const TOKENS_PER_EPISODE = 240 // Movies * 0.6

// Text generation token estimates
const TEXT_GEN = {
  tasteSynopsis: { input: 1500, output: 200 },
  explanation: { input: 500, output: 80 },
  seriesExplanation: { input: 600, output: 80 },
  suggestion: { input: 300, output: 50 },
  chatMessage: { input: 2000, output: 500 },
}

// ============================================================================
// Category keys (map to settingsCostEstimator.categories.*)
// ============================================================================

type OneTimeCategoryKey = 'oneTimeMovies' | 'oneTimeSeries' | 'oneTimeEpisodes'
type WeeklyEmbCategoryKey = 'weeklyNewMovies' | 'weeklyNewShows' | 'weeklyNewEpisodes'
type TextGenCategoryKey =
  | 'movieTasteSynopses'
  | 'movieExplanations'
  | 'seriesTasteSynopses'
  | 'seriesExplanations'
  | 'assistantSuggestions'

// ============================================================================
// Component
// ============================================================================

export function CostEstimatorSection() {
  const { t } = useTranslation()
  const cat = (key: OneTimeCategoryKey | WeeklyEmbCategoryKey | TextGenCategoryKey) =>
    t(`settingsCostEstimator.categories.${key}`)

  const [costInputs, setCostInputs] = useState<CostInputs | null>(null)
  const [pricing, setPricing] = useState<AIPricing | null>(null)
  const [loading, setLoading] = useState(true)
  const [userEstimates, setUserEstimates] = useState<UserEstimates>({
    weeklyMoviesAdded: 5,
    weeklyShowsAdded: 3,
    weeklyEpisodesAdded: 20,
    weeklyChatMessagesPerUser: 50,
  })
  const [savingEstimates, setSavingEstimates] = useState(false)

  // Fetch cost inputs and pricing
  useEffect(() => {
    Promise.all([
      fetch('/api/settings/cost-inputs', { credentials: 'include' }).then((r) => r.json()),
      fetch('/api/settings/ai/pricing', { credentials: 'include' }).then((r) => r.json()),
    ])
      .then(([inputs, aiPricing]) => {
        setCostInputs(inputs)
        setPricing(aiPricing)
        if (inputs.userEstimates) {
          setUserEstimates(inputs.userEstimates)
        }
      })
      .catch((err) => {
        console.error('Failed to load cost estimation data:', err)
      })
      .finally(() => setLoading(false))
  }, [])

  // Debounced save of user estimates
  const saveUserEstimates = useCallback(async (estimates: UserEstimates) => {
    setSavingEstimates(true)
    try {
      await fetch('/api/settings/cost-inputs/estimates', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(estimates),
      })
    } catch (err) {
      console.error('Failed to save user estimates:', err)
    } finally {
      setSavingEstimates(false)
    }
  }, [])

  // Handle estimate change with debounce.
  //
  // The timer id lives in a ref, not in a returned cleanup function: an event
  // handler's return value is discarded, so the previous version scheduled a
  // fresh PATCH on every keystroke and cancelled none of them.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleEstimateChange = useCallback(
    (field: keyof UserEstimates) => (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = Math.max(0, parseInt(e.target.value, 10) || 0)
      const newEstimates = { ...userEstimates, [field]: value }
      setUserEstimates(newEstimates)
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => saveUserEstimates(newEstimates), 1000)
    },
    [userEstimates, saveUserEstimates]
  )

  // Don't leave a pending save behind when the tab is switched away.
  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
  }, [])

  // Calculate embedding cost for a given number of items and tokens
  const calculateEmbeddingCost = useCallback(
    (items: number, tokensPerItem: number): number => {
      if (!pricing?.embeddings || pricing.embeddings.isLocalProvider) return 0
      const tokens = items * tokensPerItem
      return (tokens / 1_000_000) * pricing.embeddings.inputCostPerMillion
    },
    [pricing]
  )

  // Calculate text generation cost
  const calculateTextGenCost = useCallback(
    (calls: number, inputTokensPerCall: number, outputTokensPerCall: number): number => {
      if (!pricing?.textGeneration || pricing.textGeneration.isLocalProvider) return 0
      const inputTokens = calls * inputTokensPerCall
      const outputTokens = calls * outputTokensPerCall
      return (
        (inputTokens / 1_000_000) * pricing.textGeneration.inputCostPerMillion +
        (outputTokens / 1_000_000) * pricing.textGeneration.outputCostPerMillion
      )
    },
    [pricing]
  )

  // Calculate chat cost
  const calculateChatCost = useCallback(
    (messages: number): number => {
      if (!pricing?.chat || pricing.chat.isLocalProvider) return 0
      return (
        (messages * TEXT_GEN.chatMessage.input / 1_000_000) * pricing.chat.inputCostPerMillion +
        (messages * TEXT_GEN.chatMessage.output / 1_000_000) * pricing.chat.outputCostPerMillion
      )
    },
    [pricing]
  )

  // One-time embedding costs — for what is still UNEMBEDDED, not for the whole
  // library. The API already reports the pending counts; billing the totals
  // instead quoted the full initial cost forever, including on an installation
  // that finished embedding months ago. Falls back to the totals only when the
  // pending figures are absent (an older API).
  const oneTimeCosts = useMemo(() => {
    if (!costInputs?.library || !pricing?.embeddings) return []

    const pending = costInputs.embeddings
    const pendingMovies = pending?.movie.pendingItems ?? costInputs.library.totalMovies
    const pendingSeries = pending?.series.pendingItems ?? costInputs.library.totalSeries
    const pendingEpisodes = pending?.series.pendingEpisodes ?? costInputs.library.totalEpisodes

    const items: Array<{ categoryKey: OneTimeCategoryKey; count: number; cost: number }> = []

    if (pendingMovies > 0) {
      items.push({
        categoryKey: 'oneTimeMovies',
        count: pendingMovies,
        cost: calculateEmbeddingCost(pendingMovies, TOKENS_PER_MOVIE),
      })
    }

    if (pendingSeries > 0) {
      items.push({
        categoryKey: 'oneTimeSeries',
        count: pendingSeries,
        cost: calculateEmbeddingCost(pendingSeries, TOKENS_PER_SERIES),
      })
    }

    if (pendingEpisodes > 0) {
      items.push({
        categoryKey: 'oneTimeEpisodes',
        count: pendingEpisodes,
        cost: calculateEmbeddingCost(pendingEpisodes, TOKENS_PER_EPISODE),
      })
    }

    return items
  }, [costInputs, pricing, calculateEmbeddingCost])

  // Recurring weekly embedding costs (new content)
  const weeklyEmbeddingCosts = useMemo(() => {
    if (!pricing?.embeddings) return []

    const items: Array<{ categoryKey: WeeklyEmbCategoryKey; count: number; cost: number }> = []

    if (userEstimates.weeklyMoviesAdded > 0) {
      items.push({
        categoryKey: 'weeklyNewMovies',
        count: userEstimates.weeklyMoviesAdded,
        cost: calculateEmbeddingCost(userEstimates.weeklyMoviesAdded, TOKENS_PER_MOVIE),
      })
    }

    if (userEstimates.weeklyShowsAdded > 0) {
      items.push({
        categoryKey: 'weeklyNewShows',
        count: userEstimates.weeklyShowsAdded,
        cost: calculateEmbeddingCost(userEstimates.weeklyShowsAdded, TOKENS_PER_SERIES),
      })
    }

    if (userEstimates.weeklyEpisodesAdded > 0) {
      items.push({
        categoryKey: 'weeklyNewEpisodes',
        count: userEstimates.weeklyEpisodesAdded,
        cost: calculateEmbeddingCost(userEstimates.weeklyEpisodesAdded, TOKENS_PER_EPISODE),
      })
    }

    return items
  }, [pricing, userEstimates, calculateEmbeddingCost])

  // Recurring text generation costs
  const weeklyTextGenCosts = useMemo(() => {
    if (!costInputs || !pricing?.textGeneration) return []

    const items: Array<{ categoryKey: TextGenCategoryKey; calls: number; cost: number }> = []

    // Movie taste synopses
    if (costInputs.movie.enabledUsers > 0 && costInputs.movie.runsPerWeek > 0) {
      const tasteCalls = costInputs.movie.enabledUsers * costInputs.movie.runsPerWeek
      items.push({
        categoryKey: 'movieTasteSynopses',
        calls: tasteCalls,
        cost: calculateTextGenCost(tasteCalls, TEXT_GEN.tasteSynopsis.input, TEXT_GEN.tasteSynopsis.output),
      })

      // Movie explanations
      const expCalls = costInputs.movie.selectedCount * costInputs.movie.enabledUsers * costInputs.movie.runsPerWeek
      items.push({
        categoryKey: 'movieExplanations',
        calls: expCalls,
        cost: calculateTextGenCost(expCalls, TEXT_GEN.explanation.input, TEXT_GEN.explanation.output),
      })
    }

    // Series taste synopses
    if (costInputs.series.enabledUsers > 0 && costInputs.series.runsPerWeek > 0) {
      const tasteCalls = costInputs.series.enabledUsers * costInputs.series.runsPerWeek
      items.push({
        categoryKey: 'seriesTasteSynopses',
        calls: tasteCalls,
        cost: calculateTextGenCost(tasteCalls, TEXT_GEN.tasteSynopsis.input, TEXT_GEN.tasteSynopsis.output),
      })

      // Series explanations
      const expCalls = costInputs.series.selectedCount * costInputs.series.enabledUsers * costInputs.series.runsPerWeek
      items.push({
        categoryKey: 'seriesExplanations',
        calls: expCalls,
        cost: calculateTextGenCost(expCalls, TEXT_GEN.seriesExplanation.input, TEXT_GEN.seriesExplanation.output),
      })
    }

    // Assistant suggestions
    if (costInputs.assistant && costInputs.assistant.enabledUsers > 0 && costInputs.assistant.runsPerWeek > 0) {
      const suggestionCalls = 5 * costInputs.assistant.enabledUsers * costInputs.assistant.runsPerWeek
      items.push({
        categoryKey: 'assistantSuggestions',
        calls: suggestionCalls,
        cost: calculateTextGenCost(suggestionCalls, TEXT_GEN.suggestion.input, TEXT_GEN.suggestion.output),
      })
    }

    return items
  }, [costInputs, pricing, calculateTextGenCost])

  // Weekly chat costs
  const weeklyChatCost = useMemo(() => {
    if (!costInputs || !pricing?.chat) return 0
    const totalUsers = Math.max(costInputs.movie.enabledUsers, costInputs.series.enabledUsers, 1)
    const totalMessages = userEstimates.weeklyChatMessagesPerUser * totalUsers
    return calculateChatCost(totalMessages)
  }, [costInputs, pricing, userEstimates, calculateChatCost])

  // Totals
  const totalOneTimeCost = oneTimeCosts.reduce((sum, item) => sum + item.cost, 0)
  const totalWeeklyEmbeddingCost = weeklyEmbeddingCosts.reduce((sum, item) => sum + item.cost, 0)
  const totalWeeklyTextGenCost = weeklyTextGenCosts.reduce((sum, item) => sum + item.cost, 0)
  const totalWeeklyCost = totalWeeklyEmbeddingCost + totalWeeklyTextGenCost + weeklyChatCost
  const totalMonthlyCost = totalWeeklyCost * 4.33

  const totalEnabledUsers = costInputs
    ? Math.max(costInputs.movie.enabledUsers, costInputs.series.enabledUsers, 1)
    : 1

  const isAnyLocalProvider =
    pricing?.embeddings?.isLocalProvider ||
    pricing?.chat?.isLocalProvider ||
    pricing?.textGeneration?.isLocalProvider

  // Every role that has a model configured, in the order they're worth reading.
  const configuredRoles = useMemo(() => {
    const roles: Array<{ key: keyof AIPricing; labelKey: string }> = [
      { key: 'embeddings', labelKey: 'fnEmbeddings' },
      { key: 'textGeneration', labelKey: 'fnTextGeneration' },
      { key: 'chat', labelKey: 'fnChat' },
      { key: 'exploration', labelKey: 'fnExploration' },
      { key: 'webSearch', labelKey: 'fnWebSearch' },
    ]
    return roles.flatMap(({ key, labelKey }) => {
      const rolePricing = pricing?.[key]
      if (!rolePricing) return []
      return [
        {
          key,
          label: t(`settingsCostEstimator.${labelKey}`),
          pricing: rolePricing,
          state: priceState(rolePricing),
        },
      ]
    })
  }, [pricing, t])

  // Roles whose model nobody could price. Their rows read "unknown", and the
  // headline totals get a caveat — an estimate missing a priced model is an
  // undercount, not a bargain.
  const unpricedRoles = configuredRoles.filter((r) => r.state === 'unknown')

  /**
   * Render a money cell for a row funded by `rolePricing`: the amount, a "local"
   * chip when the provider is free, or a dash when the price is unknown.
   */
  const renderCost = (rolePricing: FunctionPricing | null | undefined, cost: number, digits: number) => {
    const state = priceState(rolePricing)
    if (state === 'local') {
      return <Chip label={t('settingsCostEstimator.chipLocal')} size="small" color="success" variant="outlined" />
    }
    if (state === 'unknown') {
      return (
        <Tooltip title={t('settingsCostEstimator.priceUnknownTooltip')}>
          <Typography variant="body2" color="text.secondary" component="span">
            —
          </Typography>
        </Tooltip>
      )
    }
    return `$${cost.toFixed(digits)}`
  }

  // Loading state
  if (loading) {
    return (
      <Card sx={{ p: 3, textAlign: 'center' }}>
        <CircularProgress size={24} />
        <Typography variant="body2" sx={{ mt: 1 }}>
          {t('settingsCostEstimator.loading')}
        </Typography>
      </Card>
    )
  }

  // No pricing configured
  if (!pricing || (!pricing.embeddings && !pricing.chat && !pricing.textGeneration)) {
    return (
      <Card sx={{ p: 3 }}>
        <Alert severity="info">
          {t('settingsCostEstimator.configureFirst')}
        </Alert>
      </Card>
    )
  }

  return (
    <Card sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <PaymentsIcon color="primary" />
        <Typography variant="h6" fontWeight={600}>
          {t('settingsCostEstimator.title')}
        </Typography>
        <Tooltip title={t('settingsCostEstimator.tooltip')}>
          <IconButton size="small">
            <InfoIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        {savingEstimates && <CircularProgress size={16} />}
      </Box>

      {/* Provider Configuration Summary */}
      <Card variant="outlined" sx={{ mb: 3, bgcolor: 'action.hover' }}>
        <CardContent sx={{ py: 2 }}>
          <Typography variant="subtitle2" fontWeight={600} gutterBottom>
            {t('settingsCostEstimator.yourConfig')}
          </Typography>
          {/* Every configured role, not just the three that get cost rows below —
              exploration and Web Search spend money too, and omitting them from
              the summary made the configuration look cheaper than it is. */}
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
              gap: 2,
            }}
          >
            {configuredRoles.map(({ key, label, pricing: rolePricing, state }) => (
              <Box key={key} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                {state === 'local' ? (
                  <ComputerIcon fontSize="small" color="success" />
                ) : (
                  <CloudIcon fontSize="small" color={state === 'unknown' ? 'disabled' : 'primary'} />
                )}
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    {label}
                  </Typography>
                  <Typography variant="body2">
                    {rolePricing.providerName} / {rolePricing.modelName}
                  </Typography>
                  <Typography
                    variant="caption"
                    color={
                      state === 'local'
                        ? 'success.main'
                        : state === 'unknown'
                          ? 'warning.main'
                          : 'text.secondary'
                    }
                  >
                    {state === 'local'
                      ? t('settingsCostEstimator.localFree')
                      : state === 'unknown'
                        ? t('settingsCostEstimator.priceUnknown')
                        : key === 'embeddings'
                          ? t('settingsCostEstimator.embedPricePerM', {
                              price: `$${rolePricing.inputCostPerMillion}`,
                            })
                          : t('settingsCostEstimator.textGenPricePerM', {
                              input: `$${rolePricing.inputCostPerMillion}`,
                              output: `$${rolePricing.outputCostPerMillion}`,
                            })}
                  </Typography>
                </Box>
              </Box>
            ))}
          </Box>
        </CardContent>
      </Card>

      {/* User Estimates Input */}
      <Card variant="outlined" sx={{ mb: 3 }}>
        <CardContent sx={{ py: 2 }}>
          <Typography variant="subtitle2" fontWeight={600} gutterBottom>
            {t('settingsCostEstimator.weeklyGrowth')}
          </Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: '1fr 1fr 1fr 1fr' }, gap: 2 }}>
            <TextField
              label={t('settingsCostEstimator.labelMoviesPerWk')}
              type="number"
              size="small"
              value={userEstimates.weeklyMoviesAdded}
              onChange={handleEstimateChange('weeklyMoviesAdded')}
              InputProps={{ inputProps: { min: 0 } }}
            />
            <TextField
              label={t('settingsCostEstimator.labelShowsPerWk')}
              type="number"
              size="small"
              value={userEstimates.weeklyShowsAdded}
              onChange={handleEstimateChange('weeklyShowsAdded')}
              InputProps={{ inputProps: { min: 0 } }}
            />
            <TextField
              label={t('settingsCostEstimator.labelEpisodesPerWk')}
              type="number"
              size="small"
              value={userEstimates.weeklyEpisodesAdded}
              onChange={handleEstimateChange('weeklyEpisodesAdded')}
              InputProps={{ inputProps: { min: 0 } }}
            />
            <TextField
              label={t('settingsCostEstimator.labelChatPerUserWk')}
              type="number"
              size="small"
              value={userEstimates.weeklyChatMessagesPerUser}
              onChange={handleEstimateChange('weeklyChatMessagesPerUser')}
              InputProps={{ inputProps: { min: 0 } }}
            />
          </Box>
        </CardContent>
      </Card>

      {/* Local Provider Note */}
      {isAnyLocalProvider && (
        <Alert severity="success" sx={{ mb: 3 }}>
          <Typography variant="body2">
            <strong>{t('settingsCostEstimator.localNoteTitle')}</strong> {t('settingsCostEstimator.localNoteBody')}
          </Typography>
        </Alert>
      )}

      {/* An unpriced model makes every total below an undercount. Say so — the
          alternative is a confident $0.00 that reads as "this is free". */}
      {unpricedRoles.length > 0 && (
        <Alert severity="warning" sx={{ mb: 3 }}>
          <Typography variant="body2">
            <strong>{t('settingsCostEstimator.unpricedTitle')}</strong>{' '}
            {t('settingsCostEstimator.unpricedBody', {
              models: unpricedRoles.map((r) => r.pricing.modelName).join(', '),
            })}
          </Typography>
        </Alert>
      )}

      {/* Cost Breakdown */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' }, gap: 3, mb: 3 }}>
        {/* One-Time Costs */}
        <Card variant="outlined">
          <CardContent>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
              <StorageIcon color="primary" fontSize="small" />
              <Typography variant="subtitle1" fontWeight={600}>
                {t('settingsCostEstimator.initialCosts')}
              </Typography>
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
              {t('settingsCostEstimator.initialCaptionPending', {
                movies: costInputs?.library.totalMovies.toLocaleString() ?? '0',
                series: costInputs?.library.totalSeries.toLocaleString() ?? '0',
                episodes: costInputs?.library.totalEpisodes.toLocaleString() ?? '0',
              })}
            </Typography>

            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{t('settingsCostEstimator.colType')}</TableCell>
                    <TableCell align="right">{t('settingsCostEstimator.colItems')}</TableCell>
                    <TableCell align="right">{t('settingsCostEstimator.colCost')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {oneTimeCosts.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={3}>
                        <Typography variant="body2" color="text.secondary" textAlign="center">
                          {/* Nothing pending means the library is fully embedded —
                              a different thing from having no embeddings set up. */}
                          {pricing?.embeddings
                            ? t('settingsCostEstimator.allEmbedded')
                            : t('settingsCostEstimator.noEmbeddingsConfigured')}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ) : (
                    oneTimeCosts.map((item) => (
                      <TableRow key={item.categoryKey}>
                        <TableCell>{cat(item.categoryKey)}</TableCell>
                        <TableCell align="right">{item.count.toLocaleString()}</TableCell>
                        <TableCell align="right">
                          {renderCost(pricing?.embeddings, item.cost, 2)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                  <TableRow>
                    <TableCell colSpan={2}>
                      <Typography variant="body2" fontWeight={600}>
                        {t('settingsCostEstimator.total')}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Chip
                        label={
                          priceState(pricing?.embeddings) === 'local'
                            ? '$0.00'
                            : priceState(pricing?.embeddings) === 'unknown'
                              ? t('settingsCostEstimator.priceUnknownShort')
                              : `$${totalOneTimeCost.toFixed(2)}`
                        }
                        color={priceState(pricing?.embeddings) === 'local' ? 'success' : 'primary'}
                        size="small"
                        sx={{ fontWeight: 600 }}
                      />
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </TableContainer>
          </CardContent>
        </Card>

        {/* Recurring Costs */}
        <Card variant="outlined">
          <CardContent>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
              <AutoAwesomeIcon color="secondary" fontSize="small" />
              <Typography variant="subtitle1" fontWeight={600}>
                {t('settingsCostEstimator.recurringTitle')}
              </Typography>
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
              {t('settingsCostEstimator.recurringCaption')}
            </Typography>

            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{t('settingsCostEstimator.colType')}</TableCell>
                    <TableCell align="right">{t('settingsCostEstimator.colCallsPerWk')}</TableCell>
                    <TableCell align="right">{t('settingsCostEstimator.colCostPerWk')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {/* Weekly embedding costs */}
                  {weeklyEmbeddingCosts.map((item) => (
                    <TableRow key={item.categoryKey}>
                      <TableCell>{cat(item.categoryKey)}</TableCell>
                      <TableCell align="right">{item.count}</TableCell>
                      <TableCell align="right">
                        {renderCost(pricing?.embeddings, item.cost, 4)}
                      </TableCell>
                    </TableRow>
                  ))}

                  {/* Text generation costs */}
                  {weeklyTextGenCosts.map((item) => (
                    <TableRow key={item.categoryKey}>
                      <TableCell>{cat(item.categoryKey)}</TableCell>
                      <TableCell align="right">{item.calls.toLocaleString()}</TableCell>
                      <TableCell align="right">
                        {renderCost(pricing?.textGeneration, item.cost, 4)}
                      </TableCell>
                    </TableRow>
                  ))}

                  {/* Chat costs */}
                  {pricing?.chat && (
                    <TableRow>
                      <TableCell>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          <ChatIcon fontSize="small" />
                          {t('settingsCostEstimator.chatAssistant')}
                        </Box>
                      </TableCell>
                      <TableCell align="right">
                        {t('settingsCostEstimator.chatMsgs', {
                          count: userEstimates.weeklyChatMessagesPerUser * totalEnabledUsers,
                        })}
                      </TableCell>
                      <TableCell align="right">
                        {renderCost(pricing.chat, weeklyChatCost, 4)}
                      </TableCell>
                    </TableRow>
                  )}

                  <TableRow>
                    <TableCell colSpan={2}>
                      <Typography variant="body2" fontWeight={600}>
                        {t('settingsCostEstimator.totalWeekly')}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Chip
                        label={`$${totalWeeklyCost.toFixed(4)}`}
                        color="secondary"
                        size="small"
                        sx={{ fontWeight: 600 }}
                      />
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </TableContainer>
          </CardContent>
        </Card>
      </Box>

      {/* Summary */}
      <Card sx={{ p: 2, bgcolor: 'action.hover', borderRadius: 2 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={3} justifyContent="space-around">
          <Box textAlign="center">
            <Typography variant="caption" color="text.secondary">
              {t('settingsCostEstimator.summaryInitial')}
            </Typography>
            <Typography variant="h5" fontWeight={700} color="primary.main">
              ${totalOneTimeCost.toFixed(2)}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {t('settingsCostEstimator.summaryOneTime')}
            </Typography>
          </Box>
          <Box textAlign="center">
            <Typography variant="caption" color="text.secondary">
              {t('settingsCostEstimator.summaryWeekly')}
            </Typography>
            <Typography variant="h5" fontWeight={700} color="secondary.main">
              ${totalWeeklyCost.toFixed(4)}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {t('settingsCostEstimator.summaryForUsers', { count: totalEnabledUsers })}
            </Typography>
          </Box>
          <Box textAlign="center">
            <Typography variant="caption" color="text.secondary">
              {t('settingsCostEstimator.summaryMonthly')}
            </Typography>
            <Typography variant="h5" fontWeight={700} color="success.main">
              ${totalMonthlyCost.toFixed(2)}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {t('settingsCostEstimator.summaryWeeksApprox')}
            </Typography>
          </Box>
        </Stack>
      </Card>
    </Card>
  )
}
