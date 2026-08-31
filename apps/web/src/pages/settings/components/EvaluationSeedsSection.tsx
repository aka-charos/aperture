import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Box,
  Typography,
  Card,
  CardContent,
  Button,
  TextField,
  Alert,
  Chip,
  Stack,
  CircularProgress,
  Tooltip,
} from '@mui/material'
import ScienceIcon from '@mui/icons-material/Science'
import SaveIcon from '@mui/icons-material/Save'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline'
import AddIcon from '@mui/icons-material/Add'

interface SeedResolution {
  input: string
  resolved: boolean
  matchedTitle: string | null
  matchedYear: number | null
}

interface Suggestion {
  title: string
  year: number | null
  countries: string[]
  voteCount: number | null
}

type MediaType = 'movie' | 'series'

/**
 * Which titles the recommender evaluation builds its neighbour dump from.
 *
 * The dump is the instrument this is actually judged on, and its default --
 * whatever the most people finished -- is exactly where two embedding spaces
 * agree, so it reports "no difference" regardless of the truth. Choosing the
 * seeds is therefore not a nicety; it is what makes the comparison able to
 * answer anything at all.
 *
 * The resolution list under the box is the point of the whole panel. The
 * matcher is a PREFIX match returning one row, so a seed can quietly land on
 * the wrong film ("The Three Musketeers" names four here) -- and that is worse
 * than a miss, because a miss is at least reported in the job log.
 */
