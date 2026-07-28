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
  slot: 'primary' | 'fallback'
  minute: UsageWindow
  day: UsageWindow
  rateLimitedToday: number
  lastRateLimitedAt: string | null
  lastUsedAt: string | null
  cooldownUntil: string | null
}

interface UsageResponse {
  configured: boolean
  hasFallbackKey: boolean
  model: string | null
  limits: { rpm: number; rpd: number; tpm: number } | null
  dayResetsAt: string
  slots: SlotUsage[]
}

/** The meter is live, so it refreshes itself — slowly, on an admin-only page. */
const POLL_INTERVAL_MS = 60_000

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

export function WebSearchUsagePanel() {
  const { t } = useTranslation()
  const [usage, setUsage] = useState<UsageResponse | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const fetchUsage = useCallback(async () => {
    setRefreshing(true)
    try {
      const res = await fetch('/api/settings/ai/web-search/usage', { credentials: 'include' })
      if (res.ok) setUsage(await res.json())
    } catch {
      // A meter that can't load is not worth an error banner over the card.
    } finally {
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    fetchUsage()
    const timer = setInterval(fetchUsage, POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [fetchUsage])

  // Nothing to meter until the role is configured — the card already says so.
  if (!usage?.configured) return null

  // The fallback key gets its own row only once there is one; otherwise the
  // primary's numbers are the whole story.
  const slots = usage.slots.filter((s) => s.slot === 'primary' || usage.hasFallbackKey)
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

      {!limits && (
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.5 }}>
          {t('webSearchUsage.noPublishedLimits')}
        </Typography>
      )}

      {slots.map((slot) => (
        <Box key={slot.slot} sx={{ mb: 1.5, '&:last-of-type': { mb: 0 } }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
            <Typography variant="caption" fontWeight={600}>
              {t(slot.slot === 'primary' ? 'webSearchUsage.slotPrimary' : 'webSearchUsage.slotFallback')}
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
            {limits
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
            slot: t(slot.slot === 'primary' ? 'webSearchUsage.slotPrimary' : 'webSearchUsage.slotFallback'),
            time: formatTime(slot.cooldownUntil),
          })}
        </Typography>
      ))}

      <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1.5 }}>
        {t('webSearchUsage.caveat')}
      </Typography>
    </Box>
  )
}
