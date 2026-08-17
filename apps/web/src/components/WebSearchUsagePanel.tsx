/**
 * Free-tier usage meter for the Google Gemini Web Search role.
 *
 * Gemini's free tier is metered three ways at once — requests per minute,
 * requests per day (resetting at midnight US/Pacific), and tokens per minute —
 * and hitting any of them returns 429 RESOURCE_EXHAUSTED, which shows up as
 * discovery quietly finding nothing. This panel makes the budget visible before
 * that happens, per API key, since each key is its own Google project with its
 * own quota.
 *
 * Rendered inside the Web Search card via AIFunctionCard's `footer` slot.
 */
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Box, Chip, IconButton, LinearProgress, Tooltip, Typography, alpha } from '@mui/material'
import { Refresh as RefreshIcon, WarningAmber as WarningAmberIcon } from '@mui/icons-material'

interface UsageWindow {
  requests: number
  tokens: number
}

interface SlotUsage {
  /** 'primary', then 'fallback', 'fallback2', … — as many as the role holds. */
  slot: string
  minute: UsageWindow
  day: UsageWindow
  rateLimitedToday: number
  lastRateLimitedAt: string | null
  lastUsedAt: string | null
  cooldownUntil: string | null
}

interface UsageResponse {
  configured: boolean
  fallbackKeyCount: number
  model: string | null
  /**
   * Any field can be absent. Each is either learned from a Google 429 that
   * named it, or supplied by the shipped free-tier table — and `source` says
   * which, because a ceiling Google enforced and one this app assumed are not
   * the same claim. A missing field means a bare count with no bar, which is
   * the honest rendering when nothing is known.
   */
  limits: {
    rpm?: number
    rpd?: number
    tpm?: number
    /**
     * Grounded searches per day, a separate allowance charged per model
     * family. **Zero is a real answer** — the free tier gives the Gemini 3.x
     * family none at all — so this is tested against `undefined`, never for
     * truthiness.
     */
    groundingRpd?: number
    source: 'observed' | 'freeTier' | 'mixed'
  } | null
  /** Whether the operator says these keys are on the free tier. */
  freeTier: boolean
  dayResetsAt: string
  slots: SlotUsage[]
}

/** The meter is live, so it refreshes itself — slowly, on an admin-only page. */
const POLL_INTERVAL_MS = 60_000

/**
 * One line saying where the denominators came from. Spelled out as a map rather
 * than built from the source name so the keys are greppable — an i18n key that
 * only exists as a template fragment is one nobody finds when it goes missing.
 */
const LIMIT_SOURCE_KEYS = {
  observed: 'webSearchUsage.limitsObserved',
  freeTier: 'webSearchUsage.limitsAssumed',
  mixed: 'webSearchUsage.limitsMixed',
} as const

