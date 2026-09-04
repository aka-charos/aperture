import React, { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  Box,
  ButtonBase,
  Typography,
  LinearProgress,
  Popper,
  Paper,
  Fade,
  ClickAwayListener,
  Chip,
  Divider,
  useTheme,
} from '@mui/material'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import ErrorIcon from '@mui/icons-material/Error'
import { useAuth } from '@/hooks/useAuth'
import { useActiveJobs } from '@/hooks/activeJobs'
import {
  JOB_DISPLAY_NAME_KEYS,
  jobConsoleLink,
  titleCaseJobName,
} from '@/pages/jobs/registry'

function formatDuration(startedAt: string): string {
  const start = new Date(startedAt).getTime()
  const now = Date.now()
  const seconds = Math.floor((now - start) / 1000)
  
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return `${hours}h ${remainingMinutes}m`
}

export function RunningJobsWidget() {
  const { t } = useTranslation()
  const theme = useTheme()
  const navigate = useNavigate()
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null)
  const { user } = useAuth()
  // Shared with the admin console's nav column: one interval, two readers.
  const jobs = useActiveJobs(Boolean(user?.isAdmin))

  /**
   * This widget names a job in the progressive tense ("Syncing Movies")
   * because it is watching one run, which the jobs page has no use for. Only
   * some jobs have such a string, though, so the fallback is **the page's own
   * name**, not a second title-caser — that drift is how the same job read
   * "Sync Lldap Emails" here and "Sync LLDAP Emails" on its card.
   */
  const getJobDisplayName = useCallback(
    (jobName: string) => {
      const progressive = t(`runningJobs.jobNames.${jobName}`, { defaultValue: '' })
      if (progressive) return progressive
      const pageKey = JOB_DISPLAY_NAME_KEYS[jobName]
      return pageKey ? t(pageKey) : titleCaseJobName(jobName)
    },
    [t]
  )

  /** Opens the job's card in the console, with its logs expanded. */
  const openJob = useCallback(
    (jobName: string) => {
      setAnchorEl(null)
      navigate(jobConsoleLink(jobName))
    },
    [navigate]
  )

  const jobStatusLabel = useCallback(
    (status: string) => {
      const m: Record<string, string> = {
        completed: 'runningJobs.statusCompleted',
        failed: 'runningJobs.statusFailed',
        cancelled: 'runningJobs.statusCancelled',
        pending: 'runningJobs.statusPending',
        running: 'runningJobs.statusRunning',
      }
      const k = m[status]
      return k ? t(k) : status
    },
    [t]
  )
  const open = Boolean(anchorEl)

  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(anchorEl ? null : event.currentTarget)
  }

  const handleClose = () => {
    setAnchorEl(null)
  }

  if (!user?.isAdmin) return null

  const runningJobs = jobs.filter(j => j.status === 'running')
  const recentJobs = jobs.filter(j => j.status !== 'running').slice(0, 5)
  const hasRunningJobs = runningJobs.length > 0

  // Calculate combined progress (guard against NaN and undefined)
  const combinedProgress = runningJobs.length > 0
    ? (() => {
        const sum = runningJobs.reduce((acc, job) => {
          const progress = typeof job.overallProgress === 'number' && !isNaN(job.overallProgress) 
            ? job.overallProgress 
            : 0
          return acc + progress
        }, 0)
        const avg = Math.round(sum / runningJobs.length)
        return isNaN(avg) ? 0 : avg
      })()
    : 0

  // Get the primary job name to display
  const primaryJobName =
    runningJobs.length === 1
      ? getJobDisplayName(runningJobs[0].jobName)
      : runningJobs.length > 1
        ? t('runningJobs.countRunning', { count: runningJobs.length })
        : t('runningJobs.noActiveJobs')

  if (!hasRunningJobs) return null

  return (
    <>
      {/* Compact progress widget in app bar */}
      <Box
        onClick={handleClick}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          px: 2,
          py: 0.75,
          mr: 1,
          borderRadius: 2,
          backgroundColor: 'rgba(255, 255, 255, 0.1)',
          cursor: 'pointer',
          transition: 'background-color 0.2s',
          '&:hover': {
            backgroundColor: 'rgba(255, 255, 255, 0.15)',
          },
          minWidth: 200,
        }}
      >
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography
            variant="caption"
            sx={{
              color: 'white',
              fontWeight: 500,
              display: 'block',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              fontSize: '0.75rem',
              lineHeight: 1.2,
              mb: 0.5,
            }}
          >
            {primaryJobName}
          </Typography>
          <LinearProgress
            variant="determinate"
            value={combinedProgress}
            sx={{
              height: 4,
              borderRadius: 2,
              backgroundColor: 'rgba(255, 255, 255, 0.2)',
              '& .MuiLinearProgress-bar': {
                borderRadius: 2,
                background: `linear-gradient(90deg, ${theme.palette.primary.main} 0%, ${theme.palette.secondary.main} 50%, ${theme.palette.primary.main} 100%)`,
                backgroundSize: '200% 100%',
                animation: 'shimmer 2s ease-in-out infinite',
                '@keyframes shimmer': {
                  '0%': { backgroundPosition: '200% 0' },
                  '100%': { backgroundPosition: '-200% 0' },
                },
              },
            }}
          />
        </Box>
        <Typography
          variant="caption"
          sx={{
            color: 'white',
            fontWeight: 600,
            fontSize: '0.8rem',
            minWidth: 36,
            textAlign: 'right',
          }}
        >
          {combinedProgress}%
        </Typography>
      </Box>

      {/* Detailed popper on click */}
      <Popper
        open={open}
        anchorEl={anchorEl}
        placement="bottom-end"
        transition
        sx={{ zIndex: 1300 }}
      >
        {({ TransitionProps }) => (
          <Fade {...TransitionProps} timeout={200}>
            <Paper
              elevation={8}
              sx={{
                mt: 1,
                minWidth: 340,
                maxWidth: 400,
                maxHeight: 400,
                overflow: 'auto',
                borderRadius: 2,
              }}
            >
              <ClickAwayListener onClickAway={handleClose}>
                <Box>
                  {/* Header */}
                  <Box
                    sx={{
                      px: 2,
                      py: 1.5,
                      borderBottom: 1,
                      borderColor: 'divider',
                    }}
                  >
                    <Typography variant="subtitle2" fontWeight={600}>
                      {t('runningJobs.headerRunning')}
                    </Typography>
                  </Box>

                  {/* Running Jobs */}
                  <Box sx={{ p: 2 }}>
                    {runningJobs.map((job) => (
                      <ButtonBase
                        key={job.jobId}
                        onClick={() => openJob(job.jobName)}
                        aria-label={t('runningJobs.openJob', {
                          name: getJobDisplayName(job.jobName),
                        })}
                        sx={{
                          width: '100%',
                          display: 'block',
                          textAlign: 'start',
                          borderRadius: 1.5,
                          p: 1,
                          mx: -1,
                          // The row is the affordance, so it needs a hit area
                          // wider than its text and a hover that says so.
                          '&:hover': { backgroundColor: 'action.hover' },
                          mb: 1.5,
                          '&:last-of-type': { mb: 0 },
                        }}
                      >
                        <Box display="flex" justifyContent="space-between" alignItems="center" mb={0.5} gap={1}>
                          <Typography variant="body2" fontWeight={500} noWrap>
                            {getJobDisplayName(job.jobName)}
                          </Typography>
                          <Box display="flex" alignItems="center" gap={0.25} flexShrink={0}>
                            <Typography variant="caption" color="text.secondary">
                              {formatDuration(job.startedAt)}
                            </Typography>
                            <ChevronRightIcon sx={{ fontSize: 16, color: 'text.disabled' }} />
                          </Box>
                        </Box>

                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                          {job.currentStep}
                          {job.itemsTotal > 0 && ` • ${job.itemsProcessed}/${job.itemsTotal}`}
                        </Typography>

                        <Box display="flex" alignItems="center" gap={1}>
                          <LinearProgress
                            variant="determinate"
                            value={job.overallProgress || 0}
                            sx={{
                              flex: 1,
                              height: 6,
                              borderRadius: 3,
                              '& .MuiLinearProgress-bar': {
                                borderRadius: 3,
                                background: `linear-gradient(90deg, ${theme.palette.primary.main} 0%, ${theme.palette.secondary.main} 50%, ${theme.palette.primary.main} 100%)`,
                                backgroundSize: '200% 100%',
                                animation: 'shimmer 2s ease-in-out infinite',
                                '@keyframes shimmer': {
                                  '0%': { backgroundPosition: '200% 0' },
                                  '100%': { backgroundPosition: '-200% 0' },
                                },
                              },
                            }}
                          />
                          <Typography variant="caption" fontWeight={600} sx={{ minWidth: 36, textAlign: 'right' }}>
                            {Math.round(job.overallProgress || 0)}%
                          </Typography>
                        </Box>
                      </ButtonBase>
                    ))}
                  </Box>

                  {/* Recent Jobs */}
                  {recentJobs.length > 0 && (
                    <>
                      <Divider />
                      <Box sx={{ px: 2, py: 1.5 }}>
                        <Typography variant="caption" color="text.secondary" fontWeight={500}>
                          {t('runningJobs.recentSection')}
                        </Typography>
                        {/* A finished job is the one an admin most often wants
                            to open — a failure is why they looked. */}
                        {recentJobs.map((job) => (
                          <ButtonBase
                            key={job.jobId}
                            onClick={() => openJob(job.jobName)}
                            aria-label={t('runningJobs.openJob', {
                              name: getJobDisplayName(job.jobName),
                            })}
                            sx={{
                              width: '100%',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: 1,
                              borderRadius: 1.5,
                              px: 1,
                              mx: -1,
                              py: 0.75,
                              '&:hover': { backgroundColor: 'action.hover' },
                            }}
                          >
                            <Box display="flex" alignItems="center" gap={1} minWidth={0}>
                              {job.status === 'completed' ? (
                                <CheckCircleIcon sx={{ fontSize: 16, color: 'success.main' }} />
                              ) : (
                                <ErrorIcon sx={{ fontSize: 16, color: 'error.main' }} />
                              )}
                              <Typography variant="caption" noWrap>
                                {getJobDisplayName(job.jobName)}
                              </Typography>
                            </Box>
                            <Box display="flex" alignItems="center" gap={0.25} flexShrink={0}>
                              <Chip
                                label={jobStatusLabel(job.status)}
                                size="small"
                                color={job.status === 'completed' ? 'success' : 'error'}
                                sx={{ height: 18, fontSize: '0.65rem' }}
                              />
                              <ChevronRightIcon sx={{ fontSize: 16, color: 'text.disabled' }} />
                            </Box>
                          </ButtonBase>
                        ))}
                      </Box>
                    </>
                  )}
                </Box>
              </ClickAwayListener>
            </Paper>
          </Fade>
        )}
      </Popper>
    </>
  )
}

export default RunningJobsWidget
