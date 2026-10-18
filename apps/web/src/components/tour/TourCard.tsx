import { forwardRef, type KeyboardEvent, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { alpha, Box, Button, Paper, Typography, useTheme } from '@mui/material'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome'
import StarRoundedIcon from '@mui/icons-material/StarRounded'
import StarOutlineRoundedIcon from '@mui/icons-material/StarOutlineRounded'
import SearchIcon from '@mui/icons-material/Search'
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline'
import ExploreOutlinedIcon from '@mui/icons-material/ExploreOutlined'
import HelpOutlineIcon from '@mui/icons-material/HelpOutline'
import AccountCircleOutlinedIcon from '@mui/icons-material/AccountCircleOutlined'
import ChecklistIcon from '@mui/icons-material/Checklist'
import InsightsIcon from '@mui/icons-material/Insights'
import ViewCarouselOutlinedIcon from '@mui/icons-material/ViewCarouselOutlined'
import TabIcon from '@mui/icons-material/Tab'
import FilterListRoundedIcon from '@mui/icons-material/FilterListRounded'
import GridViewOutlinedIcon from '@mui/icons-material/GridViewOutlined'
import MovieOutlinedIcon from '@mui/icons-material/MovieOutlined'
import PlayCircleOutlineIcon from '@mui/icons-material/PlayCircleOutline'
import ArticleOutlinedIcon from '@mui/icons-material/ArticleOutlined'
import HubOutlinedIcon from '@mui/icons-material/HubOutlined'
import TuneIcon from '@mui/icons-material/Tune'
import PlaylistPlayIcon from '@mui/icons-material/PlaylistPlay'
import FavoriteBorderIcon from '@mui/icons-material/FavoriteBorder'
import RefreshIcon from '@mui/icons-material/Refresh'
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded'
import MenuBookIcon from '@mui/icons-material/MenuBook'
import ScheduleRoundedIcon from '@mui/icons-material/ScheduleRounded'
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded'
import { stepItemKey, stepKey, type TourIcon, type TourId, type TourStep } from './tours'
import { IconTile } from './IconTile'

const ICONS: Record<TourIcon, typeof AutoAwesomeIcon> = {
  sparkle: AutoAwesomeIcon,
  star: StarRoundedIcon,
  search: SearchIcon,
  chat: ChatBubbleOutlineIcon,
  compass: ExploreOutlinedIcon,
  help: HelpOutlineIcon,
  person: AccountCircleOutlinedIcon,
  checklist: ChecklistIcon,
  stats: InsightsIcon,
  rows: ViewCarouselOutlinedIcon,
  tabs: TabIcon,
  filter: FilterListRoundedIcon,
  grid: GridViewOutlinedIcon,
  film: MovieOutlinedIcon,
  play: PlayCircleOutlineIcon,
  article: ArticleOutlinedIcon,
  graph: HubOutlinedIcon,
  tune: TuneIcon,
  playlist: PlaylistPlayIcon,
  heart: FavoriteBorderIcon,
  refresh: RefreshIcon,
}

/** The card's own surface. Set flat: MUI tints a dark-mode Paper by elevation, and the pointer must match it exactly. */
export const CARD_SURFACE = 'background.paper'

interface CardProps {
  tour: TourId
  step: TourStep
  index: number
  total: number
  titleId: string
  bodyId: string
  rtl: boolean
  onKeyDown: (event: KeyboardEvent) => void
  onNext: () => void
  onBack: () => void
  onSkip: () => void
  onReadMore?: () => void
  onExplainer?: () => void
  /** The pointer toward the element, when the card sits beside one. */
  arrow?: ReactElement
}

/** Forward arrows point the reading direction. */
function forward(rtl: boolean) {
  return rtl ? { transform: 'scaleX(-1)' } : undefined
}

/** One segment per step, the ones done filled. */
function StepProgress({ index, total, label }: { index: number; total: number; label: string }) {
  return (
    <Box
      role="img"
      aria-label={label}
      sx={{ display: 'grid', gridTemplateColumns: `repeat(${total}, minmax(0, 1fr))`, gap: 0.5 }}
    >
      {Array.from({ length: total }, (_, i) => (
        <Box
          key={i}
          sx={{
            height: 4,
            borderRadius: 2,
            bgcolor: i <= index ? 'primary.main' : (theme) => alpha(theme.palette.text.primary, 0.14),
          }}
        />
      ))}
    </Box>
  )
}

const cardSx = {
  outline: 'none',
  bgcolor: CARD_SURFACE,
  backgroundImage: 'none',
  border: 1,
  borderColor: (theme: { palette: { text: { primary: string } } }) => alpha(theme.palette.text.primary, 0.1),
  boxShadow: '0 24px 64px rgba(0,0,0,0.55)',
  position: 'relative' as const,
}

/** A step beside the element it points at, or centred when there is none. */
export const StepCard = forwardRef<HTMLDivElement, CardProps>(function StepCard(props, ref) {
  const { t } = useTranslation()
  const { tour, step, index, total, titleId, bodyId, rtl } = props
  const Icon = ICONS[step.icon]
  const isFirst = index === 0
  const isLast = index === total - 1
  const progress = t('onboarding.tour.progress', { current: index + 1, total })

  return (
    <Paper
      ref={ref}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      onKeyDown={props.onKeyDown}
      sx={{
        ...cardSx,
        width: 'min(392px, calc(100vw - 32px))',
        borderRadius: 4,
        p: 2.75,
        pb: 2,
        display: 'flex',
        flexDirection: 'column',
        gap: 1.75,
      }}
    >
      {props.arrow}

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <IconTile>
          <Icon />
        </IconTile>
        <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
          <Typography variant="caption" color="text.secondary" fontWeight={500} aria-hidden="true">
            {progress}
          </Typography>
          <StepProgress index={index} total={total} label={progress} />
        </Box>
      </Box>

      {/* Not a live region: the card takes focus on every step, and focus on a
          dialog already reads its name and this description. Both would read
          the step twice. */}
      <Box id={bodyId} sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Typography id={titleId} component="h2" sx={{ fontSize: 19, fontWeight: 700, lineHeight: 1.3, letterSpacing: '-0.01em' }}>
          {t(stepKey(tour, step.id, 'title'))}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.6 }}>
          {t(stepKey(tour, step.id, 'body'))}
        </Typography>
        {step.items && (
          <Box component="ul" sx={{ m: 0, p: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 0.75 }}>
            {step.items.map((item) => (
              <Box component="li" key={item.id} sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                <ChevronRightRoundedIcon sx={{ fontSize: 18, mt: '1px', color: 'primary.light', ...forward(rtl) }} />
                <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.5 }}>
                  {t(stepItemKey(tour, step.id, item.id))}
                </Typography>
              </Box>
            ))}
          </Box>
        )}
      </Box>

      {(props.onReadMore || props.onExplainer) && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
          {props.onExplainer && (
            <LinkChip icon={<AutoAwesomeIcon sx={{ fontSize: 16 }} />} onClick={props.onExplainer}>
              {t('onboarding.tour.howPicksAreMade')}
            </LinkChip>
          )}
          {props.onReadMore && (
            <LinkChip icon={<MenuBookIcon sx={{ fontSize: 16 }} />} onClick={props.onReadMore}>
              {t('onboarding.tour.readMore')}
            </LinkChip>
          )}
        </Box>
      )}

      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          pt: 1.25,
          borderTop: 1,
          borderColor: (theme) => alpha(theme.palette.text.primary, 0.07),
        }}
      >
        <Button onClick={props.onSkip} color="inherit" sx={{ color: 'text.secondary', minHeight: 44, px: 1 }}>
          {isLast ? t('onboarding.tour.close') : t('onboarding.tour.skip')}
        </Button>
        <Box sx={{ flex: 1 }} />
        {!isFirst && (
          <Button
            variant="outlined"
            color="inherit"
            onClick={props.onBack}
            sx={{ minHeight: 44, borderRadius: 2.5, borderColor: (theme) => alpha(theme.palette.text.primary, 0.14) }}
          >
            {t('onboarding.tour.back')}
          </Button>
        )}
        <Button
          variant="contained"
          disableElevation
          onClick={props.onNext}
          endIcon={isLast ? undefined : <ArrowForwardRoundedIcon sx={forward(rtl)} />}
          sx={{ minHeight: 44, borderRadius: 2.5, px: 2.25, fontWeight: 600 }}
        >
          {isLast ? t('onboarding.tour.done') : t('onboarding.tour.next')}
        </Button>
      </Box>
    </Paper>
  )
})

