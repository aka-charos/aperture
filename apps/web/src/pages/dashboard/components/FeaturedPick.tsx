import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { alpha, Box, Button, ButtonBase, Paper, Skeleton, Typography, useTheme } from '@mui/material'
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded'
import { getProxiedImageUrl, FALLBACK_POSTER_URL } from '@aperture/ui'

export interface FeaturedItem {
  id: string
  type: 'movie' | 'series'
  title: string
  year: number | null
  posterUrl: string | null
  genres: string[]
  matchScore: number | null
  explanation?: string | null
  runtimeMinutes?: number | null
}

interface FeaturedPickProps {
  /** The picks to feature, in order: each list's first recommendation. */
  picks: FeaturedItem[]
  /** Hold the panel's place while the dashboard loads, so the rows below do not jump. */
  loading?: boolean
  onOpen: (item: FeaturedItem) => void
}

/**
 * The panel sizes itself off its OWN width, never the window's: the page pane
 * is the window minus the sidebar and the docked assistant, so a window
 * breakpoint can hand a 380px poster column to a pane that has no room left
 * for the title beside it. Wide means room for that column and a readable
 * text column (380 + 48 gap + 112 padding + ~260 text).
 */
const WIDE = '@container featured (min-width: 800px)'

function Poster({ url, title, sx }: { url: string | null; title: string; sx: object }) {
  return (
    <Box
      component="img"
      src={url ? getProxiedImageUrl(url) : FALLBACK_POSTER_URL}
      alt={title}
      loading="lazy"
      sx={{ display: 'block', objectFit: 'cover', aspectRatio: '2 / 3', ...sx }}
    />
  )
}

/**
 * The top recommendation at the head of Home, led by its poster rather than a
 * backdrop: posters are what every title here has, and the server's own art
 * is never cropped to a banner. Several picks (the top movie and the top
 * series) page through the small posters under the text.
 */
