import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Grid,
  Skeleton,
  Typography,
} from '@mui/material'
import { useTheme } from '@mui/material/styles'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome'
import MovieIcon from '@mui/icons-material/Movie'
import TvIcon from '@mui/icons-material/Tv'
import StarIcon from '@mui/icons-material/Star'
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth'
import PlayCircleOutlineIcon from '@mui/icons-material/PlayCircleOutline'
import TheaterComedyIcon from '@mui/icons-material/TheaterComedy'
import Markdown from 'react-markdown'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/hooks/useAuth'

export interface WatcherIdentityStats {
  totalWatched: number
  totalSeriesStarted?: number
  totalEpisodesWatched?: number
  topGenres: string[]
  avgRating: number
  favoriteDecade: string | null
  favoriteNetworks?: string[]
}

interface ProfileOutput {
  synopsis: string
  stats: WatcherIdentityStats
}

interface WatcherIdentityCardProps {
  mediaType: 'movie' | 'series'
}

/**
 * The AI-written account of what someone watches, plus the four figures behind
 * it.
 *
 * It lives in `components/` rather than beside the taste-profile settings
 * because it is rendered in two places — the Watcher Identity settings tab,
 * where the knobs that shape it are edited, and the Watch Stats page, where it
 * is the sentence version of everything the charts count. Two copies would
 * drift the first time the streaming format changed.
 */
