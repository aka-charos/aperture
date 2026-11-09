/**
 * "N films and M shows matching X are not on <server>" — the way from a
 * library search to the request panel, with the search already typed in.
 *
 * The host reads the counts with `useMissingTitles` and passes them in, so the
 * search dialog can put the banner in its keyboard order. Two looks: a row under
 * the input in the search dialog, and a callout under the input on the Search
 * page. It eases in and out, because it arrives after the library results and
 * would otherwise shove them in one frame.
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Box, Button, ButtonBase, Collapse, Paper, Typography, alpha, useTheme } from '@mui/material'
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline'
import ArrowForwardIcon from '@mui/icons-material/ArrowForward'
import { useServerDisplayName } from '../hooks/useServerDisplayName'
import { requestSearchPath, type MissingForQuery } from '../lib/missingTitles'

interface MissingTitlesBannerProps {
  /** From `useMissingTitles`; null hides the banner. */
  found: MissingForQuery | null
  variant: 'dialog' | 'page'
  /** Highlighted as the keyboard selection (dialog only). */
  selected?: boolean
  /** Runs before navigating, e.g. to close the dialog the banner sits in. */
  onNavigate?: () => void
}

function useSummaryText(found: MissingForQuery): string {
  const { t } = useTranslation()
  const serverName = useServerDisplayName()
  const parts = [
    found.movies > 0 ? t('missingTitles.movies', { count: found.movies }) : null,
    found.series > 0 ? t('missingTitles.series', { count: found.series }) : null,
  ].filter((p): p is string => p !== null)
  const titles = parts.length === 2 ? t('missingTitles.both', { movies: parts[0], series: parts[1] }) : parts[0]
  // `count` picks "is" or "are" in every sentence, the "at least" ones included.
  const values = { titles, query: found.query, serverName, count: found.movies + found.series }
  if (found.more) {
    return serverName ? t('missingTitles.summaryMoreNamed', values) : t('missingTitles.summaryMore', values)
  }
  return serverName ? t('missingTitles.summaryNamed', values) : t('missingTitles.summary', values)
}

export function MissingTitlesBanner({ found, variant, selected = false, onNavigate }: MissingTitlesBannerProps) {
  // The last answer stays drawn while the banner collapses away.
  const [shown, setShown] = useState(found)
  if (found && found !== shown) setShown(found)

  return (
    <Collapse in={found !== null} appear unmountOnExit sx={{ flexShrink: 0 }}>
      {shown && <BannerBody found={shown} variant={variant} selected={selected} onNavigate={onNavigate} />}
    </Collapse>
  )
}

function BannerBody({
  found,
  variant,
  selected,
  onNavigate,
}: Omit<MissingTitlesBannerProps, 'found'> & { found: MissingForQuery }) {
  const { t } = useTranslation()
  const theme = useTheme()
  const navigate = useNavigate()
  const text = useSummaryText(found)

  const go = () => {
    onNavigate?.()
    navigate(requestSearchPath(found.query))
  }

  if (variant === 'dialog') {
    return (
      <ButtonBase
        onClick={go}
        sx={{
          width: '100%',
          justifyContent: 'flex-start',
          alignItems: 'flex-start',
          gap: 1,
          px: 2.5,
          py: 1.25,
          borderTop: 1,
          borderColor: 'divider',
          textAlign: 'start',
          bgcolor: selected ? alpha(theme.palette.primary.main, 0.1) : 'transparent',
          '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.08) },
        }}
      >
        <AddCircleOutlineIcon fontSize="small" color="primary" sx={{ mt: 0.25 }} />
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body2" color="text.primary">
            {text}
          </Typography>
          <Typography variant="body2" color="primary.main" fontWeight={500}>
            {t('missingTitles.action')}
          </Typography>
        </Box>
      </ButtonBase>
    )
  }

  return (
    <Paper
      variant="outlined"
      sx={{
        mb: 3,
        px: 2,
        py: 1.5,
        borderRadius: 2,
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        flexWrap: 'wrap',
      }}
    >
      <AddCircleOutlineIcon color="primary" />
      <Typography variant="body2" sx={{ flex: '1 1 240px', minWidth: 0 }}>
        {text}
      </Typography>
      <Button
        variant="outlined"
        color="primary"
        size="small"
        endIcon={<ArrowForwardIcon sx={{ transform: theme.direction === 'rtl' ? 'scaleX(-1)' : undefined }} />}
        onClick={go}
      >
        {t('missingTitles.action')}
      </Button>
    </Paper>
  )
}
