import { useEffect, type ReactNode } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { alpha, Box, Button, CircularProgress, Paper, Typography, useTheme } from '@mui/material'
import CheckRoundedIcon from '@mui/icons-material/CheckRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome'
import HourglassEmptyRoundedIcon from '@mui/icons-material/HourglassEmptyRounded'
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded'
import MovieOutlinedIcon from '@mui/icons-material/MovieOutlined'
import StarRoundedIcon from '@mui/icons-material/StarRounded'
import FavoriteBorderIcon from '@mui/icons-material/FavoriteBorder'
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline'
import LiveTvOutlinedIcon from '@mui/icons-material/LiveTvOutlined'
import { useOnboarding } from '@/hooks/useOnboarding'
import { Badge, IconTile } from '@/components/tour/IconTile'

/**
 * Where each item takes you, and its picture. The server decides which items
 * exist and which are done (`/api/onboarding`); this only knows where in the
 * app each is done. An item with no destination (watching something happens
 * on the media server) is not a link.
 */
const ITEMS: Record<string, { path?: string; icon: typeof MovieOutlinedIcon }> = {
  watch: { icon: MovieOutlinedIcon },
  rate: { path: '/browse', icon: StarRoundedIcon },
  interest: { path: '/settings?tab=recommendations', icon: FavoriteBorderIcon },
  why: { path: '/recommendations', icon: AutoAwesomeIcon },
  assistant: { path: '/assistant', icon: ChatBubbleOutlineIcon },
  watching: { path: '/watching', icon: LiveTvOutlinedIcon },
}

type Item = { id: string; done: boolean; progress?: number; goal?: number }

/**
 * The getting-started checklist at the top of Home: what teaches the
 * recommender about you, ticked off from your own record, and whether your
 * first picks exist yet — the answer to "why is my Recommendations page
 * empty?" for a new account. Gone once everything is done, or when hidden.
 *
 * The first item left that has somewhere to go is drawn as "next up", so the
 * card says what to do rather than only what is missing.
 */
export function GettingStartedCard() {
  const { t } = useTranslation()
  const theme = useTheme()
  const { summary, record, refresh } = useOnboarding()

  // Coming back to Home after rating something is when the list should move.
  useEffect(() => {
    refresh()
  }, [refresh])

  if (!summary) return null
  const { checklist, state } = summary
  if (checklist.complete || state.checklistDismissed) return null

  const done = checklist.items.filter((item) => item.done).length
  const total = checklist.items.length
  const nextUp = checklist.items.find((item) => !item.done && ITEMS[item.id]?.path)?.id
  const progressLabel = t('onboarding.checklist.progress', { done, total })
  const track = alpha(theme.palette.text.primary, 0.1)

  return (
    <Paper
      component="section"
      aria-labelledby="getting-started-title"
      data-tour="home-checklist"
      sx={{
        mb: 4,
        p: { xs: 2, sm: 3.5 },
        borderRadius: 4.5,
        backgroundImage: 'none',
        border: 1,
        borderColor: alpha(theme.palette.text.primary, 0.08),
        display: 'flex',
        flexDirection: 'column',
        gap: 2.75,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: 1.5, sm: 2.5 } }}>
        {/* Progress ring */}
        <Box role="img" aria-label={progressLabel} sx={{ position: 'relative', width: 72, height: 72, flex: '0 0 auto' }}>
          <CircularProgress variant="determinate" value={100} size={72} thickness={5} sx={{ color: track, position: 'absolute', inset: 0 }} />
          <CircularProgress
            variant="determinate"
            value={total > 0 ? (done / total) * 100 : 0}
            size={72}
            thickness={5}
            sx={{ position: 'absolute', inset: 0, '& .MuiCircularProgress-circle': { strokeLinecap: 'round' } }}
          />
          <Box aria-hidden="true" sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
            <Typography component="span" sx={{ fontSize: 17, fontWeight: 700 }}>
              {done}
              <Box component="span" sx={{ color: 'text.secondary', fontWeight: 500, fontSize: 13 }}>
                /{total}
              </Box>
            </Typography>
          </Box>
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography id="getting-started-title" component="h2" sx={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.01em' }}>
            {t('onboarding.checklist.title')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('onboarding.checklist.subtitle')}
          </Typography>
        </Box>
        <Button
          variant="outlined"
          color="inherit"
          startIcon={<CloseRoundedIcon />}
          aria-label={t('onboarding.checklist.dismiss')}
          onClick={() => record({ checklistDismissed: true })}
          sx={{ minHeight: 44, borderRadius: 2.5, color: 'text.secondary', borderColor: alpha(theme.palette.text.primary, 0.12), flex: '0 0 auto' }}
        >
          {t('onboarding.checklist.hide')}
        </Button>
      </Box>

      <Box
        component="ul"
        sx={{
          m: 0,
          p: 0,
          listStyle: 'none',
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', md: 'repeat(3, minmax(0, 1fr))' },
          gap: 1.75,
        }}
      >
        {checklist.items.map((item) => (
          <Box component="li" key={item.id} sx={{ display: 'flex' }}>
            <ChecklistTile item={item} nextUp={item.id === nextUp} />
          </Box>
        ))}
      </Box>

      {checklist.recommendations !== 'off' && (
        <StatusBand ready={checklist.recommendations === 'ready'}>
          {t(`onboarding.checklist.recommendations.${checklist.recommendations}`)}
        </StatusBand>
      )}
    </Paper>
  )
}

