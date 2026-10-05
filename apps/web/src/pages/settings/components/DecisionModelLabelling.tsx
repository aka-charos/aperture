/**
 * Label the live disagreements: pairs from real recommendations where the
 * similarity threshold, the director-or-franchise rule and the decision model
 * do not all agree, judged by the operator.
 *
 * BLIND BY DESIGN. Each row shows the two titles and nothing else until it is
 * answered — a percentage on screen is an anchor, and a label given after
 * seeing one measures agreement with the model rather than the truth. The
 * default queue is ordered by a hash of the pair (server side) for the same
 * reason: any other order would leak a verdict through the position.
 *
 * Only disagreements are listed: where all three judges agree, a label cannot
 * tell them apart. Which judge is odd one out is also offered as a filter, for
 * reviewing a direction after labelling.
 *
 * Every verdict here is a decided value from the server (this bundle never
 * imports @aperture/core); the card only counts and colours them.
 */
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Paper,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'

type Label = 'yes' | 'no' | 'arguable'
type Filter = 'toLabel' | 'modelAlone' | 'thresholdAlone' | 'ruleAlone' | 'labelled'

const FILTERS: Filter[] = ['toLabel', 'modelAlone', 'thresholdAlone', 'ruleAlone', 'labelled']
const PAGE = 20

interface LabellingItem {
  key: string
  mediaType: 'movie' | 'series'
  pickId: string
  pickTitle: string
  pickYear: number | null
  watchedId: string
  watchedTitle: string
  watchedYear: number | null
  viewers: number
  similarity: number | null
  thresholdSays: boolean | null
  ruleSays: boolean | null
  ruleBasis: 'director' | 'franchise' | null
  modelP: number | null
  modelSays: boolean | null
  group: string
  label: Label | null
}

interface Tally {
  scored: number
  thresholdRight: number
  ruleRight: number
  modelRight: number
}

interface QueueSummary {
  counts: Record<Filter | 'unanimous', number>
  labelled: number
  arguable: number
  tally: Tally
  noSharedCreditsTally: Tally
}

const FILTER_KEYS: Record<Filter, string> = {
  toLabel: 'settingsDecisionModel.filterToLabel',
  modelAlone: 'settingsDecisionModel.filterModelAlone',
  thresholdAlone: 'settingsDecisionModel.filterThresholdAlone',
  ruleAlone: 'settingsDecisionModel.filterRuleAlone',
  labelled: 'settingsDecisionModel.filterLabelled',
}

const LABEL_KEYS: Record<Label, string> = {
  yes: 'settingsDecisionModel.labelYes',
  no: 'settingsDecisionModel.labelNo',
  arguable: 'settingsDecisionModel.labelArguable',
}

/** Green when a judge matches the label, red when not, grey for arguable or no answer. */
function verdictColor(says: boolean | null, label: Label | null): string {
  if (says == null || label == null || label === 'arguable') return 'text.secondary'
  return says === (label === 'yes') ? 'success.main' : 'error.main'
}

const withYear = (title: string, year: number | null) => (year != null ? `${title} (${year})` : title)

/**
 * How many rows on screen the server still counts in this filter. Labelling a
 * row takes it out of "to label" (and clearing one takes it out of
 * "labelled"), so paging by the rows on screen would skip as many unseen pairs
 * as had just been answered.
 */
function stillInFilter(filter: Filter, items: LabellingItem[]): number {
  if (filter === 'toLabel') return items.filter((i) => i.label == null).length
  if (filter === 'labelled') return items.filter((i) => i.label != null).length
  return items.length
}

