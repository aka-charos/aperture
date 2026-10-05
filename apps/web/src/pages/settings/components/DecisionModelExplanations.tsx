/**
 * Check the written explanations: the decision model's four checks on each
 * explanation viewers read, and the operator's accept/reject labels that say
 * whether those checks can be trusted.
 *
 * Shadow only — nothing here changes what viewers see. The checks are made by
 * a job (Jobs → Check recommendation explanations), started from this panel.
 *
 * Blind like the pair queue: an explanation is shown with the context a viewer
 * sees (the heading over the watched titles, which titles, why the pick was
 * made) and the model's checks stay hidden until it is labelled. The default
 * order is a hash of the text, decided server side.
 */
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link as RouterLink } from 'react-router-dom'
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
import FactCheckIcon from '@mui/icons-material/FactCheck'
import { jobConsoleLink } from '@/pages/jobs/registry'

const CHECK_JOB = 'check-recommendation-explanations'
const PAGE = 10

type Label = 'accept' | 'reject' | 'unsure'
type Filter = 'toLabel' | 'flagged' | 'passed' | 'labelled'
type CheckId = 'claimsContextAsReason' | 'unsupportedLink' | 'inventedFact' | 'spoiler'

const FILTERS: Filter[] = ['toLabel', 'flagged', 'passed', 'labelled']
const CHECKS: CheckId[] = ['claimsContextAsReason', 'unsupportedLink', 'inventedFact', 'spoiler']

const FILTER_KEYS: Record<Filter, string> = {
  toLabel: 'settingsDecisionModel.explanationsFilterToLabel',
  flagged: 'settingsDecisionModel.explanationsFilterFlagged',
  passed: 'settingsDecisionModel.explanationsFilterPassed',
  labelled: 'settingsDecisionModel.explanationsFilterLabelled',
}
const CHECK_KEYS: Record<CheckId, string> = {
  claimsContextAsReason: 'settingsDecisionModel.checkClaimsContextAsReason',
  unsupportedLink: 'settingsDecisionModel.checkUnsupportedLink',
  inventedFact: 'settingsDecisionModel.checkInventedFact',
  spoiler: 'settingsDecisionModel.checkSpoiler',
}
const LABEL_KEYS: Record<Label, string> = {
  accept: 'settingsDecisionModel.labelAccept',
  reject: 'settingsDecisionModel.labelReject',
  unsure: 'settingsDecisionModel.labelUnsure',
}
const ORIGIN_KEYS: Record<string, string> = {
  kindredViewer: 'settingsDecisionModel.originKindredViewer',
  statedInterest: 'settingsDecisionModel.originStatedInterest',
  acclaimed: 'settingsDecisionModel.originAcclaimed',
}

interface ExplanationItem {
  hash: string
  mediaType: 'movie' | 'series'
  pickTitle: string
  pickYear: number | null
  explanation: string
  heading: 'reason' | 'contextOnly' | null
  origin: string | null
  watchedTitles: string[]
  scores: Partial<Record<CheckId, number>> | null
  failures: CheckId[]
  flagged: boolean | null
  label: Label | null
  current: boolean
}

interface Agreement {
  labelled: number
  unsure: number
  scored: number
  flaggedRejected: number
  flaggedAccepted: number
  passedRejected: number
  passedAccepted: number
}

interface Summary {
  explanations: number
  checked: number
  flagged: number
  perCheck: Record<CheckId, { asked: number; failed: number }>
  counts: Record<Filter, number>
  agreement: Agreement
}

function stillInFilter(filter: Filter, items: ExplanationItem[]): number {
  if (filter === 'toLabel') return items.filter((i) => i.label == null).length
  if (filter === 'labelled') return items.filter((i) => i.label != null).length
  return items.length
}