function LinkChip({ icon, onClick, children }: { icon: ReactElement; onClick: () => void; children: string }) {
  return (
    <Button
      size="small"
      color="inherit"
      onClick={onClick}
      startIcon={icon}
      sx={{
        borderRadius: 999,
        px: 1.5,
        minHeight: 36,
        fontWeight: 500,
        color: 'text.primary',
        bgcolor: (theme) => alpha(theme.palette.text.primary, 0.06),
        border: 1,
        borderColor: (theme) => alpha(theme.palette.text.primary, 0.08),
        '& .MuiButton-startIcon': { color: 'primary.light' },
        '&:hover': { bgcolor: (theme) => alpha(theme.palette.text.primary, 0.1) },
      }}
    >
      {children}
    </Button>
  )
}

/**
 * A flat tint over the card's surface: solid, so posters that overlap in the
 * fan do not show through one another, and from the theme, so a brand colour
 * change reaches the picture too.
 */
function tinted(tint: string, surface: string): string {
  return `linear-gradient(${tint}, ${tint}), ${surface}`
}

/** The picture is drawn at this height and scaled down whole on a phone. */
const ILLUSTRATION_HEIGHT = 220
const ILLUSTRATION_PHONE_SCALE = 0.68

/**
 * The welcome tour's first card: a picture of what Aperture does (a fan of
 * posters, the middle one being rated), what the tour is, and how to leave it.
 */
