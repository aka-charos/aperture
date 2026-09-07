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
        label: t('welcomeModal.stepLearns'),
        icon: <HistoryIcon />,
        content: (
          <Box>
            <Typography paragraph>{t('welcomeModal.learnsP1')}</Typography>
            <Typography paragraph color="text.secondary">
              {t('welcomeModal.learnsP2')}
            </Typography>
          </Box>
        ),
      },
      {
        label: t('welcomeModal.stepReads'),
        icon: <PsychologyIcon />,
        content: (
          <Box>
            <Typography paragraph>
              <Trans i18nKey="welcomeModal.readsP1" components={{ 0: <strong /> }} />
            </Typography>
            <Box component="ul" sx={{ pl: 2, '& li': { mb: 1 } }}>
              <li>
                <Typography variant="body2">
                  <Trans i18nKey="welcomeModal.readsLi1" components={{ 0: <strong /> }} />
                </Typography>
              </li>
              <li>
                <Typography variant="body2">
                  <Trans i18nKey="welcomeModal.readsLi2" components={{ 0: <strong /> }} />
                </Typography>
              </li>
              <li>
                <Typography variant="body2">
                  <Trans i18nKey="welcomeModal.readsLi3" components={{ 0: <strong /> }} />
                </Typography>
              </li>
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
              {t('welcomeModal.readsP2')}
            </Typography>
          </Box>
        ),
      },
      {
        label: t('welcomeModal.stepScore'),
        icon: <TuneIcon />,
        content: (
          <Box>
            <Typography paragraph>{t('welcomeModal.scoreP1')}</Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              <Paper sx={{ p: 1.5, bgcolor: alpha(theme.palette.primary.main, 0.1) }}>
                <Typography variant="subtitle2" color="primary">
                  {t('welcomeModal.scoreTaste')}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {t('welcomeModal.scoreTasteD')}
                </Typography>
              </Paper>
              <Paper sx={{ p: 1.5, bgcolor: alpha(theme.palette.secondary.main, 0.1) }}>
                <Typography variant="subtitle2" color="secondary">
                  {t('welcomeModal.scoreDiscovery')}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {t('welcomeModal.scoreDiscoveryD')}
                </Typography>
              </Paper>
              <Paper sx={{ p: 1.5, bgcolor: alpha(theme.palette.success.main, 0.1) }}>
                <Typography variant="subtitle2" color="success.main">
                  {t('welcomeModal.scoreQuality')}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {t('welcomeModal.scoreQualityD')}
                </Typography>
              </Paper>
              {/* Deliberately last and visually set apart: diversity is not a
                  term in the blend above it. Listing it as a fourth percentage
                  is the same error the insights panel shipped with before
                  migration 0141 moved Variety to its own heading. */}
              <Paper sx={{ p: 1.5, bgcolor: alpha(theme.palette.warning.main, 0.1) }}>
                <Typography variant="subtitle2" color="warning.main">
                  {t('welcomeModal.scoreVariety')}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {t('welcomeModal.scoreVarietyD')}
                </Typography>
              </Paper>
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
              {t('welcomeModal.scoreP2')}
            </Typography>
          </Box>
        ),
      },
      {
        label: t('welcomeModal.stepSlots'),
        icon: <AutoAwesomeIcon />,
        content: (
          <Box>
            <Typography paragraph>
              <Trans i18nKey="welcomeModal.slotsP1" components={{ 0: <strong /> }} />
            </Typography>
            <Typography paragraph>{t('welcomeModal.slotsP2')}</Typography>
            <Box component="ul" sx={{ pl: 2, '& li': { mb: 0.5 } }}>
              <li>
                <Typography variant="body2">{t('welcomeModal.slotsLi1')}</Typography>
              </li>
              <li>
                <Typography variant="body2">{t('welcomeModal.slotsLi2')}</Typography>
              </li>
              <li>
                <Typography variant="body2">{t('welcomeModal.slotsLi3')}</Typography>
              </li>
              <li>
                <Typography variant="body2">{t('welcomeModal.slotsLi4')}</Typography>
              </li>
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
              {t('welcomeModal.slotsP3')}
            </Typography>
          </Box>
        ),
      },
      {
        label: t('welcomeModal.stepPanel'),
        icon: <MovieFilterIcon />,
        content: (
          <Box>
            <Typography paragraph>{t('welcomeModal.panelP1')}</Typography>
            <Box component="ul" sx={{ pl: 2, '& li': { mb: 1 } }}>
              <li>
                <Typography variant="body2">
                  <Trans i18nKey="welcomeModal.panelLi1" components={{ 0: <strong /> }} />
                </Typography>
              </li>
              <li>
                <Typography variant="body2">
                  <Trans i18nKey="welcomeModal.panelLi2" components={{ 0: <strong /> }} />
                </Typography>
              </li>
              <li>
                <Typography variant="body2">
                  <Trans i18nKey="welcomeModal.panelLi3" components={{ 0: <strong /> }} />
                </Typography>
              </li>
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
              {t('welcomeModal.panelP2')}
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