export function WatcherIdentityCard({ mediaType }: WatcherIdentityCardProps) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const theme = useTheme()

  const [profileOutput, setProfileOutput] = useState<ProfileOutput | null>(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // A fetch that lands after a generate finished would overwrite the fresh
  // text with whatever was stored before it.
  const justGeneratedRef = useRef(false)

  const isMovie = mediaType === 'movie'
  const accentColor = isMovie ? theme.palette.primary.main : '#ec4899'
  const endpointBase = isMovie ? 'taste-profile' : 'series-taste-profile'

  const fetchProfile = useCallback(async () => {
    if (!user?.id) return
    setLoading(true)
    try {
      const response = await fetch(`/api/users/${user.id}/${endpointBase}`, {
        credentials: 'include',
      })
      if (response.ok && !justGeneratedRef.current) {
        setProfileOutput(await response.json())
      }
      justGeneratedRef.current = false
    } catch (err) {
      setError(err instanceof Error ? err.message : t('watcherIdentity.errFetchData'))
    } finally {
      setLoading(false)
    }
  }, [user?.id, endpointBase, t])

  useEffect(() => {
    fetchProfile()
  }, [fetchProfile])

  const handleGenerate = async () => {
    setGenerating(true)
    setIsStreaming(true)
    setStreamingText('')
    setError(null)

    try {
      const response = await fetch(`/api/users/${user?.id}/${endpointBase}/regenerate`, {
        method: 'POST',
        credentials: 'include',
      })
      if (!response.ok) throw new Error(t('watcherIdentity.errGenerateIdentity'))

      const contentType = response.headers.get('content-type')
      if (contentType?.includes('text/event-stream')) {
        const reader = response.body?.getReader()
        const decoder = new TextDecoder()
        if (reader) {
          let fullText = ''
          let buffer = ''
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })
            const events = buffer.split('\n\n')
            buffer = events.pop() || ''
            for (const event of events) {
              if (!event.trim()) continue
              const dataMatch = event.match(/^data:\s*(.+)$/m)
              if (!dataMatch) continue
              try {
                const data = JSON.parse(dataMatch[1])
                if (data.type === 'text') {
                  fullText += data.content
                  setStreamingText(fullText)
                } else if (data.type === 'done' && data.stats) {
                  justGeneratedRef.current = true
                  setProfileOutput({ synopsis: fullText, stats: data.stats })
                } else if (data.type === 'error') {
                  throw new Error(data.message || t('watcherIdentity.errStreamError'))
                }
              } catch {
                // A chunk can split mid-JSON; the next read completes it.
              }
            }
          }
        }
      } else {
        const result = await response.json()
        setProfileOutput(result)
        setStreamingText(result.synopsis || '')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('watcherIdentity.errGenerateIdentity'))
    } finally {
      setGenerating(false)
      setIsStreaming(false)
    }
  }

  const displaySynopsis = isStreaming ? streamingText : profileOutput?.synopsis || ''
  const stats = profileOutput?.stats

  return (
    <Card sx={{ borderRadius: 2.5, height: '100%' }}>
      <CardContent sx={{ p: 2.5, '&:last-child': { pb: 2.5 } }}>
        <Box display="flex" alignItems="center" justifyContent="space-between" gap={2} mb={2}>
          <Box display="flex" alignItems="center" gap={1.5} minWidth={0}>
            <Box
              sx={{
                width: 40,
                height: 40,
                borderRadius: 2,
                flexShrink: 0,
                background: `linear-gradient(135deg, ${accentColor} 0%, ${
                  isMovie ? theme.palette.secondary.main : '#f472b6'
                } 100%)`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {isMovie ? (
                <MovieIcon sx={{ color: 'white', fontSize: 22 }} />
              ) : (
                <TvIcon sx={{ color: 'white', fontSize: 22 }} />
              )}
            </Box>
            <Box minWidth={0}>
              <Typography variant="subtitle1" fontWeight={700} noWrap>
                {isMovie
                  ? t('watcherIdentity.movieIdentityTitle')
                  : t('watcherIdentity.seriesIdentityTitle')}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {t('watcherIdentity.identitySubtitle')}
              </Typography>
            </Box>
          </Box>

          <Button
            variant={displaySynopsis ? 'outlined' : 'contained'}
            size="small"
            startIcon={
              generating ? <CircularProgress size={16} color="inherit" /> : <AutoAwesomeIcon />
            }
            onClick={handleGenerate}
            disabled={generating}
            sx={{
              flexShrink: 0,
              ...(displaySynopsis
                ? { color: accentColor, borderColor: accentColor }
                : { bgcolor: accentColor, '&:hover': { bgcolor: accentColor, filter: 'brightness(1.1)' } }),
            }}
          >
            {generating
              ? t('watcherIdentity.generating')
              : displaySynopsis
                ? t('watcherIdentity.regenerateIdentity')
                : t('watcherIdentity.generateIdentity')}
          </Button>
        </Box>

        {error && (
          <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {loading ? (
          <Skeleton variant="rectangular" height={120} sx={{ borderRadius: 2, mb: 2 }} />
        ) : displaySynopsis ? (
          <Box
            sx={{
              pl: 2,
              mb: 2.5,
              borderInlineStart: '3px solid',
              borderColor: accentColor,
              '& p': {
                margin: 0,
                mb: 1.5,
                lineHeight: 1.75,
                color: 'text.primary',
                '&:last-child': { mb: 0 },
              },
              '& strong': { color: accentColor, fontWeight: 600 },
            }}
          >
            <Markdown>{displaySynopsis}</Markdown>
            {isStreaming && (
              <Box
                component="span"
                sx={{
                  display: 'inline-block',
                  width: 8,
                  height: 16,
                  bgcolor: accentColor,
                  ml: 0.5,
                  animation: 'identity-caret 1s infinite',
                  '@keyframes identity-caret': {
                    '0%, 50%': { opacity: 1 },
                    '51%, 100%': { opacity: 0 },
                  },
                }}
              />
            )}
          </Box>
        ) : (
          <Box
            sx={{
              py: 4,
              mb: 2.5,
              textAlign: 'center',
              border: '1px dashed',
              borderColor: 'divider',
              borderRadius: 2,
            }}
          >
            <Typography color="text.secondary" gutterBottom>
              {t('watcherIdentity.noIdentityYet')}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {isMovie
                ? t('watcherIdentity.generateIdentityHintMovie', {
                    action: t('watcherIdentity.generateIdentity'),
                  })
                : t('watcherIdentity.generateIdentityHintSeries', {
                    action: t('watcherIdentity.generateIdentity'),
                  })}
            </Typography>
          </Box>
        )}

        {stats && (
          <Grid container spacing={1.5}>
            <Grid item xs={6} sm={3}>
              <IdentityStat
                icon={<PlayCircleOutlineIcon sx={{ color: accentColor, fontSize: 22 }} />}
                value={
                  isMovie
                    ? stats.totalWatched?.toLocaleString() || '0'
                    : `${stats.totalSeriesStarted || 0} / ${
                        stats.totalEpisodesWatched?.toLocaleString() || 0
                      }`
                }
                label={
                  isMovie
                    ? t('watcherIdentity.moviesWatched')
                    : t('watcherIdentity.seriesEpisodesLabel')
                }
              />
            </Grid>
            <Grid item xs={6} sm={3}>
              <IdentityStat
                icon={<StarIcon sx={{ color: '#facc15', fontSize: 22 }} />}
                value={stats.avgRating ? `${stats.avgRating.toFixed(1)}/10` : '—'}
                label={t('watcherIdentity.avgRating')}
              />
            </Grid>
            <Grid item xs={6} sm={3}>
              <IdentityStat
                icon={<CalendarMonthIcon sx={{ color: theme.palette.success.main, fontSize: 22 }} />}
                value={stats.favoriteDecade || '—'}
                label={t('watcherIdentity.favoriteEra')}
              />
            </Grid>
            <Grid item xs={6} sm={3}>
              <IdentityStat
                icon={<TheaterComedyIcon sx={{ color: '#f472b6', fontSize: 22 }} />}
                value={
                  <Box display="flex" gap={0.5} flexWrap="wrap" justifyContent="center">
                    {stats.topGenres?.slice(0, 3).map(genre => (
                      <Chip
                        key={genre}
                        label={genre}
                        size="small"
                        sx={{ fontSize: '0.6rem', height: 18 }}
                      />
                    ))}
                  </Box>
                }
                label={t('watcherIdentity.topGenres')}
              />
            </Grid>
          </Grid>
        )}
      </CardContent>
    </Card>
  )
}

function IdentityStat({
  icon,
  value,
  label,
}: {
  icon: ReactNode
  value: ReactNode
  label: string
}) {
  return (
    <Box
      sx={{
        p: 1.5,
        height: '100%',
        textAlign: 'center',
        borderRadius: 2,
        bgcolor: 'background.default',
      }}
    >
      {icon}
      <Typography variant="subtitle2" fontWeight={700} sx={{ mt: 0.5, minHeight: 22 }}>
        {value}
      </Typography>
      <Typography variant="caption" color="text.secondary" display="block">
        {label}
      </Typography>
    </Box>
  )
}
