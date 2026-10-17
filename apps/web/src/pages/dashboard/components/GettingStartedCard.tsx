import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  Box,
  IconButton,
  LinearProgress,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Paper,
  Tooltip,
  Typography,
} from '@mui/material'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked'
import CloseIcon from '@mui/icons-material/Close'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome'
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import { useOnboarding } from '@/hooks/useOnboarding'

/**
 * Where each item takes you. The server decides which items exist and which
 * are done (`/api/onboarding`); this only knows where in the app each is
 * done. An item with no destination (watching something happens on the media
 * server) is not a link.
 */
const ITEM_PATHS: Record<string, string | undefined> = {
  watch: undefined,
  rate: '/browse',
  interest: '/settings?tab=recommendations',
  why: '/recommendations',
  assistant: '/assistant',
  watching: '/watching',
}

/**
 * The getting-started checklist at the top of Home: what teaches the
 * recommender about you, ticked off from your own record, and whether your
 * first picks exist yet — the answer to "why is my Recommendations page
 * empty?" for a new account. Gone once everything is done, or when closed.
 */
export function GettingStartedCard() {
  const { t } = useTranslation()
  const navigate = useNavigate()
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

  return (
    <Paper variant="outlined" data-tour="home-checklist" sx={{ mb: 4, p: { xs: 2, sm: 2.5 }, borderRadius: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="h6" fontWeight={700}>
            {t('onboarding.checklist.title')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('onboarding.checklist.subtitle')}
          </Typography>
        </Box>
        <Tooltip title={t('onboarding.checklist.dismiss')}>
          <IconButton
            size="small"
            aria-label={t('onboarding.checklist.dismiss')}
            onClick={() => record({ checklistDismissed: true })}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 1.5 }}>
        <LinearProgress
          variant="determinate"
          value={total > 0 ? (done / total) * 100 : 0}
          sx={{ flex: 1, height: 6, borderRadius: 3 }}
          aria-label={t('onboarding.checklist.progress', { done, total })}
        />
        <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
          {t('onboarding.checklist.progress', { done, total })}
        </Typography>
      </Box>

      {/* Two columns from md: six short lines in one column read as a form. */}
      <List
        dense
        disablePadding
        sx={{ mt: 1, display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, columnGap: 2 }}
      >
        {checklist.items.map((item) => {
          const path = ITEM_PATHS[item.id]
          const label = t(`onboarding.checklist.items.${item.id}.title`)
          const detail =
            item.goal != null && !item.done
              ? t('onboarding.checklist.counted', { progress: item.progress ?? 0, goal: item.goal })
              : t(`onboarding.checklist.items.${item.id}.detail`)
          return (
            <ListItemButton
              key={item.id}
              disabled={!path}
              onClick={path ? () => navigate(path) : undefined}
              sx={{ borderRadius: 1, px: 1, '&.Mui-disabled': { opacity: 1 } }}
            >
              <ListItemIcon sx={{ minWidth: 34 }}>
                {item.done ? (
                  <CheckCircleIcon color="success" fontSize="small" />
                ) : (
                  <RadioButtonUncheckedIcon color="disabled" fontSize="small" />
                )}
              </ListItemIcon>
              <ListItemText
                primary={label}
                secondary={detail}
                primaryTypographyProps={{
                  sx: { textDecoration: item.done ? 'line-through' : 'none', color: item.done ? 'text.secondary' : 'text.primary' },
                }}
              />
              {path && !item.done && <ChevronRightIcon fontSize="small" color="action" sx={{ transform: (theme) => (theme.direction === 'rtl' ? 'scaleX(-1)' : 'none') }} />}
            </ListItemButton>
          )
        })}
      </List>

      {checklist.recommendations !== 'off' && (
        <Box
          sx={{
            mt: 1.5,
            pt: 1.5,
            borderTop: 1,
            borderColor: 'divider',
            display: 'flex',
            alignItems: 'center',
            gap: 1,
          }}
        >
          {checklist.recommendations === 'ready' ? (
            <AutoAwesomeIcon color="primary" fontSize="small" />
          ) : (
            <HourglassEmptyIcon color="action" fontSize="small" />
          )}
          <Typography variant="body2" color="text.secondary">
            {t(`onboarding.checklist.recommendations.${checklist.recommendations}`)}
          </Typography>
        </Box>
      )}
    </Paper>
  )
}
