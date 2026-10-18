/**
 * Tavily credits this billing cycle, for the saved key and for the account's
 * plan, read live from `GET /api/settings/tavily/usage` (which asks Tavily's
 * own `GET /usage`). Nothing stores it, so it is fetched when the card opens,
 * after a save, and on Refresh.
 *
 * A figure Tavily did not send renders as "not reported", never as 0, and a
 * missing limit as "no limit reported" — the server keeps both apart from a
 * real zero (core `tavilyUsage.ts`).
 */
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Box, IconButton, LinearProgress, Tooltip, Typography, alpha } from '@mui/material'
import { Refresh as RefreshIcon } from '@mui/icons-material'

interface CreditFigures {
  used: number | null
  limit: number | null
}

interface TavilyUsage {
  key: CreditFigures | null
  account: {
    plan: string | null
    planCredits: CreditFigures
    payAsYouGo: CreditFigures
  } | null
}

type ReadoutState =
  | { status: 'loading' }
  | { status: 'ready'; usage: TavilyUsage }
  | { status: 'error'; message: string }

function barColor(used: number, limit: number): 'primary' | 'warning' | 'error' {
  const ratio = used / limit
  if (ratio >= 1) return 'error'
  if (ratio >= 0.8) return 'warning'
  return 'primary'
}

function CreditRow({ label, figures }: { label: string; figures: CreditFigures }) {
  const { t } = useTranslation()
  const { used, limit } = figures
  const value =
    used == null
      ? t('settingsTavily.creditsNotReported')
      : limit == null
        ? t('settingsTavily.creditsNoLimit', { used: used.toLocaleString() })
        : `${used.toLocaleString()} / ${limit.toLocaleString()}`
  return (
    <Box sx={{ mb: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 0.25 }}>
        <Typography variant="caption" color="text.secondary" fontWeight={600}>
          {label}
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Typography variant="caption" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
          {value}
        </Typography>
      </Box>
      {/* A bar needs both numbers and a real cap; 0 or absent is text only. */}
      {used != null && limit != null && limit > 0 && (
        <LinearProgress
          variant="determinate"
          value={Math.min(100, (used / limit) * 100)}
          color={barColor(used, limit)}
          sx={{ height: 4, borderRadius: 2 }}
        />
      )}
    </Box>
  )
}

export function TavilyUsageReadout() {
  const { t } = useTranslation()
  const [state, setState] = useState<ReadoutState>({ status: 'loading' })

  const load = useCallback(async () => {
    setState({ status: 'loading' })
    try {
      const response = await fetch('/api/settings/tavily/usage', { credentials: 'include' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setState({ status: 'error', message: data.error || t('settingsTavily.errConnect') })
      } else if (data.configured === false || !data.usage) {
        setState({ status: 'error', message: t('settingsTavily.creditsNoKey') })
      } else {
        setState({ status: 'ready', usage: data.usage as TavilyUsage })
      }
    } catch {
      setState({ status: 'error', message: t('settingsTavily.errConnect') })
    }
  }, [t])

  useEffect(() => {
    load()
  }, [load])

  const usage = state.status === 'ready' ? state.usage : null
  const payg = usage?.account?.payAsYouGo
  // Pay-as-you-go is only worth a row when the account has it at all.
  const showPayg = !!payg && ((payg.limit ?? 0) > 0 || (payg.used ?? 0) > 0)

  return (
    <Box
      sx={{
        mb: 3,
        p: 1.5,
        borderRadius: 2,
        border: 1,
        borderColor: 'divider',
        bgcolor: (theme) => alpha(theme.palette.background.default, 0.6),
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <Typography variant="subtitle2" fontWeight={600}>
          {t('settingsTavily.creditsTitle')}
        </Typography>
        <Tooltip title={t('settingsTavily.creditsRefresh')}>
          <span style={{ marginInlineStart: 'auto' }}>
            <IconButton size="small" onClick={load} disabled={state.status === 'loading'}>
              <RefreshIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </Box>

      {state.status === 'loading' && <LinearProgress sx={{ height: 2, mb: 1 }} />}

      {state.status === 'error' && (
        <Typography variant="caption" color="error" display="block">
          {t('settingsTavily.creditsError', { message: state.message })}
        </Typography>
      )}

      {usage && (
        <>
          {usage.key && <CreditRow label={t('settingsTavily.creditsKey')} figures={usage.key} />}
          {usage.account && (
            <CreditRow
              label={
                usage.account.plan
                  ? t('settingsTavily.creditsPlanNamed', { plan: usage.account.plan })
                  : t('settingsTavily.creditsPlan')
              }
              figures={usage.account.planCredits}
            />
          )}
          {showPayg && payg && (
            <CreditRow label={t('settingsTavily.creditsPayg')} figures={payg} />
          )}
          {!usage.key && !usage.account && (
            <Typography variant="caption" color="text.secondary" display="block">
              {t('settingsTavily.creditsEmpty')}
            </Typography>
          )}
        </>
      )}

      <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
        {t('settingsTavily.creditsNote')}
      </Typography>
    </Box>
  )
}
