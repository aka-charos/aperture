import React, { useState, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  FormControl,
  FormControlLabel,
  FormLabel,
  RadioGroup,
  Radio,
  Select,
  MenuItem,
  Switch,
  Stack,
  TextField,
  Alert,
  CircularProgress,
  ToggleButton,
  ToggleButtonGroup,
} from '@mui/material'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import type { ScheduleType, JobSchedule, JobRunLimit } from '../types'
import { formatJobName } from '../constants'
import type { UpdateJobConfigParams } from '../hooks/useJobsData'
import {
  formatTimeOfDay,
  parseMinute,
  scheduleTakesMinute,
  scheduleTimingPayload,
} from '../scheduleForm'
import { describeSchedule, INTERVAL_META, scheduleTextValues, WEEKDAY_KEYS } from '../scheduleText'

type JobConfigSaveParams = UpdateJobConfigParams & {
  scheduleType: ScheduleType
  isEnabled: boolean
}

interface JobConfigDialogProps {
  open: boolean
  onClose: () => void
  jobName: string
  currentSchedule: JobSchedule | null | undefined
  manualOnly?: boolean
  /** Present when the job's per-run item cap is configurable. */
  runLimit?: JobRunLimit | null
  onSave: (schedule: JobConfigSaveParams) => Promise<void>
}

/**
 * Short forms for the day toggles. Seven full names do not fit across a dialog
 * at `maxWidth="sm"`, and the group has to stay one row or it stops reading as
 * a week.
 */
const WEEKDAY_SHORT_KEYS = [
  'weekdayShortSun',
  'weekdayShortMon',
  'weekdayShortTue',
  'weekdayShortWed',
  'weekdayShortThu',
  'weekdayShortFri',
  'weekdayShortSat',
] as const

