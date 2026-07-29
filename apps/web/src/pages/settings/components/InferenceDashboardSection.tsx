/**
 * AI spend dashboard (OpenRouter).
 *
 * The cost estimator next to this one projects what a configuration *should*
 * cost from published prices and assumed call volumes. This shows what it
 * actually cost: OpenRouter returns the credits spent on every response, so each
 * call is recorded with real money attached (see core `lib/inferenceUsage.ts`).
 *
 * Renders only when at least one AI role is pointed at OpenRouter — no other
 * provider reports per-call cost, so there would be nothing honest to show.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Alert,
  Box,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  IconButton,
  LinearProgress,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
  alpha,
  useTheme,
} from '@mui/material'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts'
import InsightsIcon from '@mui/icons-material/Insights'
import RefreshIcon from '@mui/icons-material/Refresh'
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet'

// ============================================================================
// Types (mirror /api/inference/*)
// ============================================================================

interface Totals {
  calls: number
  errors: number
  promptTokens: number
  completionTokens: number
  reasoningTokens: number
  cachedTokens: number
  totalTokens: number
  cost: number
  pricedCalls: number
}

interface BreakdownRow {
  key: string
  calls: number
  totalTokens: number
  cost: number
}

interface DailyRow {
  day: string
  calls: number
  totalTokens: number
  cost: number
}

interface AccountStatus {
  label: string | null
  limit: number | null
  limitRemaining: number | null
  isFreeTier: boolean
  usage: number
  usageDaily: number
  usageWeekly: number
  usageMonthly: number
}

interface SummaryResponse {
  configured: boolean
  roles: string[]
  account: AccountStatus | null
  days: number
  window: Totals
  today: Totals
  daily: DailyRow[]
  byModel: BreakdownRow[]
  byRole: BreakdownRow[]
  byFeature: BreakdownRow[]
  empty: boolean
}

interface SessionRow {
  sessionId: string
  title: string | null
  username: string | null
  calls: number
  totalTokens: number
  cost: number
  startedAt: string
  lastCallAt: string
}

interface CallRow {
  id: string
  createdAt: string
  model: string
  role: string | null
  feature: string | null
  sessionId: string | null
  username: string | null
  upstreamProvider: string | null
  status: string
  statusCode: number | null
  streamed: boolean
  totalTokens: number
  cachedTokens: number
  cost: number | null
  latencyMs: number | null
}

type BreakdownDimension = 'model' | 'role' | 'feature'

const WINDOW_OPTIONS = [7, 30, 90] as const
const POLL_INTERVAL_MS = 60_000
const RECENT_CALL_LIMIT = 25

// ============================================================================
// Formatting
// ============================================================================

/**
 * Per-call amounts are routinely a fraction of a cent, so a fixed 2 decimals
 * would render most of this dashboard as "$0.00". Scale the precision to the
 * magnitude instead.
 */
function formatUsd(value: number | null | undefined): string {
  if (value == null) return '—'
  if (value === 0) return '$0.00'
  if (value < 0.01) return `$${value.toFixed(5)}`
  if (value < 1) return `$${value.toFixed(4)}`
  return `$${value.toFixed(2)}`
}

/** Short enough for a chart axis: 3 significant-ish digits, no trailing noise. */
function formatAxisUsd(value: number | string): string {
  const n = Number(value)
  if (!Number.isFinite(n) || n === 0) return '$0'
  if (n < 0.001) return `$${n.toFixed(4)}`
  if (n < 1) return `$${n.toFixed(3)}`
  return `$${n.toFixed(2)}`
}

function formatTokens(value: number): string {
  return value.toLocaleString(undefined, { notation: 'compact', maximumFractionDigits: 1 })
}

function formatTime(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString()
}

