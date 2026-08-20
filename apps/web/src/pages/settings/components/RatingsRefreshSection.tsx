/**
 * Settings card for the ratings refresh job.
 *
 * Ratings are the one kind of metadata that moves, and enrichment was built for
 * the kind that does not — it selects rows that have never been enriched, with
 * no TTL, which is right for a plot and wrong for a vote count. This card
 * governs the job that fixes that, one switch per source.
 *
 * The coverage line is the part worth keeping. MDBList enrichment on the
 * instance this was written against had reached 88 of 12,589 rows and nothing
 * said so anywhere: the columns simply read empty, so a stalled integration and
 * an absent one looked identical. A source that states how many titles it has
 * touched and when it last ran is what makes that visible without psql.
 */
import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Box,
  Typography,
  Card,
  CardContent,
  Button,
  Alert,
  Chip,
  CircularProgress,
  Link,
  Switch,
  Stack,
  Divider,
} from '@mui/material'
import StarHalfIcon from '@mui/icons-material/StarHalf'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'

interface RatingsConfig {
  imdbDataset: boolean
}

interface RatingsCoverage {
  withImdbId: number
  refreshed: number
  rated: number
  lastRefreshedAt: string | null
}

export function RatingsRefreshSection() {
  const { t, i18n } = useTranslation()
  const [config, setConfig] = useState<RatingsConfig | null>(null)
  const [coverage, setCoverage] = useState<RatingsCoverage | null>(null)
  const [imdbDataset, setImdbDataset] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [hasChanges, setHasChanges] = useState(false)

  const fetchConfig = useCallback(async () => {
    try {
      const response = await fetch('/api/settings/ratings', { credentials: 'include' })
      if (response.ok) {
        const data = await response.json()
        setConfig(data.config)
        setCoverage(data.coverage ?? null)
        setImdbDataset(!!data.config?.imdbDataset)
        setHasChanges(false)
      }
    } catch {
      setError(t('settingsRatings.loadError'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    fetchConfig()
  }, [fetchConfig])

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const response = await fetch('/api/settings/ratings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ imdbDataset }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || t('settingsRatings.saveError'))
      }
      const data = await response.json()
      setConfig(data.config)
      setCoverage(data.coverage ?? null)
      setHasChanges(false)
      setSuccess(t('settingsRatings.saved'))
    } catch (e) {
      setError(e instanceof Error ? e.message : t('settingsRatings.saveError'))
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress size={24} />
        </CardContent>
      </Card>
    )
  }

  const anyEnabled = !!config?.imdbDataset
  // Absent rather than zero when the job has never run, so "not yet" and "ran
  // and found nothing" cannot render the same way.
  const lastRun = coverage?.lastRefreshedAt
    ? new Date(coverage.lastRefreshedAt).toLocaleString(i18n.language)
    : null

  return (
    <Card>
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1 }}>
          <StarHalfIcon color="warning" />
          <Typography variant="h6" fontWeight={600}>
            {t('settingsRatings.title')}
          </Typography>
          {anyEnabled && (
            <Chip
              icon={<CheckCircleIcon />}
              label={t('settingsRatings.chipEnabled')}
              color="success"
              size="small"
            />
          )}
        </Box>

        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t('settingsRatings.description')}
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}
        {success && (
          <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess(null)}>
            {success}
          </Alert>
        )}

        <Divider sx={{ mb: 2 }} />

        <Stack direction="row" spacing={2} alignItems="flex-start">
          <Switch
            checked={imdbDataset}
            onChange={(e) => {
              setImdbDataset(e.target.checked)
              setHasChanges(true)
            }}
          />
          <Box sx={{ flex: 1 }}>
            <Typography variant="subtitle2" fontWeight={600}>
              {t('settingsRatings.imdbDataset.name')}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {t('settingsRatings.imdbDataset.description')}
            </Typography>
            {/* Stated on the card rather than buried in docs: this is the only
                source here whose cost is a licence rather than a quota, and it
                is the operator's decision to make knowingly. */}
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
              {t('settingsRatings.imdbDataset.licence')}{' '}
              <Link
                href="https://developer.imdb.com/non-commercial-datasets/"
                target="_blank"
                rel="noopener noreferrer"
              >
                {t('settingsRatings.imdbDataset.licenceLink')}
              </Link>
            </Typography>
          </Box>
        </Stack>

        {coverage && (
          <Box sx={{ mt: 2, pl: 7 }}>
            <Typography variant="caption" color="text.secondary" display="block">
              {t('settingsRatings.coverage', {
                rated: coverage.rated.toLocaleString(i18n.language),
                total: coverage.withImdbId.toLocaleString(i18n.language),
              })}
            </Typography>
            <Typography variant="caption" color="text.secondary" display="block">
              {lastRun
                ? t('settingsRatings.lastRun', { when: lastRun })
                : t('settingsRatings.neverRun')}
            </Typography>
          </Box>
        )}

        <Box sx={{ mt: 3, display: 'flex', justifyContent: 'flex-end' }}>
          <Button
            variant="contained"
            onClick={handleSave}
            disabled={saving || !hasChanges}
            startIcon={saving ? <CircularProgress size={16} /> : undefined}
          >
            {t('common.save')}
          </Button>
        </Box>
      </CardContent>
    </Card>
  )
}
