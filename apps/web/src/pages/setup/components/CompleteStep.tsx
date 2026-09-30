import {
  Box,
  Button,
  Typography,
  Card,
  CardContent,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
} from '@mui/material'
import {
  CheckCircle as CheckCircleIcon,
  Movie as MovieIcon,
  Schedule as ScheduleIcon,
  AutoAwesome as AutoAwesomeIcon,
  Person as PersonIcon,
  Login as LoginIcon,
  LiveTv as LiveTvIcon,
  Extension as ExtensionIcon,
  Home as HomeIcon,
} from '@mui/icons-material'
import { useTranslation } from 'react-i18next'
import type { SetupWizardContext } from '../types'

interface CompleteStepProps {
  wizard: SetupWizardContext
}

export function CompleteStep({ wizard }: CompleteStepProps) {
  const { t } = useTranslation()
  const { handleCompleteSetup, serverType, goToStep } = wizard
  // Home rows are an Emby feature; a Jellyfin install is not sent looking for them.
  const isEmby = serverType === 'emby'

  return (
    <Box>
      {/* Success Header */}
      <Box textAlign="center" sx={{ mb: 4 }}>
        <CheckCircleIcon sx={{ fontSize: 64, color: 'success.main', mb: 2 }} />
        <Typography variant="h5" gutterBottom>
          {t('setup.complete.title')}
        </Typography>
        <Typography variant="body1" color="text.secondary">
          {t('setup.complete.subtitleReady')}
        </Typography>
      </Box>

      {/* Getting Started */}
      <Card variant="outlined" sx={{ mb: 3, backgroundColor: 'action.hover' }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            {t('setup.complete.gettingStarted')}
          </Typography>

          <List dense>
            <ListItem>
              <ListItemIcon>
                <LoginIcon fontSize="small" color="primary" />
              </ListItemIcon>
              <ListItemText
                primary={t('setup.complete.loginPrimary')}
                secondary={t('setup.complete.loginSecondary')}
              />
            </ListItem>

            <ListItem>
              <ListItemIcon>
                <AutoAwesomeIcon fontSize="small" color="primary" />
              </ListItemIcon>
              <ListItemText
                primary={t('setup.complete.appPrimary')}
                secondary={t('setup.complete.appSecondary')}
              />
            </ListItem>

            {isEmby && (
              <ListItem>
                <ListItemIcon>
                  <HomeIcon fontSize="small" color="primary" />
                </ListItemIcon>
                <ListItemText
                  primary={t('setup.complete.homeRowsPrimary')}
                  secondary={t('setup.complete.homeRowsSecondary')}
                />
              </ListItem>
            )}
          </List>
        </CardContent>
      </Card>

      {/* Default Schedules */}
      <Card variant="outlined" sx={{ mb: 3 }}>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
            <ScheduleIcon color="primary" />
            <Typography variant="h6">{t('setup.complete.schedulesTitle')}</Typography>
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t('setup.complete.schedulesIntro')}
          </Typography>

          <List dense disablePadding>
            <ListItem sx={{ py: 0.25 }}>
              <ListItemText
                primary={t('setup.complete.schedWatchHistory')}
                secondary={t('setup.complete.schedWatchHistoryDesc')}
                primaryTypographyProps={{ variant: 'body2', fontWeight: 500 }}
                secondaryTypographyProps={{ variant: 'caption' }}
              />
            </ListItem>
            <ListItem sx={{ py: 0.25 }}>
              <ListItemText
                primary={t('setup.complete.schedLibraryScan')}
                secondary={t('setup.complete.schedLibraryScanDesc')}
                primaryTypographyProps={{ variant: 'body2', fontWeight: 500 }}
                secondaryTypographyProps={{ variant: 'caption' }}
              />
            </ListItem>
            <ListItem sx={{ py: 0.25 }}>
              <ListItemText
                primary={t('setup.complete.schedEmbeddings')}
                secondary={t('setup.complete.schedEmbeddingsDesc')}
                primaryTypographyProps={{ variant: 'body2', fontWeight: 500 }}
                secondaryTypographyProps={{ variant: 'caption' }}
              />
            </ListItem>
            <ListItem sx={{ py: 0.25 }}>
              <ListItemText
                primary={t('setup.complete.schedAiRecs')}
                secondary={t('setup.complete.schedAiRecsDesc')}
                primaryTypographyProps={{ variant: 'body2', fontWeight: 500 }}
                secondaryTypographyProps={{ variant: 'caption' }}
              />
            </ListItem>
            {isEmby && (
              <ListItem sx={{ py: 0.25 }}>
                <ListItemText
                  primary={t('setup.complete.schedHomeRows')}
                  secondary={t('setup.complete.schedHomeRowsDesc')}
                  primaryTypographyProps={{ variant: 'body2', fontWeight: 500 }}
                  secondaryTypographyProps={{ variant: 'caption' }}
                />
              </ListItem>
            )}
          </List>
        </CardContent>
      </Card>

      {/* Additional Features */}
      <Card variant="outlined" sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            {t('setup.complete.unlockTitle')}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t('setup.complete.unlockIntro')}
          </Typography>

          <List dense>
            <ListItem>
              <ListItemIcon>
                <ExtensionIcon fontSize="small" color="secondary" />
              </ListItemIcon>
              <ListItemText
                primary={t('setup.complete.featTrakt')}
                secondary={t('setup.complete.featTraktDesc')}
              />
            </ListItem>

            <ListItem>
              <ListItemIcon>
                <MovieIcon fontSize="small" color="secondary" />
              </ListItemIcon>
              <ListItemText
                primary={t('setup.complete.featMetadata')}
                secondary={t('setup.complete.featMetadataDesc')}
              />
            </ListItem>

            <ListItem>
              <ListItemIcon>
                <LiveTvIcon fontSize="small" color="secondary" />
              </ListItemIcon>
              <ListItemText
                primary={t('setup.complete.featWatching')}
                secondary={t('setup.complete.featWatchingDesc')}
              />
            </ListItem>

            <ListItem>
              <ListItemIcon>
                <PersonIcon fontSize="small" color="secondary" />
              </ListItemIcon>
              <ListItemText
                primary={t('setup.complete.featUserPrefs')}
                secondary={t('setup.complete.featUserPrefsDesc')}
              />
            </ListItem>
          </List>
        </CardContent>
      </Card>

      {/* Action Buttons */}
      <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center', flexWrap: 'wrap' }}>
        <Button variant="outlined" onClick={() => goToStep('initialJobs')}>
          {t('setup.complete.backToJobs')}
        </Button>
        <Button
          variant="contained"
          size="large"
          onClick={handleCompleteSetup}
          startIcon={<CheckCircleIcon />}
        >
          {t('setup.complete.finishSetup')}
        </Button>
      </Box>

      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textAlign: 'center', mt: 2 }}>
        {t('setup.complete.finishHint')}
      </Typography>
    </Box>
  )
}