export const WelcomeCard = forwardRef<HTMLDivElement, CardProps & { showKeys: boolean }>(function WelcomeCard(props, ref) {
  const { t } = useTranslation()
  const theme = useTheme()
  const { total, titleId, bodyId, rtl } = props
  const surface = theme.palette.background.paper
  const fan = [
    { tint: alpha(theme.palette.text.primary, 0.08), x: -176, r: -14, y: 22 },
    { tint: alpha(theme.palette.info.main, 0.22), x: -92, r: -7, y: 6 },
    { tint: alpha(theme.palette.warning.main, 0.18), x: 176, r: 14, y: 22 },
    { tint: alpha(theme.palette.success.main, 0.18), x: 92, r: 7, y: 6 },
  ]
  const pill = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 1,
    px: 1.5,
    py: 0.75,
    borderRadius: 999,
    fontSize: 13,
    fontWeight: 500,
    color: 'primary.light',
    bgcolor: alpha(theme.palette.primary.main, 0.12),
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
      <Paper
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        onKeyDown={props.onKeyDown}
        sx={{ ...cardSx, width: 'min(560px, calc(100vw - 32px))', borderRadius: 5, overflow: 'hidden' }}
      >
        {/* The picture. On a phone the stage inside is scaled down whole
            and the frame is given the scaled height, since a transform does
            not change how much room an element takes. */}
        <Box
          aria-hidden="true"
          sx={{
            height: { xs: ILLUSTRATION_HEIGHT * ILLUSTRATION_PHONE_SCALE, sm: ILLUSTRATION_HEIGHT },
            position: 'relative',
            overflow: 'hidden',
            bgcolor: alpha(theme.palette.common.black, 0.25),
            borderBottom: 1,
            borderColor: alpha(theme.palette.text.primary, 0.06),
          }}
        >
          <Box
            sx={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: ILLUSTRATION_HEIGHT,
              transform: { xs: `scale(${ILLUSTRATION_PHONE_SCALE})`, sm: 'none' },
              transformOrigin: 'top center',
            }}
          >
          {fan.map((p, i) => (
            <Box
              key={i}
              sx={{
                position: 'absolute',
                left: '50%',
                top: 40,
                width: 96,
                height: 144,
                ml: '-48px',
                borderRadius: 2.5,
                background: tinted(p.tint, surface),
                border: 1,
                borderColor: alpha(theme.palette.text.primary, 0.06),
                transform: `translateX(${p.x}px) rotate(${p.r}deg) translateY(${p.y}px)`,
              }}
            />
          ))}
          <Box
            sx={{
              position: 'absolute',
              left: '50%',
              top: 26,
              width: 112,
              height: 168,
              ml: '-56px',
              borderRadius: 3,
              background: tinted(alpha(theme.palette.primary.main, 0.3), surface),
              border: 2,
              borderColor: 'primary.main',
              boxShadow: '0 16px 40px rgba(0,0,0,0.5)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'flex-end',
              gap: 0.75,
              p: 1.25,
              boxSizing: 'border-box',
            }}
          >
            <Box sx={{ height: 6, width: '70%', borderRadius: 1, bgcolor: alpha('#fff', 0.28) }} />
            <Box sx={{ height: 6, width: '44%', borderRadius: 1, bgcolor: alpha('#fff', 0.16) }} />
          </Box>
          <Box
            sx={{
              position: 'absolute',
              left: '50%',
              top: 14,
              ml: '38px',
              width: 34,
              height: 34,
              borderRadius: '50%',
              bgcolor: 'primary.main',
              color: 'primary.contrastText',
              display: 'grid',
              placeItems: 'center',
              boxShadow: `0 0 0 4px ${theme.palette.background.paper}`,
            }}
          >
            <AutoAwesomeIcon sx={{ fontSize: 18 }} />
          </Box>
          <Box
            sx={{
              position: 'absolute',
              left: '50%',
              top: 182,
              transform: 'translateX(-50%)',
              display: 'flex',
              gap: '2px',
              px: 1.25,
              py: 0.5,
              borderRadius: 999,
              bgcolor: 'background.default',
              border: 1,
              borderColor: alpha(theme.palette.text.primary, 0.1),
            }}
          >
            {[0, 1, 2, 3].map((i) => (
              <StarRoundedIcon key={i} sx={{ fontSize: 16, color: 'warning.light' }} />
            ))}
            <StarOutlineRoundedIcon sx={{ fontSize: 16, color: 'text.disabled' }} />
          </Box>
          </Box>
        </Box>

        <Box id={bodyId} sx={{ px: { xs: 3, sm: 4 }, pt: 3.5, pb: 1, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <Typography sx={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'primary.light' }}>
            {t('onboarding.welcome.eyebrow')}
          </Typography>
          <Typography id={titleId} component="h2" sx={{ fontSize: { xs: 24, sm: 28 }, fontWeight: 700, lineHeight: 1.2, letterSpacing: '-0.015em' }}>
            {t(stepKey(props.tour, props.step.id, 'title'))}
          </Typography>
          <Typography color="text.secondary" sx={{ fontSize: 15, lineHeight: 1.6 }}>
            {t(stepKey(props.tour, props.step.id, 'body'))}
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, pt: 0.75 }}>
            <Box sx={pill}>
              <StarRoundedIcon sx={{ fontSize: 16 }} />
              {t('onboarding.welcome.pills.ratings')}
            </Box>
            <Box sx={pill}>
              <ScheduleRoundedIcon sx={{ fontSize: 16 }} />
              {t('onboarding.welcome.pills.minute')}
            </Box>
            <Box sx={pill}>
              <ChevronRightRoundedIcon sx={{ fontSize: 16, ...forward(rtl) }} />
              {t('onboarding.welcome.pills.skip')}
            </Box>
          </Box>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1.5, px: { xs: 3, sm: 4 }, pt: 3, pb: 3.5 }}>
          <Box role="img" aria-label={t('onboarding.tour.progress', { current: 1, total })} sx={{ display: 'flex', gap: 0.75, alignItems: 'center' }}>
            {Array.from({ length: total }, (_, i) => (
              <Box
                key={i}
                sx={{
                  width: i === 0 ? 22 : 6,
                  height: 6,
                  borderRadius: 1,
                  bgcolor: i === 0 ? 'primary.main' : alpha(theme.palette.text.primary, 0.2),
                }}
              />
            ))}
          </Box>
          <Box sx={{ flex: 1 }} />
          <Button onClick={props.onSkip} color="inherit" sx={{ color: 'text.secondary', minHeight: 44, px: 2 }}>
            {t('onboarding.tour.later')}
          </Button>
          <Button
            variant="contained"
            disableElevation
            onClick={props.onNext}
            endIcon={<ArrowForwardRoundedIcon sx={forward(rtl)} />}
            sx={{ minHeight: 44, borderRadius: 2.5, px: 2.5, fontWeight: 600 }}
          >
            {t('onboarding.tour.start')}
          </Button>
        </Box>
      </Paper>

      {/* How to drive it from the keyboard, for a keyboard and a pointer. */}
      {props.showKeys && (
        <Box aria-hidden="true" sx={{ display: 'flex', alignItems: 'center', gap: 1.25, color: 'text.secondary', fontSize: 13 }}>
          <Key>{rtl ? '→' : '←'}</Key>
          <Key>{rtl ? '←' : '→'}</Key>
          <span>{t('onboarding.tour.keysMove')}</span>
          <Box sx={{ width: 3, height: 3, borderRadius: '50%', bgcolor: 'text.disabled' }} />
          <Key>Esc</Key>
          <span>{t('onboarding.tour.keysClose')}</span>
        </Box>
      )}
    </Box>
  )
})

function Key({ children }: { children: string }) {
  return (
    <Box
      component="kbd"
      sx={{
        px: 1,
        py: '2px',
        borderRadius: 1.5,
        border: 1,
        borderColor: (theme) => alpha(theme.palette.text.primary, 0.2),
        bgcolor: 'background.paper',
        color: 'text.primary',
        fontSize: 12,
        fontFamily: 'inherit',
      }}
    >
      {children}
    </Box>
  )
}
