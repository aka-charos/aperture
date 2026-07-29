import { useEffect, useMemo, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Box,
  FormControlLabel,
  Checkbox,
  Menu,
  MenuItem,
  Stepper,
  Step,
  StepLabel,
  StepContent,
  Paper,
  useTheme,
  alpha,
} from '@mui/material'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome'
import MovieFilterIcon from '@mui/icons-material/MovieFilter'
import PsychologyIcon from '@mui/icons-material/Psychology'
import RecommendIcon from '@mui/icons-material/Recommend'
import HistoryIcon from '@mui/icons-material/History'
import TuneIcon from '@mui/icons-material/Tune'
import ScheduleIcon from '@mui/icons-material/Schedule'
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown'
import type { WelcomeDismissal } from './useWelcomeModal'

interface WelcomeModalProps {
  open: boolean
  /**
   * Always called with an explicit choice — never wired straight to MUI's
   * `onClose`, which would hand it an event instead.
   */
  onClose: (choice: WelcomeDismissal) => void
}

export function WelcomeModal({ open, onClose }: WelcomeModalProps) {
  const { t } = useTranslation()
  const theme = useTheme()
  const [dontShowAgain, setDontShowAgain] = useState(false)
  const [activeStep, setActiveStep] = useState(0)
  const [snoozeAnchor, setSnoozeAnchor] = useState<null | HTMLElement>(null)

  // The dialog stays mounted between openings, so reopening it from the user
  // menu would otherwise resume on whichever step was last read.
  useEffect(() => {
    if (open) {
      setActiveStep(0)
      setDontShowAgain(false)
    }
  }, [open])

  const close = (choice: WelcomeDismissal) => {
    setSnoozeAnchor(null)
    onClose(choice)
  }

  const handleNext = () => {
    setActiveStep((prev) => prev + 1)
  }

  const handleBack = () => {
    setActiveStep((prev) => prev - 1)
  }

  const steps = useMemo(
    () => [
      {
        label: t('welcomeModal.stepWelcome'),
        icon: <AutoAwesomeIcon />,
        content: (
          <Box>
            <Typography paragraph>
              <Trans i18nKey="welcomeModal.stepWelcomeP1" components={{ 0: <strong /> }} />
            </Typography>
            <Typography paragraph color="text.secondary">
              {t('welcomeModal.stepWelcomeP2')}
            </Typography>
          </Box>
        ),
      },
      {
        label: t('welcomeModal.stepHowAi'),
        icon: <PsychologyIcon />,
        content: (
          <Box>
            <Typography paragraph>
              <Trans i18nKey="welcomeModal.stepHowAiP1" components={{ 0: <strong /> }} />
            </Typography>
            <Box component="ul" sx={{ pl: 2, '& li': { mb: 1 } }}>
              <li>
                <Typography variant="body2">
                  <Trans i18nKey="welcomeModal.stepHowAiLi1" components={{ 0: <strong /> }} />
                </Typography>
              </li>
              <li>
                <Typography variant="body2">
                  <Trans i18nKey="welcomeModal.stepHowAiLi2" components={{ 0: <strong /> }} />
                </Typography>
              </li>
              <li>
                <Typography variant="body2">
                  <Trans i18nKey="welcomeModal.stepHowAiLi3" components={{ 0: <strong /> }} />
                </Typography>
              </li>
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
              {t('welcomeModal.stepHowAiP2')}
            </Typography>
          </Box>
        ),
      },
      {
        label: t('welcomeModal.stepScoring'),
        icon: <TuneIcon />,
        content: (
          <Box>
            <Typography paragraph>{t('welcomeModal.stepScoringP1')}</Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              <Paper sx={{ p: 1.5, bgcolor: alpha(theme.palette.primary.main, 0.1) }}>
                <Typography variant="subtitle2" color="primary">
                  {t('welcomeModal.stepScoringTaste')}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {t('welcomeModal.stepScoringTasteD')}
                </Typography>
              </Paper>
              <Paper sx={{ p: 1.5, bgcolor: alpha(theme.palette.secondary.main, 0.1) }}>
                <Typography variant="subtitle2" color="secondary">
                  {t('welcomeModal.stepScoringGenre')}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {t('welcomeModal.stepScoringGenreD')}
                </Typography>
              </Paper>
              <Paper sx={{ p: 1.5, bgcolor: alpha(theme.palette.success.main, 0.1) }}>
                <Typography variant="subtitle2" color="success.main">
                  {t('welcomeModal.stepScoringCommunity')}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {t('welcomeModal.stepScoringCommunityD')}
                </Typography>
              </Paper>
              <Paper sx={{ p: 1.5, bgcolor: alpha(theme.palette.warning.main, 0.1) }}>
                <Typography variant="subtitle2" color="warning.main">
                  {t('welcomeModal.stepScoringDiversity')}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {t('welcomeModal.stepScoringDiversityD')}
                </Typography>
              </Paper>
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
              {t('welcomeModal.stepScoringP2')}
            </Typography>
          </Box>
        ),
      },
      {
        label: t('welcomeModal.stepSimilar'),
        icon: <MovieFilterIcon />,
        content: (
          <Box>
            <Typography paragraph>
              <Trans i18nKey="welcomeModal.stepSimilarP1" components={{ 0: <strong /> }} />
            </Typography>
            <Typography paragraph>{t('welcomeModal.stepSimilarP2')}</Typography>
            <Box component="ul" sx={{ pl: 2, '& li': { mb: 0.5 } }}>
              <li>
                <Typography variant="body2">{t('welcomeModal.stepSimilarLi1')}</Typography>
              </li>
              <li>
                <Typography variant="body2">{t('welcomeModal.stepSimilarLi2')}</Typography>
              </li>
              <li>
                <Typography variant="body2">{t('welcomeModal.stepSimilarLi3')}</Typography>
              </li>
              <li>
                <Typography variant="body2">{t('welcomeModal.stepSimilarLi4')}</Typography>
              </li>
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
              {t('welcomeModal.stepSimilarP3')}
            </Typography>
          </Box>
        ),
      },
      {
        label: t('welcomeModal.stepData'),
        icon: <HistoryIcon />,
        content: (
          <Box>
            <Typography paragraph>{t('welcomeModal.stepDataP1')}</Typography>
            <Box component="ul" sx={{ pl: 2, '& li': { mb: 1 } }}>
              <li>
                <Typography variant="body2">
                  <Trans i18nKey="welcomeModal.stepDataLi1" components={{ 0: <strong /> }} />
                </Typography>
              </li>
              <li>
                <Typography variant="body2">
                  <Trans i18nKey="welcomeModal.stepDataLi2" components={{ 0: <strong /> }} />
                </Typography>
              </li>
              <li>
                <Typography variant="body2">
                  <Trans i18nKey="welcomeModal.stepDataLi3" components={{ 0: <strong /> }} />
                </Typography>
              </li>
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
              {t('welcomeModal.stepDataP2')}
            </Typography>
          </Box>
        ),
      },
    ],
    [t, theme]
  )

  return (
    <Dialog
      open={open}
      onClose={() => close(dontShowAgain ? 'never' : 'session')}
      maxWidth="md"
      fullWidth
      PaperProps={{
        sx: {
          borderRadius: 3,
          maxHeight: '85vh',
        },
      }}
    >
      <DialogTitle sx={{ pb: 1 }}>
        <Box display="flex" alignItems="center" gap={1.5}>
          <AutoAwesomeIcon color="primary" sx={{ fontSize: 32 }} />
          <Box>
            <Typography variant="h5" fontWeight={700}>
              {t('welcomeModal.title')}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t('welcomeModal.subtitle')}
            </Typography>
          </Box>
        </Box>
      </DialogTitle>

      <DialogContent>
        <Stepper activeStep={activeStep} orientation="vertical">
          {steps.map((step, index) => (
            <Step key={step.label}>
              <StepLabel
                StepIconProps={{
                  icon: step.icon,
                }}
                sx={{ cursor: 'pointer' }}
                onClick={() => setActiveStep(index)}
              >
                <Typography fontWeight={activeStep === index ? 600 : 400}>{step.label}</Typography>
              </StepLabel>
              <StepContent>
                <Box sx={{ py: 1 }}>{step.content}</Box>
                <Box sx={{ mt: 2, display: 'flex', gap: 1 }}>
                  {index > 0 && (
                    <Button onClick={handleBack} size="small">
                      {t('common.back')}
                    </Button>
                  )}
                  {index < steps.length - 1 && (
                    <Button variant="contained" onClick={handleNext} size="small">
                      {t('common.continue')}
                    </Button>
                  )}
                </Box>
              </StepContent>
            </Step>
          ))}
        </Stepper>
      </DialogContent>

      <DialogActions
        sx={{ px: 3, pb: 2, gap: 1, justifyContent: 'space-between', flexWrap: 'wrap' }}
      >
        <FormControlLabel
          control={
            <Checkbox
              checked={dontShowAgain}
              onChange={(e) => setDontShowAgain(e.target.checked)}
              size="small"
            />
          }
          label={<Typography variant="body2">{t('common.dontShowAgain')}</Typography>}
        />
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {/* Picking a term here is the more specific instruction, so it wins
              over the checkbox rather than arguing with it. */}
          <Button
            color="inherit"
            onClick={(e) => setSnoozeAnchor(e.currentTarget)}
            startIcon={<ScheduleIcon />}
            endIcon={<ArrowDropDownIcon />}
          >
            {t('welcomeModal.remindMeLater')}
          </Button>
          <Menu
            anchorEl={snoozeAnchor}
            open={Boolean(snoozeAnchor)}
            onClose={() => setSnoozeAnchor(null)}
            anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
            transformOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          >
            <MenuItem onClick={() => close('session')}>
              {t('welcomeModal.snoozeNextSignIn')}
            </MenuItem>
            <MenuItem onClick={() => close('day')}>{t('welcomeModal.snoozeTomorrow')}</MenuItem>
            <MenuItem onClick={() => close('week')}>{t('welcomeModal.snoozeNextWeek')}</MenuItem>
          </Menu>
          <Button
            onClick={() => close(dontShowAgain ? 'never' : 'session')}
            variant="contained"
            startIcon={<RecommendIcon />}
          >
            {t('common.getStarted')}
          </Button>
        </Box>
      </DialogActions>
    </Dialog>
  )
}