export function JobConfigDialog({
  open,
  onClose,
  jobName,
  currentSchedule,
  manualOnly = false,
  runLimit = null,
  onSave,
}: JobConfigDialogProps) {
  const { t, i18n } = useTranslation()
  const [scheduleType, setScheduleType] = useState<ScheduleType>('daily')
  const [hour, setHour] = useState<number>(3)
  // Text, so a half-typed or cleared field is not silently read as :00.
  const [minuteText, setMinuteText] = useState<string>('0')
  // Weekly holds a set; biweekly holds exactly one. They are separate pieces of
  // state so that switching frequency back and forth does not quietly discard
  // the other's selection.
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>([0])
  const [dayOfWeek, setDayOfWeek] = useState<number>(0)
  const [intervalMinutesTotal, setIntervalMinutesTotal] = useState<number>(360)
  const [isEnabled, setIsEnabled] = useState<boolean>(true)
  // Text, not a number: blank is a real answer ("use the job's default") and a
  // number input cannot hold it.
  const [runLimitText, setRunLimitText] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [initialized, setInitialized] = useState(false)

  // The same formatter as the preview, so the picker and the summary under it
  // show the time one way.
  const hours = useMemo(
    () =>
      Array.from({ length: 24 }, (_, i) => ({
        value: i,
        label: formatTimeOfDay(i18n.language, i, 0),
      })),
    [i18n.language]
  )

  const weekdays = useMemo(
    () =>
      WEEKDAY_KEYS.map((key, value) => ({
        value,
        label: t(`admin.jobsPage.ui.${key}`),
        short: t(`admin.jobsPage.ui.${WEEKDAY_SHORT_KEYS[value]}`),
      })),
    [t]
  )

  const intervalOptions = useMemo(
    () =>
      INTERVAL_META.map(({ value, labelKey }) => ({
        value,
        label: t(`admin.jobsPage.ui.${labelKey}`),
      })),
    [t]
  )

  useEffect(() => {
    if (open && !initialized && currentSchedule) {
      // Read the way the scheduler reads it, so the form opens on what runs.
      const stored = scheduleTextValues(currentSchedule)
      setScheduleType(stored.type)
      setHour(stored.hour)
      setMinuteText(String(stored.minute))
      setDayOfWeek(stored.dayOfWeek)
      setDaysOfWeek(stored.daysOfWeek)
      setIntervalMinutesTotal(stored.intervalMinutes)
      setIsEnabled(stored.isEnabled)
      setRunLimitText(
        currentSchedule.maxItemsPerRun != null ? String(currentSchedule.maxItemsPerRun) : ''
      )
      setInitialized(true)
    }
    if (!open) {
      setInitialized(false)
      setError(null)
    }
  }, [open, initialized, currentSchedule])

  // Biweekly is weekly plus a skipped firing, so it takes the same inputs --
  // except for the day *set*. The every-other-week rule drops any firing under
  // 13 days after the last completed run, so a second day in the same week
  // would never fire: picking Mon+Thu would silently mean "every other Monday".
  // Biweekly therefore keeps the single-day picker (the API truncates anyway).
  const showsDayOfWeek = scheduleType === 'weekly' || scheduleType === 'biweekly'
  const showsDaySet = scheduleType === 'weekly'
  const showsTimeOfDay = showsDayOfWeek || scheduleType === 'daily'
  // The 15- and 30-minute intervals run on the quarter and half hour
  // whatever the minute says, so they get no minute field.
  const showsMinute = isEnabled && scheduleTakesMinute(scheduleType, intervalMinutesTotal)

  // Shown, edited and sent back as it is (scheduleForm.ts says why).
  const parsedMinute = useMemo(() => parseMinute(minuteText), [minuteText])
  const minuteInvalid = showsMinute && parsedMinute === undefined
  const minute = parsedMinute ?? currentSchedule?.minute ?? 0

  // The cap as it will be saved: null for blank, a number when valid, and
  // undefined when the text is not an acceptable value (Save is then disabled).
  // Refused rather than clamped, matching the API: a clamped number is a
  // setting nobody typed.
  const parsedRunLimit = useMemo((): number | null | undefined => {
    if (!runLimit) return null
    const text = runLimitText.trim()
    if (text === '') return null
    if (!/^\d+$/.test(text)) return undefined
    const value = Number(text)
    return value >= runLimit.min && value <= runLimit.max ? value : undefined
  }, [runLimit, runLimitText])
  const runLimitInvalid = runLimit != null && parsedRunLimit === undefined

  const handleSave = async () => {
    setSaving(true)
    setError(null)

    try {
      const payload: JobConfigSaveParams = { scheduleType, isEnabled }
      if (runLimit && parsedRunLimit !== undefined) {
        payload.maxItemsPerRun = parsedRunLimit
      }

      Object.assign(
        payload,
        scheduleTimingPayload({
          type: scheduleType,
          hour,
          minute,
          intervalMinutes: intervalMinutesTotal,
        })
      )

      if (showsDaySet) {
        // The scalar rides along at the earliest day so an older API build (or
        // a rollback) still reads a sane schedule rather than defaulting to
        // Sunday. The server derives the same value; sending it is belt and
        // braces, not a second source of truth.
        const sorted = [...daysOfWeek].sort((a, b) => a - b)
        payload.scheduleDaysOfWeek = sorted
        payload.scheduleDayOfWeek = sorted[0] ?? 0
      } else if (showsDayOfWeek) {
        payload.scheduleDaysOfWeek = [dayOfWeek]
        payload.scheduleDayOfWeek = dayOfWeek
      } else {
        payload.scheduleDaysOfWeek = null
        payload.scheduleDayOfWeek = null
      }

      await onSave(payload)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('admin.jobsPage.ui.configFailedSave'))
    } finally {
      setSaving(false)
    }
  }

  const getPreviewText = (): string => {
    if (manualOnly) return t('admin.jobsPage.ui.configPreviewManualOnly')
    return describeSchedule(
      {
        type: scheduleType,
        isEnabled,
        hour,
        minute,
        daysOfWeek,
        dayOfWeek,
        intervalMinutes: intervalMinutesTotal,
      },
      t,
      i18n.language
    )
  }

  const minuteField = showsMinute && (
    <FormControl fullWidth>
      <FormLabel sx={{ mb: 1, fontWeight: 500 }}>{t('admin.jobsPage.ui.configMinute')}</FormLabel>
      <TextField
        value={minuteText}
        onChange={(e) => setMinuteText(e.target.value)}
        size="small"
        error={minuteInvalid}
        helperText={
          minuteInvalid
            ? t('admin.jobsPage.ui.configMinuteInvalid')
            : t('admin.jobsPage.ui.configMinuteHint')
        }
        slotProps={{
          htmlInput: { inputMode: 'numeric', 'aria-label': t('admin.jobsPage.ui.configMinute') },
        }}
      />
      {currentSchedule?.timeZone && (
        <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
          {t('admin.jobsPage.ui.configTimeZone', { timeZone: currentSchedule.timeZone })}
        </Typography>
      )}
    </FormControl>
  )

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ pb: 1 }}>
        {t('admin.jobsPage.ui.configTitle', { name: formatJobName(jobName, t) })}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={3} sx={{ mt: 1 }}>
          {manualOnly && (
            <Alert
              severity="warning"
              icon={<WarningAmberIcon />}
              sx={{
                '& .MuiAlert-message': { width: '100%' },
              }}
            >
              <Typography variant="subtitle2" fontWeight={600} gutterBottom>
                {t('admin.jobsPage.ui.configManualOnlyTitle')}
              </Typography>
              <Typography variant="body2">{t('admin.jobsPage.ui.configManualOnlyBody')}</Typography>
            </Alert>
          )}

          <FormControlLabel
            disabled={manualOnly}
            control={
              <Switch
                checked={manualOnly ? false : isEnabled}
                onChange={(e) => setIsEnabled(e.target.checked)}
                color="primary"
              />
            }
            label={
              <Typography variant="body1" fontWeight={500} color={manualOnly ? 'text.disabled' : 'text.primary'}>
                {t('admin.jobsPage.ui.configEnableScheduling')}
              </Typography>
            }
          />

          <FormControl disabled={!isEnabled || manualOnly}>
            <FormLabel sx={{ mb: 1, fontWeight: 500 }}>{t('admin.jobsPage.ui.configRunFrequency')}</FormLabel>
            <RadioGroup
              value={manualOnly ? 'manual' : scheduleType}
              onChange={(e) => setScheduleType(e.target.value as ScheduleType)}
            >
              <FormControlLabel
                value="daily"
                control={<Radio />}
                label={t('admin.jobsPage.ui.configDaily')}
                disabled={manualOnly}
              />
              <FormControlLabel
                value="weekly"
                control={<Radio />}
                label={t('admin.jobsPage.ui.configWeekly')}
                disabled={manualOnly}
              />
              <FormControlLabel
                value="biweekly"
                control={<Radio />}
                label={t('admin.jobsPage.ui.configBiweekly')}
                disabled={manualOnly}
              />
              <FormControlLabel
                value="interval"
                control={<Radio />}
                label={t('admin.jobsPage.ui.configInterval')}
                disabled={manualOnly}
              />
              <FormControlLabel value="manual" control={<Radio />} label={t('admin.jobsPage.ui.configManualOnlyOption')} />
            </RadioGroup>
          </FormControl>

          {isEnabled && showsTimeOfDay && (
            <FormControl fullWidth>
              <FormLabel sx={{ mb: 1, fontWeight: 500 }}>{t('admin.jobsPage.ui.configTime')}</FormLabel>
              <Select value={hour} onChange={(e) => setHour(e.target.value as number)} size="small">
                {hours.map((h) => (
                  <MenuItem key={h.value} value={h.value}>
                    {h.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          )}

          {showsTimeOfDay && minuteField}

          {isEnabled && showsDaySet && (
            <FormControl fullWidth>
              <FormLabel sx={{ mb: 1, fontWeight: 500 }}>
                {t('admin.jobsPage.ui.configDaysOfWeek')}
              </FormLabel>
              <ToggleButtonGroup
                value={daysOfWeek}
                onChange={(_e, next: number[]) => {
                  // MUI hands back the empty array when the last selected day
                  // is clicked off. Refusing it keeps the control from reaching
                  // a state Save would have to reject -- a weekly schedule with
                  // no days is not a schedule.
                  if (next.length > 0) setDaysOfWeek(next)
                }}
                size="small"
                sx={{ flexWrap: 'wrap', gap: 0.5, '& .MuiToggleButton-root': { flex: '1 1 auto' } }}
              >
                {weekdays.map((d) => (
                  <ToggleButton
                    key={d.value}
                    value={d.value}
                    aria-label={d.label}
                    sx={{ borderRadius: 1, px: 1.5 }}
                  >
                    {d.short}
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>
              <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
                {t('admin.jobsPage.ui.configDaysOfWeekHint')}
              </Typography>
            </FormControl>
          )}

          {isEnabled && showsDayOfWeek && !showsDaySet && (
            <FormControl fullWidth>
              <FormLabel sx={{ mb: 1, fontWeight: 500 }}>{t('admin.jobsPage.ui.configDayOfWeek')}</FormLabel>
              <Select value={dayOfWeek} onChange={(e) => setDayOfWeek(e.target.value as number)} size="small">
                {weekdays.map((d) => (
                  <MenuItem key={d.value} value={d.value}>
                    {d.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          )}

          {isEnabled && scheduleType === 'biweekly' && (
            <Alert severity="info" sx={{ py: 0.5 }}>
              {t('admin.jobsPage.ui.configBiweeklyNote')}
            </Alert>
          )}

          {isEnabled && scheduleType === 'interval' && (
            <FormControl fullWidth>
              <FormLabel sx={{ mb: 1, fontWeight: 500 }}>{t('admin.jobsPage.ui.configInterval')}</FormLabel>
              <Select
                value={intervalMinutesTotal}
                onChange={(e) => setIntervalMinutesTotal(e.target.value as number)}
                size="small"
              >
                {intervalOptions.map((i) => (
                  <MenuItem key={i.value} value={i.value}>
                    {i.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          )}

          {scheduleType === 'interval' && minuteField}

          {runLimit && (
            <FormControl fullWidth>
              <FormLabel sx={{ mb: 1, fontWeight: 500 }}>
                {t('admin.jobsPage.ui.configRunLimit', { context: runLimit.unit })}
              </FormLabel>
              <TextField
                value={runLimitText}
                onChange={(e) => setRunLimitText(e.target.value)}
                size="small"
                placeholder={String(runLimit.default)}
                error={runLimitInvalid}
                helperText={
                  runLimitInvalid
                    ? t('admin.jobsPage.ui.configRunLimitInvalid', {
                        min: runLimit.min,
                        max: runLimit.max,
                      })
                    : t('admin.jobsPage.ui.configRunLimitHint', {
                        context: runLimit.unit,
                        default: runLimit.default,
                      })
                }
                slotProps={{
                  htmlInput: {
                    inputMode: 'numeric',
                    'aria-label': t('admin.jobsPage.ui.configRunLimit', { context: runLimit.unit }),
                  },
                }}
              />
            </FormControl>
          )}

          <Box
            sx={{
              p: 2,
              borderRadius: 2,
              bgcolor: 'action.hover',
            }}
          >
            <Typography variant="caption" color="text.secondary" display="block" mb={0.5}>
              {t('admin.jobsPage.ui.schedulePreview')}
            </Typography>
            <Typography variant="body1" fontWeight={500}>
              {getPreviewText()}
            </Typography>
            {runLimit && parsedRunLimit !== undefined && (
              <Typography variant="body2" color="text.secondary" mt={0.5}>
                {t('admin.jobsPage.ui.runLimitCaption', {
                  context: runLimit.unit,
                  count: parsedRunLimit ?? runLimit.default,
                })}
              </Typography>
            )}
          </Box>

          {error && (
            <Alert severity="error" onClose={() => setError(null)}>
              {error}
            </Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={saving}>
          {t('common.cancel')}
        </Button>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={saving || runLimitInvalid || minuteInvalid}
          startIcon={saving ? <CircularProgress size={16} /> : null}
        >
          {saving ? t('admin.common.saving') : t('common.save')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
