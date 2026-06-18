import { useState, useEffect, useCallback } from 'react'
import {
  Box,
  Typography,
  Card,
  CardContent,
  Switch,
  FormControlLabel,
  Alert,
  CircularProgress,
} from '@mui/material'
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong'

/**
 * System > Logging: toggle access-log verbosity for the API server.
 *
 * "Quiet poll-route logs" suppresses the request/response access logs for the
 * high-frequency endpoints the web app polls (e.g. /api/jobs/active), which
 * otherwise flood the container logs. Backed by the `quiet_poll_logs` system
 * setting; applies immediately (no restart).
 */
export function SystemLogsSection() {
  const [quietPollLogs, setQuietPollLogs] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/settings/system/logging', { credentials: 'include' })
      if (res.ok) {
        const data = await res.json()
        setQuietPollLogs(Boolean(data.quietPollLogs))
      }
    } catch {
      // Ignore — fall back to the default (off)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const handleToggle = async (next: boolean) => {
    const prev = quietPollLogs
    setQuietPollLogs(next) // optimistic
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const res = await fetch('/api/settings/system/logging', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ quietPollLogs: next }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to save logging setting')
      }
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (err) {
      setQuietPollLogs(prev) // revert on failure
      setError(err instanceof Error ? err.message : 'Failed to save logging setting')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardContent>
        <Box display="flex" alignItems="center" gap={1.5} mb={1}>
          <ReceiptLongIcon color="primary" />
          <Typography variant="h6" fontWeight={600}>
            Logging
          </Typography>
        </Box>
        <Typography variant="body2" color="text.secondary" mb={2}>
          Control access-log verbosity for the API server.
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {loading ? (
          <Box display="flex" justifyContent="center" py={2}>
            <CircularProgress size={24} />
          </Box>
        ) : (
          <Box>
            <FormControlLabel
              control={
                <Switch
                  checked={quietPollLogs}
                  onChange={(e) => handleToggle(e.target.checked)}
                  disabled={saving}
                />
              }
              label="Quiet poll-route logs"
            />
            <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 0.5 }}>
              The web app polls a few endpoints every few seconds (e.g. <code>/api/jobs/active</code>).
              Enable this to suppress their request/response access logs and cut container log noise —
              errors on those routes are still logged. When unset, the default comes from the{' '}
              <code>QUIET_POLL_LOGS</code> environment variable.
            </Typography>
            {saving && (
              <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, mt: 1 }}>
                <CircularProgress size={12} />
                <Typography variant="caption" color="text.secondary">
                  Saving…
                </Typography>
              </Box>
            )}
            {saved && !saving && (
              <Typography variant="caption" color="success.main" sx={{ mt: 1, display: 'block' }}>
                Saved
              </Typography>
            )}
          </Box>
        )}
      </CardContent>
    </Card>
  )
}