function ChecklistTile({ item, nextUp }: { item: Item; nextUp: boolean }) {
  const { t } = useTranslation()
  const theme = useTheme()
  const rtl = theme.direction === 'rtl'
  const meta = ITEMS[item.id] ?? { icon: AutoAwesomeIcon }
  const Icon = item.done ? CheckRoundedIcon : meta.icon
  const counted = item.goal != null && !item.done
  const linked = Boolean(meta.path) && !item.done

  const iconTile = (
    <IconTile tone={item.done ? 'success' : nextUp ? 'solid' : 'neutral'}>
      <Icon />
    </IconTile>
  )

  const body = (
    <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
        <Typography sx={{ fontSize: 14, fontWeight: 600, color: item.done ? 'text.secondary' : 'text.primary' }}>
          {t(`onboarding.checklist.items.${item.id}.title`)}
        </Typography>
        {nextUp && <Badge>{t('onboarding.checklist.nextUp')}</Badge>}
        {item.done && <Box component="span" sx={visuallyHidden}>{t('onboarding.checklist.done')}</Box>}
      </Box>
      <Typography sx={{ fontSize: 13, lineHeight: 1.45, color: item.done ? 'text.disabled' : 'text.secondary' }}>
        {counted
          ? t('onboarding.checklist.counted', { progress: item.progress ?? 0, goal: item.goal })
          : t(`onboarding.checklist.items.${item.id}.detail`)}
      </Typography>
      {counted && (
        <Box aria-hidden="true" sx={{ display: 'grid', gridTemplateColumns: `repeat(${item.goal}, minmax(0, 1fr))`, gap: 0.5, mt: 0.5 }}>
          {Array.from({ length: item.goal ?? 0 }, (_, i) => (
            <Box
              key={i}
              sx={{ height: 4, borderRadius: 2, bgcolor: i < (item.progress ?? 0) ? 'primary.main' : alpha(theme.palette.text.primary, 0.12) }}
            />
          ))}
        </Box>
      )}
    </Box>
  )

  const tileSx = {
    flex: 1,
    display: 'flex',
    gap: 1.75,
    p: 2,
    borderRadius: 3.5,
    textAlign: 'start' as const,
    color: 'inherit',
    textDecoration: 'none',
    bgcolor: item.done
      ? alpha(theme.palette.text.primary, 0.02)
      : nextUp
        ? alpha(theme.palette.primary.main, 0.08)
        : alpha(theme.palette.text.primary, 0.04),
    border: nextUp ? 1.5 : 1,
    borderColor: nextUp ? 'primary.main' : alpha(theme.palette.text.primary, item.done ? 0.05 : 0.08),
    transition: 'background-color 0.15s, border-color 0.15s',
  }

  if (!linked) return <Box sx={tileSx}>{iconTile}{body}</Box>

  return (
    <Box
      component={RouterLink}
      to={meta.path!}
      sx={{
        ...tileSx,
        '&:hover': {
          bgcolor: nextUp ? alpha(theme.palette.primary.main, 0.12) : alpha(theme.palette.text.primary, 0.07),
          borderColor: nextUp ? 'primary.light' : alpha(theme.palette.text.primary, 0.16),
        },
        '&:focus-visible': { outline: `2px solid ${theme.palette.primary.light}`, outlineOffset: 2 },
      }}
    >
      {iconTile}
      {body}
      <ChevronRightRoundedIcon
        aria-hidden="true"
        sx={{ alignSelf: 'center', flex: '0 0 auto', color: nextUp ? 'primary.light' : 'text.disabled', transform: rtl ? 'scaleX(-1)' : 'none' }}
      />
    </Box>
  )
}

function StatusBand({ ready, children }: { ready: boolean; children: ReactNode }) {
  const theme = useTheme()
  const band = (
    <>
      <IconTile tone={ready ? 'primary' : 'warning'}>
        {ready ? <AutoAwesomeIcon /> : <HourglassEmptyRoundedIcon />}
      </IconTile>
      <Typography variant="body2" sx={{ flex: 1, color: 'text.primary', lineHeight: 1.5 }}>
        {children}
      </Typography>
    </>
  )
  const sx = {
    display: 'flex',
    alignItems: 'center',
    gap: 1.75,
    px: 2,
    py: 1.75,
    borderRadius: 3,
    border: '1px dashed',
    borderColor: alpha(theme.palette.text.primary, 0.14),
    bgcolor: alpha(theme.palette.common.black, 0.15),
    color: 'inherit',
    textDecoration: 'none',
  }
  return ready ? (
    <Box component={RouterLink} to="/recommendations" sx={{ ...sx, '&:hover': { borderColor: 'primary.main' } }}>
      {band}
    </Box>
  ) : (
    <Box sx={sx}>{band}</Box>
  )
}

const visuallyHidden = {
  position: 'absolute' as const,
  // Strings: in sx a bare 1 means 100%.
  width: '1px',
  height: '1px',
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap' as const,
}