export function DecisionModelLabelling() {
  const { t } = useTranslation()
  const [filter, setFilter] = useState<Filter>('toLabel')
  const [items, setItems] = useState<LabellingItem[]>([])
  const [summary, setSummary] = useState<QueueSummary | null>(null)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)

  const load = useCallback(
    async (which: Filter, offset: number) => {
      setLoading(true)
      setError(null)
      try {
        const params = new URLSearchParams({ filter: which, offset: String(offset), limit: String(PAGE) })
        const response = await fetch(`/api/settings/decision-model/labelling?${params}`, {
          credentials: 'include',
        })
        if (!response.ok) throw new Error()
        const data = await response.json()
        setItems((prev) => {
          if (offset === 0) return data.items
          const seen = new Set(prev.map((i) => i.key))
          return [...prev, ...data.items.filter((i: LabellingItem) => !seen.has(i.key))]
        })
        setTotal(data.total ?? 0)
        setSummary({
          counts: data.counts,
          labelled: data.labelled,
          arguable: data.arguable,
          tally: data.tally,
          noSharedCreditsTally: data.noSharedCreditsTally,
        })
      } catch {
        setError(t('settingsDecisionModel.labellingError'))
      } finally {
        setLoading(false)
      }
    },
    [t]
  )

  useEffect(() => {
    load(filter, 0)
  }, [filter, load])

  const saveLabel = async (item: LabellingItem, label: Label | null) => {
    setSaving(item.key)
    setError(null)
    try {
      const response = await fetch('/api/settings/decision-model/labels', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          mediaType: item.mediaType,
          pickId: item.pickId,
          watchedId: item.watchedId,
          label,
        }),
      })
      if (!response.ok) throw new Error()
      setSummary(await response.json())
      // Updated in place rather than re-read: a re-read of "to label" would
      // drop the row just answered, taking its reveal with it.
      setItems((prev) => prev.map((i) => (i.key === item.key ? { ...i, label } : i)))
    } catch {
      setError(t('settingsDecisionModel.labelSaveError'))
    } finally {
      setSaving(null)
    }
  }

  // The live count for the filters labelling changes; the last page's total otherwise.
  const currentTotal =
    filter === 'toLabel' || filter === 'labelled' ? (summary?.counts[filter] ?? total) : total

  const verdictText = (says: boolean | null) =>
    says == null
      ? '—'
      : says
        ? t('settingsDecisionModel.verdictYes')
        : t('settingsDecisionModel.verdictNo')

  return (
    <Box id="decision-labelling">
      <Typography variant="subtitle1" fontWeight={600}>
        {t('settingsDecisionModel.labellingTitle')}
      </Typography>
      <Typography variant="caption" color="text.secondary" display="block" mb={1.5}>
        {t('settingsDecisionModel.labellingHelp')}
      </Typography>

      {summary && summary.tally.scored > 0 && (
        <Alert severity="info" sx={{ mb: 1.5 }}>
          <Typography variant="body2">
            {t('settingsDecisionModel.labelScore', {
              scored: summary.tally.scored,
              thresholdRight: summary.tally.thresholdRight,
              ruleRight: summary.tally.ruleRight,
              modelRight: summary.tally.modelRight,
            })}
          </Typography>
          {summary.noSharedCreditsTally.scored > 0 && (
            <Typography variant="body2">
              {t('settingsDecisionModel.labelScoreNoCredits', {
                scored: summary.noSharedCreditsTally.scored,
                thresholdRight: summary.noSharedCreditsTally.thresholdRight,
                ruleRight: summary.noSharedCreditsTally.ruleRight,
                modelRight: summary.noSharedCreditsTally.modelRight,
              })}
            </Typography>
          )}
          <Typography variant="caption" color="text.secondary">
            {t('settingsDecisionModel.labelScoreCaveat', { arguable: summary.arguable })}
          </Typography>
        </Alert>
      )}

      <ToggleButtonGroup
        exclusive
        size="small"
        value={filter}
        onChange={(_e, value: Filter | null) => value && setFilter(value)}
        sx={{ flexWrap: 'wrap', mb: 1.5 }}
      >
        {FILTERS.map((f) => (
          <ToggleButton key={f} value={f}>
            {t(FILTER_KEYS[f], { count: summary?.counts[f] ?? 0 })}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>

      {error && (
        <Alert severity="error" sx={{ mb: 1.5 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {!loading && items.length === 0 && !error && (
        <Typography variant="body2" color="text.secondary">
          {t('settingsDecisionModel.labellingEmpty')}
        </Typography>
      )}

      <Stack spacing={1}>
        {items.map((item) => (
          <Paper key={item.key} variant="outlined" sx={{ p: 1.5 }}>
            <Box display="flex" alignItems="flex-start" justifyContent="space-between" gap={1.5} flexWrap="wrap">
              <Box sx={{ minWidth: 0, flex: '1 1 260px' }}>
                <Typography variant="body2" fontWeight={600}>
                  {withYear(item.pickTitle, item.pickYear)} ← {withYear(item.watchedTitle, item.watchedYear)}
                </Typography>
                <Box display="flex" gap={1} alignItems="center" mt={0.5} flexWrap="wrap">
                  <Chip
                    size="small"
                    variant="outlined"
                    label={t(item.mediaType === 'movie' ? 'settingsDecisionModel.mediaMovie' : 'settingsDecisionModel.mediaSeries')}
                  />
                  <Typography variant="caption" color="text.secondary">
                    {t('settingsDecisionModel.viewers', { count: item.viewers })}
                  </Typography>
                </Box>
              </Box>
              <ToggleButtonGroup
                exclusive
                size="small"
                value={item.label}
                disabled={saving === item.key}
                // Clicking the selected label again passes null, which removes it.
                onChange={(_e, value: Label | null) => saveLabel(item, value)}
              >
                {(['yes', 'no', 'arguable'] as const).map((l) => (
                  <ToggleButton key={l} value={l}>
                    {t(LABEL_KEYS[l])}
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>
            </Box>

            {item.label == null ? (
              <Typography variant="caption" color="text.secondary" display="block" mt={1}>
                {t('settingsDecisionModel.hiddenUntilLabelled')}
              </Typography>
            ) : (
              <Box display="flex" gap={2} mt={1} flexWrap="wrap">
                <Typography variant="caption" color="text.secondary">
                  {t('settingsDecisionModel.columnSimilarity')}{' '}
                  {item.similarity != null ? item.similarity.toFixed(3) : '—'}
                </Typography>
                <Typography variant="caption" sx={{ color: verdictColor(item.thresholdSays, item.label) }}>
                  {t('settingsDecisionModel.benchmarkColumnThreshold')}: {verdictText(item.thresholdSays)}
                </Typography>
                <Typography variant="caption" sx={{ color: verdictColor(item.ruleSays, item.label) }}>
                  {t('settingsDecisionModel.benchmarkColumnRule')}: {verdictText(item.ruleSays)}
                  {item.ruleBasis &&
                    ` (${t(
                      item.ruleBasis === 'director'
                        ? 'settingsDecisionModel.ruleBasisDirector'
                        : 'settingsDecisionModel.ruleBasisFranchise'
                    )})`}
                </Typography>
                <Typography variant="caption" sx={{ color: verdictColor(item.modelSays, item.label) }}>
                  {t('settingsDecisionModel.revealModel')}: {verdictText(item.modelSays)}
                  {item.modelP != null && ` (${Math.round(item.modelP * 100)}%)`}
                </Typography>
              </Box>
            )}
          </Paper>
        ))}
      </Stack>

      {loading && (
        <Box display="flex" justifyContent="center" py={2}>
          <CircularProgress size={24} />
        </Box>
      )}
      {!loading && stillInFilter(filter, items) < currentTotal && (
        <Box mt={1.5}>
          <Button size="small" onClick={() => load(filter, stillInFilter(filter, items))}>
            {t('settingsDecisionModel.loadMore')}
          </Button>
        </Box>
      )}
    </Box>
  )
}