export function DecisionModelExplanations() {
  const { t } = useTranslation()
  const [filter, setFilter] = useState<Filter>('toLabel')
  const [items, setItems] = useState<ExplanationItem[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [started, setStarted] = useState(false)

  const load = useCallback(
    async (which: Filter, offset: number) => {
      setLoading(true)
      setError(null)
      try {
        const params = new URLSearchParams({ filter: which, offset: String(offset), limit: String(PAGE) })
        const response = await fetch(`/api/settings/decision-model/explanations?${params}`, {
          credentials: 'include',
        })
        if (!response.ok) throw new Error()
        const data = await response.json()
        setItems((prev) => {
          if (offset === 0) return data.items
          const seen = new Set(prev.map((i) => i.hash))
          return [...prev, ...data.items.filter((i: ExplanationItem) => !seen.has(i.hash))]
        })
        setTotal(data.total ?? 0)
        setSummary({
          explanations: data.explanations,
          checked: data.checked,
          flagged: data.flagged,
          perCheck: data.perCheck,
          counts: data.counts,
          agreement: data.agreement,
        })
      } catch {
        setError(t('settingsDecisionModel.explanationsError'))
      } finally {
        setLoading(false)
      }
    },
    [t]
  )

  useEffect(() => {
    load(filter, 0)
  }, [filter, load])

  const startCheck = async () => {
    setStarting(true)
    setError(null)
    try {
      const response = await fetch(`/api/jobs/${CHECK_JOB}/run`, { method: 'POST', credentials: 'include' })
      if (!response.ok) {
        // The server's own sentence (a 409 says whether it is already running).
        const body = (await response.json().catch(() => null)) as { error?: string } | null
        setError(body?.error || t('settingsDecisionModel.explanationsRunError'))
        return
      }
      setStarted(true)
    } catch {
      setError(t('settingsDecisionModel.explanationsRunError'))
    } finally {
      setStarting(false)
    }
  }

  const saveLabel = async (item: ExplanationItem, label: Label | null) => {
    setSaving(item.hash)
    setError(null)
    try {
      const response = await fetch('/api/settings/decision-model/explanation-labels', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ hash: item.hash, label }),
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null
        throw new Error(body?.error)
      }
      setSummary(await response.json())
      setItems((prev) => prev.map((i) => (i.hash === item.hash ? { ...i, label } : i)))
    } catch (err) {
      setError((err instanceof Error && err.message) || t('settingsDecisionModel.labelSaveError'))
    } finally {
      setSaving(null)
    }
  }

  const currentTotal =
    filter === 'toLabel' || filter === 'labelled' ? (summary?.counts[filter] ?? total) : total
  const agreement = summary?.agreement
  const rejected = agreement ? agreement.flaggedRejected + agreement.passedRejected : 0
  const accepted = agreement ? agreement.flaggedAccepted + agreement.passedAccepted : 0

  return (
    <Box id="decision-explanations">
      <Typography variant="subtitle1" fontWeight={600}>
        {t('settingsDecisionModel.explanationsTitle')}
      </Typography>
      <Typography variant="caption" color="text.secondary" display="block" mb={1.5}>
        {t('settingsDecisionModel.explanationsHelp')}
      </Typography>

      <Box display="flex" gap={1.5} alignItems="center" flexWrap="wrap" mb={1.5}>
        <Button
          variant="outlined"
          size="small"
          startIcon={starting ? <CircularProgress size={16} /> : <FactCheckIcon />}
          onClick={startCheck}
          disabled={starting}
        >
          {t('settingsDecisionModel.explanationsRun')}
        </Button>
        <Button size="small" component={RouterLink} to={jobConsoleLink(CHECK_JOB)}>
          {t('settingsDecisionModel.openJobs')}
        </Button>
      </Box>
      {started && (
        <Alert severity="info" sx={{ mb: 1.5 }} onClose={() => setStarted(false)}>
          {t('settingsDecisionModel.explanationsStarted')}
        </Alert>
      )}

      {summary && (
        <Box mb={1.5}>
          <Typography variant="body2">
            {summary.checked > 0
              ? t('settingsDecisionModel.explanationsSummary', {
                  checked: summary.checked,
                  explanations: summary.explanations,
                  flagged: summary.flagged,
                })
              : t('settingsDecisionModel.explanationsNone')}
          </Typography>
          {summary.checked > 0 && (
            <Typography variant="caption" color="text.secondary">
              {CHECKS.filter((id) => summary.perCheck[id]?.asked > 0)
                .map((id) =>
                  t('settingsDecisionModel.checkRate', {
                    label: t(CHECK_KEYS[id]),
                    failed: summary.perCheck[id].failed,
                    asked: summary.perCheck[id].asked,
                  })
                )
                .join(' · ')}
            </Typography>
          )}
        </Box>
      )}

      {agreement && agreement.scored > 0 && (
        <Alert severity="info" sx={{ mb: 1.5 }}>
          <Typography variant="body2">
            {t('settingsDecisionModel.explanationsAgreement', {
              scored: agreement.scored,
              flaggedRejected: agreement.flaggedRejected,
              rejected,
              flaggedAccepted: agreement.flaggedAccepted,
              accepted,
            })}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {t('settingsDecisionModel.explanationsAgreementCaveat', { unsure: agreement.unsure })}
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
          {t('settingsDecisionModel.explanationsEmpty')}
        </Typography>
      )}

      <Stack spacing={1}>
        {items.map((item) => (
          <Paper key={item.hash} variant="outlined" sx={{ p: 1.5 }}>
            <Box display="flex" alignItems="flex-start" justifyContent="space-between" gap={1.5} flexWrap="wrap">
              <Box sx={{ minWidth: 0, flex: '1 1 320px' }}>
                <Box display="flex" gap={1} alignItems="center" flexWrap="wrap">
                  <Typography variant="body2" fontWeight={600}>
                    {item.pickYear != null ? `${item.pickTitle} (${item.pickYear})` : item.pickTitle}
                  </Typography>
                  <Chip
                    size="small"
                    variant="outlined"
                    label={t(
                      item.mediaType === 'movie' ? 'settingsDecisionModel.mediaMovie' : 'settingsDecisionModel.mediaSeries'
                    )}
                  />
                  {!item.current && (
                    <Typography variant="caption" color="text.secondary">
                      {t('settingsDecisionModel.noLongerCurrent')}
                    </Typography>
                  )}
                </Box>
                {item.heading && (
                  <Typography variant="caption" color="text.secondary" display="block" mt={0.5}>
                    {t(
                      item.heading === 'reason'
                        ? 'settingsDecisionModel.shownUnderReason'
                        : 'settingsDecisionModel.shownUnderContext'
                    )}
                    {item.watchedTitles.length > 0 &&
                      ` — ${t('settingsDecisionModel.watchedTitles', { titles: item.watchedTitles.join(', ') })}`}
                  </Typography>
                )}
                {item.origin && ORIGIN_KEYS[item.origin] && (
                  <Typography variant="caption" color="text.secondary" display="block">
                    {t(ORIGIN_KEYS[item.origin])}
                  </Typography>
                )}
                <Typography
                  variant="body2"
                  sx={{ mt: 1, pl: 1.5, borderLeft: 3, borderColor: 'divider', whiteSpace: 'pre-line' }}
                >
                  {item.explanation}
                </Typography>
              </Box>
              <ToggleButtonGroup
                exclusive
                size="small"
                value={item.label}
                disabled={saving === item.hash}
                // Clicking the selected label again passes null, which removes it.
                onChange={(_e, value: Label | null) => saveLabel(item, value)}
              >
                {(['accept', 'reject', 'unsure'] as const).map((l) => (
                  <ToggleButton key={l} value={l}>
                    {t(LABEL_KEYS[l])}
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>
            </Box>

            {item.label == null ? (
              <Typography variant="caption" color="text.secondary" display="block" mt={1}>
                {t('settingsDecisionModel.checksHidden')}
              </Typography>
            ) : !item.scores ? (
              <Typography variant="caption" color="text.secondary" display="block" mt={1}>
                {t('settingsDecisionModel.notCheckedYet')}
              </Typography>
            ) : (
              <Box display="flex" gap={2} mt={1} flexWrap="wrap">
                {CHECKS.filter((id) => item.scores?.[id] != null).map((id) => {
                  const failed = item.failures.includes(id)
                  return (
                    <Typography key={id} variant="caption" sx={{ color: failed ? 'error.main' : 'success.main' }}>
                      {t(CHECK_KEYS[id])}: {failed ? t('settingsDecisionModel.checkFailed') : t('settingsDecisionModel.checkPassed')}{' '}
                      ({Math.round((item.scores?.[id] ?? 0) * 100)}%)
                    </Typography>
                  )
                })}
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