function formatLatency(ms: number | null): string {
  if (ms == null) return '—'
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`
}

/** `job:generate-movie-embeddings` → `generate-movie-embeddings`. */
function shortFeature(feature: string): string {
  return feature.startsWith('job:') ? feature.slice(4) : feature
}

// ============================================================================
// Pieces
// ============================================================================

function StatTile({
  label,
  value,
  caption,
  color,
}: {
  label: string
  value: string
  caption?: string
  color?: string
}) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" display="block">
        {label}
      </Typography>
      <Typography variant="h6" fontWeight={700} color={color} sx={{ lineHeight: 1.2 }}>
        {value}
      </Typography>
      {caption && (
        <Typography variant="caption" color="text.secondary">
          {caption}
        </Typography>
      )}
    </Box>
  )
}

function BreakdownTable({
  rows,
  columnLabel,
  transform,
}: {
  rows: BreakdownRow[]
  columnLabel: string
  transform?: (key: string) => string
}) {
  const { t } = useTranslation()
  const maxCost = Math.max(...rows.map((r) => r.cost), 0)

  if (rows.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ py: 2 }} textAlign="center">
        {t('inferenceDashboard.noData')}
      </Typography>
    )
  }

  return (
    <TableContainer sx={{ maxHeight: 320 }}>
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>
            <TableCell>{columnLabel}</TableCell>
            <TableCell align="right">{t('inferenceDashboard.colCalls')}</TableCell>
            <TableCell align="right">{t('inferenceDashboard.colTokens')}</TableCell>
            <TableCell align="right">{t('inferenceDashboard.colCost')}</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.key} hover>
              <TableCell sx={{ maxWidth: 260 }}>
                <Typography variant="body2" noWrap title={row.key}>
                  {transform ? transform(row.key) : row.key}
                </Typography>
                {/* A bar under the label makes the ranking legible without a
                    second chart competing with the daily one above. */}
                {maxCost > 0 && (
                  <LinearProgress
                    variant="determinate"
                    value={Math.min(100, (row.cost / maxCost) * 100)}
                    sx={{ height: 3, borderRadius: 2, mt: 0.5 }}
                  />
                )}
              </TableCell>
              <TableCell align="right">{row.calls.toLocaleString()}</TableCell>
              <TableCell align="right">{formatTokens(row.totalTokens)}</TableCell>
              <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                {formatUsd(row.cost)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  )
}

// ============================================================================
// Component
// ============================================================================

export function InferenceDashboardSection() {
  const { t } = useTranslation()
  const theme = useTheme()
  const [days, setDays] = useState<number>(30)
  const [summary, setSummary] = useState<SummaryResponse | null>(null)
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [calls, setCalls] = useState<CallRow[]>([])
  const [dimension, setDimension] = useState<BreakdownDimension>('feature')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const fetchAll = useCallback(async () => {
    setRefreshing(true)
    try {
      const [summaryRes, sessionsRes, callsRes] = await Promise.all([
        fetch(`/api/inference/summary?days=${days}`, { credentials: 'include' }),
        fetch(`/api/inference/sessions?days=${days}&limit=25`, { credentials: 'include' }),
        fetch(`/api/inference/calls?limit=${RECENT_CALL_LIMIT}`, { credentials: 'include' }),
      ])

      if (summaryRes.ok) setSummary(await summaryRes.json())
      if (sessionsRes.ok) setSessions((await sessionsRes.json()).sessions ?? [])
      if (callsRes.ok) setCalls((await callsRes.json()).calls ?? [])
    } catch {
      // A dashboard that can't load is not worth an error banner over the page.
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [days])

  useEffect(() => {
    void fetchAll()
    const timer = setInterval(() => void fetchAll(), POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [fetchAll])

  const breakdownRows = useMemo(() => {
    if (!summary) return []
    if (dimension === 'model') return summary.byModel
    if (dimension === 'role') return summary.byRole
    return summary.byFeature
  }, [summary, dimension])

  const chartData = useMemo(
    () =>
      (summary?.daily ?? []).map((row) => ({
        // MM-DD: a 90-day axis has no room for the year, and the window is
        // stated above the chart anyway.
        day: row.day.slice(5),
        cost: Number(row.cost.toFixed(6)),
        calls: row.calls,
      })),
    [summary]
  )

  if (loading) {
    return (
      <Card sx={{ p: 3, textAlign: 'center' }}>
        <CircularProgress size={24} />
      </Card>
    )
  }

  // Nothing here applies unless OpenRouter is actually driving a role.
  if (!summary?.configured) return null

  const { window: win, today, account } = summary
  const errorRate = win.calls > 0 ? (win.errors / win.calls) * 100 : 0
  const avgCost = win.pricedCalls > 0 ? win.cost / win.pricedCalls : 0
  const unpricedCalls = win.calls - win.pricedCalls

  return (
    <Card sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1, flexWrap: 'wrap' }}>
        <InsightsIcon color="primary" />
        <Typography variant="h6" fontWeight={600}>
          {t('inferenceDashboard.title')}
        </Typography>
        <Box sx={{ marginInlineStart: 'auto', display: 'flex', alignItems: 'center', gap: 1 }}>
          <ToggleButtonGroup
            size="small"
            exclusive
            value={days}
            onChange={(_e, value) => value && setDays(value)}
          >
            {WINDOW_OPTIONS.map((option) => (
              <ToggleButton key={option} value={option} sx={{ px: 1.5 }}>
                {t('inferenceDashboard.windowDays', { count: option })}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
          <Tooltip title={t('inferenceDashboard.refresh')}>
            <span>
              <IconButton size="small" onClick={() => void fetchAll()} disabled={refreshing}>
                <RefreshIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        </Box>
      </Box>

      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t('inferenceDashboard.subtitle')}
      </Typography>

      {/* OpenRouter's own numbers. Worth showing separately from the ledger:
          these include spend by anything else sharing the key. */}
      {account && (
        <Card variant="outlined" sx={{ mb: 3, bgcolor: 'action.hover' }}>
          <CardContent sx={{ py: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
              <AccountBalanceWalletIcon fontSize="small" color="primary" />
              <Typography variant="subtitle2" fontWeight={600}>
                {t('inferenceDashboard.accountTitle')}
              </Typography>
              {account.isFreeTier && (
                <Chip size="small" variant="outlined" label={t('inferenceDashboard.freeTier')} />
              )}
              {account.label && (
                <Typography variant="caption" color="text.secondary">
                  {account.label}
                </Typography>
              )}
            </Box>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                gap: 2,
              }}
            >
              <StatTile
                label={t('inferenceDashboard.creditsRemaining')}
                value={
                  account.limitRemaining == null
                    ? t('inferenceDashboard.unlimited')
                    : formatUsd(account.limitRemaining)
                }
                caption={account.limit != null ? t('inferenceDashboard.ofLimit', { limit: formatUsd(account.limit) }) : undefined}
                color={
                  account.limitRemaining != null && account.limitRemaining <= 0
                    ? 'error.main'
                    : 'success.main'
                }
              />
              <StatTile label={t('inferenceDashboard.spendToday')} value={formatUsd(account.usageDaily)} />
              <StatTile label={t('inferenceDashboard.spendWeek')} value={formatUsd(account.usageWeekly)} />
              <StatTile label={t('inferenceDashboard.spendMonth')} value={formatUsd(account.usageMonthly)} />
              <StatTile label={t('inferenceDashboard.spendAllTime')} value={formatUsd(account.usage)} />
            </Box>
          </CardContent>
        </Card>
      )}

      {summary.empty ? (
        <Alert severity="info">{t('inferenceDashboard.noCallsYet')}</Alert>
      ) : (
        <>
          {/* Headline numbers from the ledger */}
          <Card variant="outlined" sx={{ mb: 3 }}>
            <CardContent sx={{ py: 2 }}>
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                  gap: 2,
                }}
              >
                <StatTile
                  label={t('inferenceDashboard.windowSpend', { count: summary.days })}
                  value={formatUsd(win.cost)}
                  color="primary.main"
                />
                <StatTile label={t('inferenceDashboard.todaySpend')} value={formatUsd(today.cost)} />
                <StatTile
                  label={t('inferenceDashboard.calls')}
                  value={win.calls.toLocaleString()}
                  caption={t('inferenceDashboard.avgPerCall', { amount: formatUsd(avgCost) })}
                />
                <StatTile
                  label={t('inferenceDashboard.tokens')}
                  value={formatTokens(win.totalTokens)}
                  caption={
                    win.cachedTokens > 0
                      ? t('inferenceDashboard.cachedTokens', { tokens: formatTokens(win.cachedTokens) })
                      : undefined
                  }
                />
                <StatTile
                  label={t('inferenceDashboard.errorRate')}
                  value={`${errorRate.toFixed(1)}%`}
                  caption={t('inferenceDashboard.errorCount', { count: win.errors })}
                  color={errorRate >= 10 ? 'error.main' : errorRate >= 2 ? 'warning.main' : undefined}
                />
              </Box>

              {/* Calls the provider didn't price would otherwise sit invisibly
                  inside the totals as zeroes. */}
              {unpricedCalls > 0 && (
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1.5 }}>
                  {t('inferenceDashboard.unpricedCalls', { count: unpricedCalls })}
                </Typography>
              )}
            </CardContent>
          </Card>

          {/* Daily spend */}
          <Card variant="outlined" sx={{ mb: 3 }}>
            <CardContent sx={{ py: 2 }}>
              <Typography variant="subtitle2" fontWeight={600} gutterBottom>
                {t('inferenceDashboard.dailySpend')}
              </Typography>
              <Box sx={{ height: 220 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.2} vertical={false} />
                    <XAxis dataKey="day" tick={{ fontSize: 11 }} minTickGap={16} />
                    {/* The axis gets its own formatter: full precision belongs in
                        the tooltip, not repeated down the side of the chart. */}
                    <YAxis tick={{ fontSize: 11 }} width={56} tickFormatter={formatAxisUsd} />
                    <RechartsTooltip
                      formatter={(value) => formatUsd(value == null ? null : Number(value))}
                      labelFormatter={(label) => String(label)}
                    />
                    <Bar
                      dataKey="cost"
                      name={t('inferenceDashboard.colCost')}
                      fill={theme.palette.primary.main}
                      radius={[3, 3, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </Box>
            </CardContent>
          </Card>

          {/* What is spending the money */}
          <Card variant="outlined" sx={{ mb: 3 }}>
            <CardContent sx={{ py: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5, flexWrap: 'wrap' }}>
                <Typography variant="subtitle2" fontWeight={600}>
                  {t('inferenceDashboard.breakdownTitle')}
                </Typography>
                <ToggleButtonGroup
                  size="small"
                  exclusive
                  value={dimension}
                  onChange={(_e, value) => value && setDimension(value)}
                  sx={{ marginInlineStart: 'auto' }}
                >
                  <ToggleButton value="feature">{t('inferenceDashboard.byFeature')}</ToggleButton>
                  <ToggleButton value="model">{t('inferenceDashboard.byModel')}</ToggleButton>
                  <ToggleButton value="role">{t('inferenceDashboard.byRole')}</ToggleButton>
                </ToggleButtonGroup>
              </Box>
              <BreakdownTable
                rows={breakdownRows}
                columnLabel={
                  dimension === 'model'
                    ? t('inferenceDashboard.colModel')
                    : dimension === 'role'
                      ? t('inferenceDashboard.colRole')
                      : t('inferenceDashboard.colFeature')
                }
                transform={dimension === 'feature' ? shortFeature : undefined}
              />
            </CardContent>
          </Card>

          {/* Conversations */}
          {sessions.length > 0 && (
            <Card variant="outlined" sx={{ mb: 3 }}>
              <CardContent sx={{ py: 2 }}>
                <Typography variant="subtitle2" fontWeight={600} gutterBottom>
                  {t('inferenceDashboard.sessionsTitle')}
                </Typography>
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
                  {t('inferenceDashboard.sessionsCaption')}
                </Typography>
                <TableContainer sx={{ maxHeight: 340 }}>
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow>
                        <TableCell>{t('inferenceDashboard.colConversation')}</TableCell>
                        <TableCell>{t('inferenceDashboard.colUser')}</TableCell>
                        <TableCell align="right">{t('inferenceDashboard.colCalls')}</TableCell>
                        <TableCell align="right">{t('inferenceDashboard.colTokens')}</TableCell>
                        <TableCell align="right">{t('inferenceDashboard.colCost')}</TableCell>
                        <TableCell align="right">{t('inferenceDashboard.colLastActivity')}</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {sessions.map((session) => (
                        <TableRow key={session.sessionId} hover>
                          <TableCell sx={{ maxWidth: 260 }}>
                            <Typography variant="body2" noWrap>
                              {session.title ?? t('inferenceDashboard.deletedConversation')}
                            </Typography>
                          </TableCell>
                          <TableCell>{session.username ?? '—'}</TableCell>
                          <TableCell align="right">{session.calls}</TableCell>
                          <TableCell align="right">{formatTokens(session.totalTokens)}</TableCell>
                          <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                            {formatUsd(session.cost)}
                          </TableCell>
                          <TableCell align="right">
                            <Typography variant="caption" color="text.secondary">
                              {formatTime(session.lastCallAt)}
                            </Typography>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </CardContent>
            </Card>
          )}

          {/* Recent calls */}
          {calls.length > 0 && (
            <Card variant="outlined">
              <CardContent sx={{ py: 2 }}>
                <Typography variant="subtitle2" fontWeight={600} gutterBottom>
                  {t('inferenceDashboard.recentTitle')}
                </Typography>
                <TableContainer sx={{ maxHeight: 380 }}>
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow>
                        <TableCell>{t('inferenceDashboard.colWhen')}</TableCell>
                        <TableCell>{t('inferenceDashboard.colModel')}</TableCell>
                        <TableCell>{t('inferenceDashboard.colFeature')}</TableCell>
                        <TableCell align="right">{t('inferenceDashboard.colTokens')}</TableCell>
                        <TableCell align="right">{t('inferenceDashboard.colLatency')}</TableCell>
                        <TableCell align="right">{t('inferenceDashboard.colCost')}</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {calls.map((call) => (
                        <TableRow
                          key={call.id}
                          hover
                          sx={
                            call.status === 'ok'
                              ? undefined
                              : { bgcolor: (theme) => alpha(theme.palette.error.main, 0.08) }
                          }
                        >
                          <TableCell>
                            <Typography variant="caption" color="text.secondary" noWrap>
                              {formatTime(call.createdAt)}
                            </Typography>
                          </TableCell>
                          <TableCell sx={{ maxWidth: 200 }}>
                            <Typography variant="body2" noWrap title={call.model}>
                              {call.model}
                            </Typography>
                          </TableCell>
                          <TableCell sx={{ maxWidth: 200 }}>
                            <Typography variant="body2" noWrap>
                              {call.feature ? shortFeature(call.feature) : (call.role ?? '—')}
                            </Typography>
                            {call.status !== 'ok' && (
                              <Chip
                                size="small"
                                color="error"
                                variant="outlined"
                                label={call.statusCode ?? t('inferenceDashboard.failed')}
                                sx={{ height: 16, fontSize: '0.65rem' }}
                              />
                            )}
                          </TableCell>
                          <TableCell align="right">{formatTokens(call.totalTokens)}</TableCell>
                          <TableCell align="right">{formatLatency(call.latencyMs)}</TableCell>
                          <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                            {formatUsd(call.cost)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </Card>
  )
}