export function EvaluationSeedsSection() {
  const { t } = useTranslation()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [checking, setChecking] = useState(false)
  const [suggesting, setSuggesting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // The evaluate-recommender job hardcodes mediaType: 'movie' -- series sets
  // are never measured. A media-type switch here would let someone store
  // series titles that then resolve against `movies`, miss every one, and
  // delete the neighbour dump from the report with only a line in the job log
  // to say so. Offering the choice would be offering a way to break it.
  const mediaType: MediaType = 'movie'
  const [text, setText] = useState('')
  const [savedText, setSavedText] = useState('')
  const [seeds, setSeeds] = useState<SeedResolution[]>([])
  const [usingDefaults, setUsingDefaults] = useState(true)
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])

  const toLines = (value: string) =>
    value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)

  const load = useCallback(
    async (type: MediaType) => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(`/api/settings/evaluation?mediaType=${type}`, {
          credentials: 'include',
        })
        if (!res.ok) {
          setError(t('settingsEvaluation.loadError'))
          return
        }
        const data = (await res.json()) as {
          seedTitles: string[]
          seeds: SeedResolution[]
          usingDefaults: boolean
        }
        const joined = data.seedTitles.join('\n')
        setText(joined)
        setSavedText(joined)
        setSeeds(data.seeds)
        setUsingDefaults(data.usingDefaults)
      } catch {
        setError(t('settingsEvaluation.loadError'))
      } finally {
        setLoading(false)
      }
    },
    [t]
  )

  useEffect(() => {
    void load(mediaType)
  }, [load, mediaType])

  const handleCheck = async () => {
    setChecking(true)
    setError(null)
    try {
      const res = await fetch('/api/settings/evaluation/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ seedTitles: toLines(text), mediaType }),
      })
      if (!res.ok) {
        setError(t('settingsEvaluation.checkError'))
        return
      }
      const data = (await res.json()) as { seeds: SeedResolution[] }
      setSeeds(data.seeds)
    } catch {
      setError(t('settingsEvaluation.checkError'))
    } finally {
      setChecking(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const res = await fetch('/api/settings/evaluation', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ seedTitles: toLines(text), mediaType }),
      })
      if (!res.ok) {
        setError(t('settingsEvaluation.saveError'))
        return
      }
      const data = (await res.json()) as {
        seedTitles: string[]
        seeds: SeedResolution[]
        usingDefaults: boolean
      }
      const joined = data.seedTitles.join('\n')
      setText(joined)
      setSavedText(joined)
      setSeeds(data.seeds)
      setUsingDefaults(data.usingDefaults)
      setSuccess(t('settingsEvaluation.saved'))
    } catch {
      setError(t('settingsEvaluation.saveError'))
    } finally {
      setSaving(false)
    }
  }

  const handleSuggest = async () => {
    setSuggesting(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/settings/evaluation/suggestions?mediaType=${mediaType}&limit=20`,
        { credentials: 'include' }
      )
      if (!res.ok) {
        setError(t('settingsEvaluation.suggestError'))
        return
      }
      const data = (await res.json()) as { suggestions: Suggestion[] }
      setSuggestions(data.suggestions)
    } catch {
      setError(t('settingsEvaluation.suggestError'))
    } finally {
      setSuggesting(false)
    }
  }

  const addSuggestion = (title: string) => {
    const existing = toLines(text)
    if (existing.some((line) => line.toLowerCase() === title.toLowerCase())) return
    setText([...existing, title].join('\n'))
    setSuccess(null)
  }

  const dirty = text !== savedText

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
        <CircularProgress />
      </Box>
    )
  }

  return (
    <Card>
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <ScienceIcon color="primary" />
          <Typography variant="h6">{t('settingsEvaluation.title')}</Typography>
        </Box>

        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t('settingsEvaluation.description')}
        </Typography>

        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t('settingsEvaluation.scope')}
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

        {usingDefaults && (
          <Alert severity="info" sx={{ mb: 2 }}>
            {t('settingsEvaluation.usingDefaults')}
          </Alert>
        )}

        <TextField
          id="evaluation-seed-titles"
          fullWidth
          multiline
          minRows={6}
          maxRows={20}
          value={text}
          onChange={(e) => setText(e.target.value)}
          label={t('settingsEvaluation.seedsLabel')}
          helperText={t('settingsEvaluation.seedsHelp')}
          sx={{ mb: 2 }}
        />

        <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: 'wrap', gap: 1 }}>
          <Button
            variant="contained"
            startIcon={<SaveIcon />}
            onClick={() => void handleSave()}
            disabled={saving || !dirty}
          >
            {saving ? t('common.saving') : t('common.save')}
          </Button>
          <Button variant="outlined" onClick={() => void handleCheck()} disabled={checking}>
            {checking ? t('settingsEvaluation.checking') : t('settingsEvaluation.check')}
          </Button>
          <Button
            variant="outlined"
            startIcon={<AutoAwesomeIcon />}
            onClick={() => void handleSuggest()}
            disabled={suggesting}
          >
            {suggesting ? t('settingsEvaluation.suggesting') : t('settingsEvaluation.suggest')}
          </Button>
        </Stack>

        {seeds.length > 0 && (
          <Box sx={{ mb: 2 }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              {t('settingsEvaluation.resolutionTitle')}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              {t('settingsEvaluation.resolutionHelp')}
            </Typography>
            <Stack spacing={0.5}>
              {seeds.map((seed) => (
                <Box key={seed.input} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  {seed.resolved ? (
                    <CheckCircleIcon color="success" fontSize="small" />
                  ) : (
                    <ErrorOutlineIcon color="error" fontSize="small" />
                  )}
                  <Typography variant="body2" component="span">
                    {seed.input}
                  </Typography>
                  {seed.resolved ? (
                    // The matched title is shown ALWAYS, not only when it
                    // differs from what was typed. Reading it agree is how an
                    // admin learns to trust it on the rows where it does not.
                    <Typography variant="body2" component="span" color="text.secondary">
                      {'→ '}
                      {seed.matchedYear
                        ? `${seed.matchedTitle} (${seed.matchedYear})`
                        : seed.matchedTitle}
                    </Typography>
                  ) : (
                    <Typography variant="body2" component="span" color="error">
                      {t('settingsEvaluation.noMatch')}
                    </Typography>
                  )}
                </Box>
              ))}
            </Stack>
          </Box>
        )}

        {suggestions.length > 0 && (
          <Box>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              {t('settingsEvaluation.suggestionsTitle')}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              {t('settingsEvaluation.suggestionsHelp')}
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              {suggestions.map((s) => (
                <Tooltip
                  key={`${s.title}-${s.year ?? ''}`}
                  title={[
                    s.countries.join(', '),
                    s.voteCount != null
                      ? t('settingsEvaluation.votes', { count: s.voteCount })
                      : t('settingsEvaluation.noVotes'),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                >
                  <Chip
                    label={s.year ? `${s.title} (${s.year})` : s.title}
                    size="small"
                    icon={<AddIcon />}
                    onClick={() => addSuggestion(s.title)}
                    variant="outlined"
                  />
                </Tooltip>
              ))}
            </Box>
          </Box>
        )}
      </CardContent>
    </Card>
  )
}