function formatTime(iso: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

function formatCompact(n: number): string {
  return n.toLocaleString(undefined, { notation: 'compact', maximumFractionDigits: 1 })
}

/**
 * Slot names are `primary`, `fallback`, `fallback2`, `fallback3`… The first two
 * keep dedicated strings because they read better than "Spare key 1"; beyond
 * that they are numbered. The number shown is the position among the spares,
 * which is why `fallback` is 1 and `fallback2` is 2.
 */
function slotLabel(slot: string, t: (key: string, opts?: Record<string, unknown>) => string): string {
  if (slot === 'primary') return t('webSearchUsage.slotPrimary')
  if (slot === 'fallback') return t('webSearchUsage.slotFallback')
  const n = Number.parseInt(slot.replace('fallback', ''), 10)
  return Number.isFinite(n)
    ? t('webSearchUsage.slotFallbackNumbered', { number: n })
    : t('webSearchUsage.slotFallback')
}

/** Green until the budget is most of the way gone, then amber, then red. */
function barColor(used: number, limit: number): 'primary' | 'warning' | 'error' {
  const ratio = used / limit
  if (ratio >= 1) return 'error'
  if (ratio >= 0.8) return 'warning'
  return 'primary'
}

function UsageBar({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const value = limit ? Math.min(100, (used / limit) * 100) : 0
  return (
    <Box sx={{ mb: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 0.25 }}>
        <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
          {label}
        </Typography>
        <Typography variant="caption" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
          {limit
            ? `${used.toLocaleString()} / ${limit.toLocaleString()}`
            : used.toLocaleString()}
        </Typography>
      </Box>
      {limit != null && (
        <LinearProgress
          variant="determinate"
          value={value}
          color={barColor(used, limit)}
          sx={{ height: 4, borderRadius: 2 }}
        />
      )}
    </Box>
  )
}

export function WebSearchUsagePanel({ role = 'webSearch' }: { role?: string } = {}) {
  const { t } = useTranslation()
  const [usage, setUsage] = useState<UsageResponse | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const fetchUsage = useCallback(async () => {
    setRefreshing(true)
    try {
      // Per role: the grounding roles hold different keys and therefore
      // different quota, and a combined number could not say which ran out.
      const res = await fetch(
        `/api/settings/ai/web-search/usage?role=${encodeURIComponent(role)}`,
        { credentials: 'include' }
      )
      if (res.ok) setUsage(await res.json())
    } catch {
      // A meter that can't load is not worth an error banner over the card.
    } finally {
      setRefreshing(false)
    }
  }, [role])

  useEffect(() => {
    fetchUsage()
    const timer = setInterval(fetchUsage, POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [fetchUsage])

  // Nothing to meter until the role is configured — the card already says so.
  if (!usage?.configured) return null

  // The server already returns exactly the configured keys, deduped — a role
  // with no spares gets one row, and the primary's numbers are the whole story.
  const slots = usage.slots
  const limits = usage.limits
  const paused = slots.filter((s) => s.cooldownUntil)

  return (
    <Box
      sx={{
        mb: 2,
        p: 1.5,
        borderRadius: 2,
        border: 1,
        borderColor: 'divider',
        bgcolor: (theme) => alpha(theme.palette.background.default, 0.6),
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <Typography variant="subtitle2" fontWeight={600}>
          {t('webSearchUsage.title')}
        </Typography>
        <Tooltip title={t('webSearchUsage.refresh')}>
          <span style={{ marginInlineStart: 'auto' }}>
            <IconButton size="small" onClick={fetchUsage} disabled={refreshing}>
              <RefreshIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </Box>

      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.5 }}>
        {t('webSearchUsage.resets', { time: formatTime(usage.dayResetsAt) })}
      </Typography>

      {!limits?.rpd && !limits?.rpm && (
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.5 }}>
          {/* Two different reasons for a bare count, and the operator can only
              act on one of them: they turned the free-tier ceilings off. */}
          {usage.freeTier
            ? t('webSearchUsage.noPublishedLimits')
            : t('webSearchUsage.paidTierNoLimits')}
        </Typography>
      )}

      {/* The grounding allowance is a different quota from the model's own, and
          the case that matters is zero: a model can sit at 1% of its daily
          requests and still have every grounded search refused. Rendered as a
          warning rather than a bar because nothing here meters it separately —
          claiming a fill level for a budget we don't count would be the same
          confident guess this panel exists to avoid. */}
      {limits?.groundingRpd === 0 ? (
        <Box sx={{ display: 'flex', gap: 0.75, mb: 1.5 }}>
          <WarningAmberIcon fontSize="small" color="warning" sx={{ mt: '1px' }} />
          <Typography variant="caption" color="warning.main">
            {t('webSearchUsage.groundingBlocked')}
          </Typography>
        </Box>
      ) : (
        limits?.groundingRpd != null && (
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.5 }}>
            {t('webSearchUsage.groundingAllowance', {
              limit: limits.groundingRpd.toLocaleString(),
            })}
          </Typography>
        )
      )}

      {slots.map((slot) => (
        <Box key={slot.slot} sx={{ mb: 1.5, '&:last-of-type': { mb: 0 } }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
            <Typography variant="caption" fontWeight={600}>
              {slotLabel(slot.slot, t)}
            </Typography>
            {slot.rateLimitedToday > 0 && (
              <Chip
                size="small"
                color="warning"
                variant="outlined"
                icon={<WarningAmberIcon />}
                label={t('webSearchUsage.rateLimitedToday', { count: slot.rateLimitedToday })}
                sx={{ height: 18, fontSize: '0.65rem', '& .MuiChip-label': { px: 0.75 } }}
              />
            )}
          </Box>

          <UsageBar
            label={t('webSearchUsage.requestsToday')}
            used={slot.day.requests}
            limit={limits?.rpd ?? null}
          />
          <UsageBar
            label={t('webSearchUsage.requestsThisMinute')}
            used={slot.minute.requests}
            limit={limits?.rpm ?? null}
          />
          <Typography variant="caption" color="text.secondary" display="block">
            {limits?.tpm
              ? t('webSearchUsage.tokensThisMinuteWithLimit', {
                  used: formatCompact(slot.minute.tokens),
                  limit: formatCompact(limits.tpm),
                })
              : t('webSearchUsage.tokensThisMinute', { used: formatCompact(slot.minute.tokens) })}
          </Typography>
        </Box>
      ))}

      {paused.map((slot) => (
        <Typography
          key={slot.slot}
          variant="caption"
          color="warning.main"
          display="block"
          sx={{ mt: 1 }}
        >
          {t('webSearchUsage.paused', {
            slot: slotLabel(slot.slot, t),
            time: formatTime(slot.cooldownUntil),
          })}
        </Typography>
      ))}

      {/* Where the denominators came from. Worth a line of its own: a number
          Google enforced against this key is a fact, and a number taken from
          the shipped free-tier table is an assumption about the operator's
          project — which they can withdraw with the Free tier checkbox. */}
      {limits && (
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1.5 }}>
          {t(LIMIT_SOURCE_KEYS[limits.source])}
        </Typography>
      )}

      <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1.5 }}>
        {t('webSearchUsage.caveat')}
      </Typography>
    </Box>
  )
}