export function FeaturedPick({ picks, loading = false, onOpen }: FeaturedPickProps) {
  const { t } = useTranslation()
  const theme = useTheme()
  const rtl = theme.direction === 'rtl'
  const [index, setIndex] = useState(0)

  if (!loading && picks.length === 0) return null
  const pick = loading ? null : picks[Math.min(index, picks.length - 1)]
  const behind = pick ? picks.find((p) => p !== pick) : undefined

  const runtime =
    pick?.runtimeMinutes != null && pick.runtimeMinutes > 0
      ? pick.runtimeMinutes >= 60
        ? t('dashboard.featured.runtimeHm', { hours: Math.floor(pick.runtimeMinutes / 60), mins: pick.runtimeMinutes % 60 })
        : t('dashboard.featured.runtimeM', { mins: pick.runtimeMinutes })
      : null
  const meta = pick ? [pick.year, pick.genres.slice(0, 3).join(' · '), runtime].filter(Boolean) : []

  return (
    <Box sx={{ containerType: 'inline-size', containerName: 'featured', mb: 4 }}>
      <Paper
        component="section"
        aria-labelledby={pick ? 'featured-pick-title' : undefined}
        aria-busy={loading || undefined}
        data-tour="home-featured"
        sx={{
          position: 'relative',
          overflow: 'hidden',
          borderRadius: 4,
          backgroundImage: 'none',
          border: 1,
          borderColor: alpha(theme.palette.text.primary, 0.06),
          display: 'grid',
          gridTemplateColumns: '120px minmax(0, 1fr)',
          gap: 2,
          alignItems: 'center',
          p: 2.5,
          [WIDE]: { borderRadius: 6, gridTemplateColumns: 'minmax(0, 1fr) 380px', gap: 6, p: '40px 56px' },
        }}
      >
        {/* A glow in the accent colour behind the poster */}
        <Box
          aria-hidden="true"
          sx={{
            position: 'absolute',
            insetInlineEnd: -60,
            top: -60,
            width: 260,
            height: 260,
            borderRadius: '50%',
            bgcolor: alpha(theme.palette.primary.main, 0.22),
            filter: 'blur(60px)',
            pointerEvents: 'none',
            [WIDE]: { insetInlineEnd: -80, top: -80, width: 600, height: 600 },
          }}
        />

        {/* The poster: first when narrow (beside the text), last when wide */}
        <Box sx={{ position: 'relative', display: 'flex', justifyContent: 'center', [WIDE]: { order: 1, height: 450 } }}>
          {loading || !pick ? (
            <Skeleton
              variant="rounded"
              sx={{ width: 120, height: 180, borderRadius: 3, [WIDE]: { width: 300, height: 450, borderRadius: 4 } }}
            />
          ) : (
            <>
              {behind && (
                <Poster
                  url={behind.posterUrl}
                  title=""
                  sx={{
                    display: 'none',
                    position: 'absolute',
                    top: 40,
                    insetInlineEnd: 0,
                    width: 220,
                    borderRadius: 3.5,
                    opacity: 0.45,
                    transform: rtl ? 'rotate(-8deg)' : 'rotate(8deg)',
                    [WIDE]: { display: 'block' },
                  }}
                />
              )}
              <ButtonBase
                onClick={() => onOpen(pick)}
                aria-label={pick.title}
                sx={{ position: 'relative', borderRadius: 3, overflow: 'hidden', boxShadow: '0 30px 60px rgba(0,0,0,0.6)', [WIDE]: { borderRadius: 4 } }}
              >
                <Poster url={pick.posterUrl} title={pick.title} sx={{ width: 120, [WIDE]: { width: 300 } }} />
              </ButtonBase>
            </>
          )}
        </Box>

        <Box sx={{ position: 'relative', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1, [WIDE]: { gap: 2 } }}>
          {loading || !pick ? (
            <>
              <Skeleton width={180} height={20} />
              <Skeleton sx={{ width: '70%', height: 36, [WIDE]: { height: 64 } }} />
              <Skeleton width="40%" />
              <Skeleton width="90%" />
              <Skeleton width="80%" />
            </>
          ) : (
            <>
              <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1.25 }}>
                <Typography
                  sx={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'primary.light', [WIDE]: { fontSize: 12 } }}
                >
                  {pick.type === 'movie' ? t('dashboard.featured.movie') : t('dashboard.featured.series')}
                </Typography>
                {pick.matchScore != null && (
                  <Box
                    component="span"
                    sx={{ fontSize: 12, fontWeight: 700, px: 1.25, py: 0.5, borderRadius: 999, bgcolor: 'primary.main', color: 'primary.contrastText' }}
                  >
                    {t('dashboard.featured.match', { score: pick.matchScore })}
                  </Box>
                )}
              </Box>
              <Typography
                id="featured-pick-title"
                component="h2"
                sx={{ fontSize: 24, fontWeight: 800, lineHeight: 1.05, letterSpacing: '-0.02em', [WIDE]: { fontSize: 52 } }}
              >
                {pick.title}
              </Typography>
              {meta.length > 0 && (
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  {meta.join('  •  ')}
                </Typography>
              )}
              {pick.explanation && (
                <Typography
                  sx={{
                    display: '-webkit-box',
                    WebkitBoxOrient: 'vertical',
                    WebkitLineClamp: 3,
                    overflow: 'hidden',
                    fontSize: 13,
                    lineHeight: 1.6,
                    color: 'text.primary',
                    maxWidth: 640,
                    [WIDE]: { WebkitLineClamp: 4, fontSize: 16 },
                  }}
                >
                  {pick.explanation}
                </Typography>
              )}
              <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1.5, pt: 0.5, [WIDE]: { pt: 1 } }}>
                <Button
                  variant="contained"
                  disableElevation
                  onClick={() => onOpen(pick)}
                  endIcon={<ArrowForwardRoundedIcon sx={{ transform: rtl ? 'scaleX(-1)' : 'none' }} />}
                  sx={{ minHeight: 44, borderRadius: 3, px: 2.5, fontWeight: 700 }}
                >
                  {t('dashboard.featured.open')}
                </Button>
                {picks.length > 1 && (
                  <Box sx={{ display: 'flex', gap: 1 }}>
                    {picks.map((p, i) => (
                      <ButtonBase
                        key={`${p.type}-${p.id}`}
                        onClick={() => setIndex(i)}
                        aria-label={t('dashboard.featured.show', { title: p.title })}
                        aria-pressed={p === pick}
                        sx={{
                          width: 40,
                          borderRadius: 1.5,
                          overflow: 'hidden',
                          outline: p === pick ? `2px solid ${theme.palette.primary.main}` : '2px solid transparent',
                          outlineOffset: 2,
                          opacity: p === pick ? 1 : 0.55,
                          transition: 'opacity 0.15s',
                          '&:hover': { opacity: 1 },
                        }}
                      >
                        <Poster url={p.posterUrl} title="" sx={{ width: 40 }} />
                      </ButtonBase>
                    ))}
                  </Box>
                )}
              </Box>
            </>
          )}
        </Box>
      </Paper>
    </Box>
  )
}
