import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { alpha, Box, Button, ButtonBase, Paper, Typography, useTheme } from '@mui/material'
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
  onOpen: (item: FeaturedItem) => void
}

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
export function FeaturedPick({ picks, onOpen }: FeaturedPickProps) {
  const { t } = useTranslation()
  const theme = useTheme()
  const rtl = theme.direction === 'rtl'
  const [index, setIndex] = useState(0)
  if (picks.length === 0) return null
  const pick = picks[Math.min(index, picks.length - 1)]
  const behind = picks.find((p) => p !== pick)

  const runtime =
    pick.runtimeMinutes != null && pick.runtimeMinutes > 0
      ? pick.runtimeMinutes >= 60
        ? t('dashboard.featured.runtimeHm', { hours: Math.floor(pick.runtimeMinutes / 60), mins: pick.runtimeMinutes % 60 })
        : t('dashboard.featured.runtimeM', { mins: pick.runtimeMinutes })
      : null
  const meta = [pick.year, pick.genres.slice(0, 3).join(' · '), runtime].filter(Boolean)

  return (
    <Paper
      component="section"
      aria-labelledby="featured-pick-title"
      sx={{
        position: 'relative',
        overflow: 'hidden',
        mb: 4,
        borderRadius: { xs: 4, md: 6 },
        backgroundImage: 'none',
        border: 1,
        borderColor: alpha(theme.palette.text.primary, 0.06),
        display: 'grid',
        gridTemplateColumns: { xs: '120px minmax(0, 1fr)', md: 'minmax(0, 1fr) 380px' },
        gap: { xs: 2, md: 6 },
        alignItems: 'center',
        p: { xs: 2.5, md: '40px 56px' },
      }}
    >
      {/* A glow in the accent colour behind the poster */}
      <Box
        aria-hidden="true"
        sx={{
          position: 'absolute',
          insetInlineEnd: { xs: -60, md: -80 },
          top: { xs: -60, md: -80 },
          width: { xs: 260, md: 600 },
          height: { xs: 260, md: 600 },
          borderRadius: '50%',
          bgcolor: alpha(theme.palette.primary.main, 0.22),
          filter: 'blur(60px)',
          pointerEvents: 'none',
        }}
      />

      {/* The poster: first on a phone (beside the text), last on a desktop */}
      <Box sx={{ position: 'relative', order: { xs: 0, md: 1 }, height: { md: 450 }, display: 'flex', justifyContent: 'center' }}>
        {behind && (
          <Poster
            url={behind.posterUrl}
            title=""
            sx={{
              display: { xs: 'none', md: 'block' },
              position: 'absolute',
              top: 40,
              insetInlineEnd: 0,
              width: 220,
              borderRadius: 3.5,
              opacity: 0.45,
              transform: rtl ? 'rotate(-8deg)' : 'rotate(8deg)',
            }}
          />
        )}
        <ButtonBase
          onClick={() => onOpen(pick)}
          aria-label={pick.title}
          sx={{ position: 'relative', borderRadius: { xs: 3, md: 4 }, overflow: 'hidden', boxShadow: '0 30px 60px rgba(0,0,0,0.6)' }}
        >
          <Poster url={pick.posterUrl} title={pick.title} sx={{ width: { xs: 120, md: 300 } }} />
        </ButtonBase>
      </Box>

      <Box sx={{ position: 'relative', minWidth: 0, display: 'flex', flexDirection: 'column', gap: { xs: 1, md: 2 } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1.25 }}>
          <Typography
            sx={{ fontSize: { xs: 11, md: 12 }, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'primary.light' }}
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
          sx={{ fontSize: { xs: 24, md: 52 }, fontWeight: 800, lineHeight: 1.05, letterSpacing: '-0.02em' }}
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
              WebkitLineClamp: { xs: 3, md: 4 },
              overflow: 'hidden',
              fontSize: { xs: 13, md: 16 },
              lineHeight: 1.6,
              color: 'text.primary',
              maxWidth: 640,
            }}
          >
            {pick.explanation}
          </Typography>
        )}
        <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1.5, pt: { xs: 0.5, md: 1 } }}>
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
            <Box sx={{ display: 'flex', gap: 1, ms: { md: 1 } }}>
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
      </Box>
    </Paper>
  )
}
