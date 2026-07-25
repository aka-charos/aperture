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
 * otherwise flood the container logs. "Mask server address" redacts the public
 * hostname and client IPs so a log can be pasted into a bug report as-is.
 * Backed by the `quiet_poll_logs` / `mask_log_urls` system settings; both apply
 * immediately (no restart).
 */
export function SystemLogsSection() {
  const [quietPollLogs, setQuietPollLogs] = useState(false)
  const [maskLogUrls, setMaskLogUrls] = useState(false)
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
        setMaskLogUrls(Boolean(data.maskLogUrls))
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

  // One saver for both switches: each PUT carries only the toggle that changed.
  const handleToggle = async (
    key: 'quietPollLogs' | 'maskLogUrls',
    next: boolean
  ) => {
    const apply = key === 'quietPollLogs' ? setQuietPollLogs : setMaskLogUrls
    apply(next) // optimistic
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const res = await fetch('/api/settings/system/logging', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ [key]: next }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to save logging setting')
      }
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (err) {
      apply(!next) // revert on failure
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
                  onChange={(e) => handleToggle('quietPollLogs', e.target.checked)}
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

            <Box sx={{ mt: 2 }}>
              <FormControlLabel
                control={
                  <Switch
                    checked={maskLogUrls}
                    onChange={(e) => handleToggle('maskLogUrls', e.target.checked)}
                    disabled={saving}
                  />
                }
                label="Mask server address in logs"
              />
              <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 0.5 }}>
                Replaces the public hostname with <code>[masked-host]</code> and client IPs with{' '}
                <code>[masked-ip]</code> in the access logs, so a log can be shared or posted for
                support without revealing where the server lives or who connected. Method, path,
                status and timing are untouched. When unset, the default comes from the{' '}
                <code>MASK_LOG_URLS</code> environment variable.
              </Typography>
            </Box>
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
