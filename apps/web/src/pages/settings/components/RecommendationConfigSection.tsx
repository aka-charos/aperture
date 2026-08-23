import { useTranslation } from 'react-i18next'
import {
  Box,
  Typography,
  Card,
  CardContent,
  Grid,
  TextField,
  Button,
  Alert,
  CircularProgress,
  Chip,
  Tooltip,
  Slider,
  FormControl,
  IconButton,
} from '@mui/material'
import MovieIcon from '@mui/icons-material/Movie'
import TvIcon from '@mui/icons-material/Tv'
import RestartAltIcon from '@mui/icons-material/RestartAlt'
import SaveIcon from '@mui/icons-material/Save'
import HelpOutlineIcon from '@mui/icons-material/HelpOutline'
import type { RecommendationConfig, MediaTypeConfig } from '../types'

type HelpSettingKey =
  | 'maxCandidates'
  | 'selectedCount'
  | 'recentWatchLimit'
  | 'similarityWeight'
  | 'noveltyWeight'
  | 'ratingWeight'
  | 'diversityWeight'
  | 'newCandidateThreshold'
  | 'maxRunAgeDays'
  | 'twinMaxSlots'
  | 'twinThresholdK'
  | 'interestMaxSlots'
  | 'acclaimedMaxSlots'
  | 'acclaimedMinRating'
  | 'acclaimedMinVotes'

function HelpIcon({ settingKey }: { settingKey: HelpSettingKey }) {
  const { t } = useTranslation()
  const p = `settingsRecAlgo.help.${settingKey}`
  return (
    <Tooltip
      title={
        <Box sx={{ p: 0.5 }}>
          <Typography variant="subtitle2" fontWeight={600} gutterBottom>
            {t(`${p}.title`)}
          </Typography>
          <Typography variant="body2" sx={{ mb: 1 }}>
            {t(`${p}.description`)}
          </Typography>
          <Typography variant="body2" sx={{ mb: 0.5 }}>
            <strong>{t('settingsRecAlgo.helpIncrease')}</strong> {t(`${p}.increase`)}
          </Typography>
          <Typography variant="body2" sx={{ mb: 0.5 }}>
            <strong>{t('settingsRecAlgo.helpDecrease')}</strong> {t(`${p}.decrease`)}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1, fontStyle: 'italic' }}>
            💡 {t(`${p}.example`)}
          </Typography>
        </Box>
      }
      arrow
      placement="top"
      enterDelay={200}
      leaveDelay={100}
      componentsProps={{
        tooltip: {
          sx: {
            bgcolor: 'background.paper',
            color: 'text.primary',
            boxShadow: 3,
            maxWidth: 320,
            '& .MuiTooltip-arrow': {
              color: 'background.paper',
            },
          },
        },
      }}
    >
      <IconButton size="small" sx={{ ml: 0.5, p: 0.25 }}>
        <HelpOutlineIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
      </IconButton>
    </Tooltip>
  )
}

interface MediaTypeCardProps {
  title: string
  icon: React.ReactNode
  config: MediaTypeConfig
  /**
   * How many titles of this media type the library holds -- the ceiling on
   * maxCandidates. Retrieval is one ANN query over one embedding table, so a
   * limit above the row count cannot return more titles; it only costs the
   * HNSW index and buys an exact sequential scan instead. 0 means "not known
   * yet" (library unsynced, or the request has not landed), where falling back
   * to the stored value keeps the slider usable instead of collapsing it.
   */
  libraryCount: number
  isDirty: boolean
  isSaving: boolean
  isLoading: boolean
  onSave: () => void
  onReset: () => void
  onUpdateField: <K extends keyof MediaTypeConfig>(field: K, value: MediaTypeConfig[K]) => void
}

function MediaTypeCard({
  title,
  icon,
  config,
  libraryCount,
  isDirty,
  isSaving,
  isLoading,
  onSave,
  onReset,
  onUpdateField,
}: MediaTypeCardProps) {
  const { t } = useTranslation()
  // The top of the slider is the whole library, because that IS unlimited here
  // -- the old MAX_UNLIMITED sentinel only asked the planner for rows that do
  // not exist. A stored value above the ceiling displays AS the ceiling rather
  // than silently re-saving: it is already exactly what the run will score, and
  // the stored copy is corrected by the next sync or the next save.
  const candidateCeiling = libraryCount > 0 ? libraryCount : Math.max(config.maxCandidates, 1000)
  const candidateFloor = Math.min(500, candidateCeiling)
  const effectiveMaxCandidates = Math.min(
    Math.max(config.maxCandidates, candidateFloor),
    candidateCeiling
  )
  // What each blend weight actually carries, which is not the same question as
  // whether they add to 100%.
  //
  // calculateBaseScore divides by the sum of these THREE, so the sliders have
  // no sum-to-1 constraint at all -- 0.4/0.2/0.2 and 0.8/0.4/0.4 are the same
  // blend. The old badge totalled them and went green only near 100%, which
  // asserted a rule the arithmetic does not impose and left every real setting
  // showing an amber warning for nothing.
  //
  // Diversity is deliberately absent. It is applied when the final list is
  // picked, never when candidates are scored -- its own help text says so --
  // so counting it here presented it as competing for a budget it does not
  // draw from, and pushed every other slider's apparent share about 1.5%
  // below its real one.
  const blendTotal = config.similarityWeight + config.noveltyWeight + config.ratingWeight
  const blendShares = (
    blendTotal > 0
      ? [config.similarityWeight, config.noveltyWeight, config.ratingWeight].map(
          (weight) => weight / blendTotal
        )
      : // Mirrors calculateBaseScore's own fallback when every slider is at zero.
        [1 / 3, 1 / 3, 1 / 3]
  ).map((share) => Math.round(share * 100))

  return (
    <Card variant="outlined" sx={{ height: '100%' }}>
      <CardContent>
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
          <Box display="flex" alignItems="center" gap={1}>
            {icon}
            <Typography variant="subtitle1" fontWeight={600}>
              {title}
            </Typography>
          </Box>
          <Box display="flex" gap={0.5}>
            <Tooltip title={t('settingsRecAlgo.resetTooltip')}>
              <Button
                size="small"
                onClick={onReset}
                disabled={isSaving || isLoading}
                sx={{ minWidth: 32 }}
              >
                <RestartAltIcon fontSize="small" />
              </Button>
            </Tooltip>
            <Button
              variant="contained"
              size="small"
              onClick={onSave}
              disabled={isSaving || isLoading || !isDirty}
              startIcon={isSaving ? <CircularProgress size={14} /> : <SaveIcon />}
            >
              {t('settingsRecAlgo.save')}
            </Button>
          </Box>
        </Box>

        {/* Candidate Selection */}
        <Typography variant="caption" color="text.secondary" fontWeight={600} display="block" mb={1}>
          {t('settingsRecAlgo.sectionSelection')}
        </Typography>

        {/* Max Candidates */}
        <FormControl fullWidth sx={{ mb: 2 }} size="small">
          <Box display="flex" alignItems="center">
            <Typography variant="body2">
              {t('settingsRecAlgo.maxCandidatesLabel')}{' '}
              <strong>
                {effectiveMaxCandidates >= candidateCeiling
                  ? t('settingsRecAlgo.maxCandidatesAll', { total: candidateCeiling.toLocaleString() })
                  : effectiveMaxCandidates.toLocaleString()}
              </strong>
            </Typography>
            <HelpIcon settingKey="maxCandidates" />
          </Box>
          <Slider
            value={effectiveMaxCandidates}
            onChange={(_, v) => onUpdateField('maxCandidates', v as number)}
            min={candidateFloor}
            max={candidateCeiling}
            step={candidateCeiling > 5000 ? 100 : 10}
            size="small"
            marks={[
              { value: candidateFloor, label: candidateFloor.toLocaleString() },
              { value: candidateCeiling, label: t('settingsRecAlgo.maxCandidatesAllShort') },
            ]}
          />
        </FormControl>

        {/* Selected Count */}
        <FormControl fullWidth sx={{ mb: 2 }} size="small">
          <Box display="flex" alignItems="center">
            <Typography variant="body2">{t('settingsRecAlgo.recsPerUser')}</Typography>
            <HelpIcon settingKey="selectedCount" />
          </Box>
          <TextField
            type="number"
            value={config.selectedCount}
            onChange={(e) => {
              const next = Math.max(1, parseInt(e.target.value) || 1)
              onUpdateField('selectedCount', next)
              // Reserved slots spend from this budget, so shrinking the list
              // has to shrink them with it — otherwise the sliders below would
              // sit above their own maximum and the save would be refused.
              const interests = Math.min(config.interestMaxSlots, next)
              if (interests !== config.interestMaxSlots) {
                onUpdateField('interestMaxSlots', interests)
              }
              const twins = Math.min(config.twinMaxSlots, Math.max(0, next - interests))
              if (twins !== config.twinMaxSlots) {
                onUpdateField('twinMaxSlots', twins)
              }
              const acclaimed = Math.min(
                config.acclaimedMaxSlots,
                Math.max(0, next - interests - twins)
              )
              if (acclaimed !== config.acclaimedMaxSlots) {
                onUpdateField('acclaimedMaxSlots', acclaimed)
              }
            }}
            size="small"
            InputProps={{
              inputProps: { min: 1, max: 500 },
            }}
          />
        </FormControl>

        {/* Recent Watch Limit */}
        <FormControl fullWidth sx={{ mb: 2 }} size="small">
          <Box display="flex" alignItems="center">
            <Typography variant="body2">{t('settingsRecAlgo.watchHistoryDepth')}</Typography>
            <HelpIcon settingKey="recentWatchLimit" />
          </Box>
          <TextField
            type="number"
            value={config.recentWatchLimit}
            onChange={(e) => onUpdateField('recentWatchLimit', Math.max(1, parseInt(e.target.value) || 1))}
            size="small"
            InputProps={{
              inputProps: { min: 1, max: 500 },
            }}
          />
        </FormControl>

        {/* Weights */}
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
          <Typography variant="caption" color="text.secondary" fontWeight={600}>
            {t('settingsRecAlgo.sectionWeights')}
          </Typography>
          {/* Reads in the order the sliders below appear, and matches the
              shares the insights panel prints under each bar -- the two
              surfaces are meant to be comparable. */}
          <Chip
            label={blendShares.join(' / ')}
            size="small"
            sx={{ height: 20, fontSize: '0.7rem' }}
          />
        </Box>

        {/* Similarity Weight */}
        <FormControl fullWidth sx={{ mb: 1.5 }} size="small">
          <Box display="flex" justifyContent="space-between" alignItems="center">
            <Box display="flex" alignItems="center">
              <Typography variant="body2">{t('settingsRecAlgo.weightSimilarity')}</Typography>
              <HelpIcon settingKey="similarityWeight" />
            </Box>
            <Typography variant="body2" color="primary" fontWeight={600}>
              {(config.similarityWeight * 100).toFixed(0)}%
            </Typography>
          </Box>
          <Slider
            value={config.similarityWeight * 100}
            onChange={(_, v) => onUpdateField('similarityWeight', (v as number) / 100)}
            min={0}
            max={100}
            size="small"
          />
        </FormControl>

        {/* Novelty Weight */}
        <FormControl fullWidth sx={{ mb: 1.5 }} size="small">
          <Box display="flex" justifyContent="space-between" alignItems="center">
            <Box display="flex" alignItems="center">
              <Typography variant="body2">{t('settingsRecAlgo.weightDiscovery')}</Typography>
              <HelpIcon settingKey="noveltyWeight" />
            </Box>
            <Typography variant="body2" color="primary" fontWeight={600}>
              {(config.noveltyWeight * 100).toFixed(0)}%
            </Typography>
          </Box>
          <Slider
            value={config.noveltyWeight * 100}
            onChange={(_, v) => onUpdateField('noveltyWeight', (v as number) / 100)}
            min={0}
            max={100}
            size="small"
          />
        </FormControl>

        {/* Rating Weight */}
        <FormControl fullWidth sx={{ mb: 1.5 }} size="small">
          <Box display="flex" justifyContent="space-between" alignItems="center">
            <Box display="flex" alignItems="center">
              <Typography variant="body2">{t('settingsRecAlgo.weightRating')}</Typography>
              <HelpIcon settingKey="ratingWeight" />
            </Box>
            <Typography variant="body2" color="primary" fontWeight={600}>
              {(config.ratingWeight * 100).toFixed(0)}%
            </Typography>
          </Box>
          <Slider
            value={config.ratingWeight * 100}
            onChange={(_, v) => onUpdateField('ratingWeight', (v as number) / 100)}
            min={0}
            max={100}
            size="small"
          />
        </FormControl>

        {/* Diversity Weight */}
        <FormControl fullWidth sx={{ mb: 2 }} size="small">
          <Box display="flex" justifyContent="space-between" alignItems="center">
            <Box display="flex" alignItems="center">
              <Typography variant="body2">{t('settingsRecAlgo.weightDiversity')}</Typography>
              <HelpIcon settingKey="diversityWeight" />
            </Box>
            <Typography variant="body2" color="primary" fontWeight={600}>
              {(config.diversityWeight * 100).toFixed(0)}%
            </Typography>
          </Box>
          <Slider
            value={config.diversityWeight * 100}
            onChange={(_, v) => onUpdateField('diversityWeight', (v as number) / 100)}
            min={0}
            max={100}
            size="small"
          />
        </FormControl>

        {/* Recs Per User is a budget three things spend from, and until these
            sliders existed only one spender was visible — the other two were
            hardcoded shares applied after the fact, so a configured number and
            the number that happened were different things. Each slider's max is
            what the other one leaves behind, which makes overdrawing
            impossible in the control rather than clamped later. */}
        <Typography variant="caption" color="text.secondary" fontWeight={600} display="block" mb={1}>
          {t('settingsRecAlgo.sectionSlots')}
        </Typography>

        <Box
          sx={{
            mb: 2,
            p: 1.5,
            borderRadius: 2,
            bgcolor: 'background.default',
            display: 'flex',
            flexWrap: 'wrap',
            gap: 1.5,
            alignItems: 'baseline',
          }}
        >
          <Typography variant="body2" fontWeight={600}>
            {t('settingsRecAlgo.slotBudget', { total: config.selectedCount })}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {t('settingsRecAlgo.slotBudgetSplit', {
              ranked: Math.max(
                0,
                config.selectedCount -
                  config.interestMaxSlots -
                  config.twinMaxSlots -
                  config.acclaimedMaxSlots
              ),
              interests: config.interestMaxSlots,
              twins: config.twinMaxSlots,
              acclaimed: config.acclaimedMaxSlots,
            })}
          </Typography>
        </Box>

        <FormControl fullWidth sx={{ mb: 2 }} size="small">
          <Box display="flex" alignItems="center" justifyContent="space-between">
            <Box display="flex" alignItems="center">
              <Typography variant="body2">{t('settingsRecAlgo.interestMaxSlots')}</Typography>
              <HelpIcon settingKey="interestMaxSlots" />
            </Box>
            <Typography variant="body2" color="primary" fontWeight={600}>
              {config.interestMaxSlots}
            </Typography>
          </Box>
          <Slider
            value={config.interestMaxSlots}
            onChange={(_, v) => onUpdateField('interestMaxSlots', v as number)}
            min={0}
            max={Math.max(
              0,
              Math.min(10, config.selectedCount - config.twinMaxSlots - config.acclaimedMaxSlots)
            )}
            step={1}
            size="small"
            marks
          />
        </FormControl>

        <FormControl fullWidth sx={{ mb: 2 }} size="small">
          <Box display="flex" alignItems="center" justifyContent="space-between">
            <Box display="flex" alignItems="center">
              <Typography variant="body2">{t('settingsRecAlgo.twinMaxSlots')}</Typography>
              <HelpIcon settingKey="twinMaxSlots" />
            </Box>
            <Typography variant="body2" color="primary" fontWeight={600}>
              {config.twinMaxSlots}
            </Typography>
          </Box>
          <Slider
            value={config.twinMaxSlots}
            onChange={(_, v) => onUpdateField('twinMaxSlots', v as number)}
            min={0}
            max={Math.max(
              0,
              Math.min(10, config.selectedCount - config.interestMaxSlots - config.acclaimedMaxSlots)
            )}
            step={1}
            size="small"
            marks
          />
        </FormControl>

        <FormControl fullWidth sx={{ mb: 2 }} size="small">
          <Box display="flex" alignItems="center" justifyContent="space-between">
            <Box display="flex" alignItems="center">
              <Typography variant="body2">{t('settingsRecAlgo.acclaimedMaxSlots')}</Typography>
              <HelpIcon settingKey="acclaimedMaxSlots" />
            </Box>
            <Typography variant="body2" color="primary" fontWeight={600}>
              {config.acclaimedMaxSlots}
            </Typography>
          </Box>
          <Slider
            value={config.acclaimedMaxSlots}
            onChange={(_, v) => onUpdateField('acclaimedMaxSlots', v as number)}
            min={0}
            max={Math.max(
              0,
              Math.min(10, config.selectedCount - config.interestMaxSlots - config.twinMaxSlots)
            )}
            step={1}
            size="small"
            marks
          />
        </FormControl>

        {/* The gate. Only shown once the feature is on: two thresholds for a
            disabled feature is noise. */}
        {config.acclaimedMaxSlots > 0 && (
          <>
            <FormControl fullWidth sx={{ mb: 2 }} size="small">
              <Box display="flex" alignItems="center" justifyContent="space-between">
                <Box display="flex" alignItems="center">
                  <Typography variant="body2">{t('settingsRecAlgo.acclaimedMinRating')}</Typography>
                  <HelpIcon settingKey="acclaimedMinRating" />
                </Box>
                <Typography variant="body2" color="primary" fontWeight={600}>
                  {config.acclaimedMinRating.toFixed(1)}
                </Typography>
              </Box>
              <Slider
                value={config.acclaimedMinRating}
                onChange={(_, v) => onUpdateField('acclaimedMinRating', v as number)}
                min={5}
                max={10}
                step={0.1}
                size="small"
              />
            </FormControl>

            <FormControl fullWidth sx={{ mb: 3 }} size="small">
              <Box display="flex" alignItems="center" justifyContent="space-between">
                <Box display="flex" alignItems="center">
                  <Typography variant="body2">{t('settingsRecAlgo.acclaimedMinVotes')}</Typography>
                  <HelpIcon settingKey="acclaimedMinVotes" />
                </Box>
                <Typography variant="body2" color="primary" fontWeight={600}>
                  {config.acclaimedMinVotes.toLocaleString()}
                </Typography>
              </Box>
              <Slider
                value={config.acclaimedMinVotes}
                onChange={(_, v) => onUpdateField('acclaimedMinVotes', v as number)}
                min={1000}
                max={500000}
                step={1000}
                size="small"
              />
            </FormControl>
          </>
        )}
        <FormControl fullWidth sx={{ mb: 3 }} size="small">
          <Box display="flex" alignItems="center" justifyContent="space-between">
            <Box display="flex" alignItems="center">
              <Typography variant="body2">{t('settingsRecAlgo.twinThresholdK')}</Typography>
              <HelpIcon settingKey="twinThresholdK" />
            </Box>
            <Typography variant="body2" color="primary" fontWeight={600}>
              {config.twinThresholdK.toFixed(1)}
            </Typography>
          </Box>
          <Slider
            value={config.twinThresholdK}
            onChange={(_, v) => onUpdateField('twinThresholdK', v as number)}
            min={1}
            max={4}
            step={0.5}
            size="small"
            // Nothing to tune when the feature is off; the number would still
            // save, which reads as though it were doing something.
            disabled={config.twinMaxSlots === 0}
            marks={[
              { value: 1, label: t('settingsRecAlgo.twinLooser') },
              { value: 4, label: t('settingsRecAlgo.twinStricter') },
            ]}
          />
        </FormControl>

        {/* When to recompute at all. Deliberately separate from the weights:
            these change nothing about what gets recommended, only how often the
            scheduled job bothers to work it out again. */}
        <Typography variant="caption" color="text.secondary" fontWeight={600} display="block" mb={1}>
          {t('settingsRecAlgo.sectionRegeneration')}
        </Typography>

        <FormControl fullWidth sx={{ mb: 2 }} size="small">
          <Box display="flex" alignItems="center">
            <Typography variant="body2">{t('settingsRecAlgo.newCandidateThreshold')}</Typography>
            <HelpIcon settingKey="newCandidateThreshold" />
          </Box>
          <TextField
            type="number"
            value={config.newCandidateThreshold}
            onChange={(e) =>
              onUpdateField('newCandidateThreshold', Math.max(1, parseInt(e.target.value) || 1))
            }
            size="small"
            InputProps={{ inputProps: { min: 1, max: 1000 } }}
          />
        </FormControl>

        <FormControl fullWidth size="small">
          <Box display="flex" alignItems="center">
            <Typography variant="body2">{t('settingsRecAlgo.maxRunAgeDays')}</Typography>
            <HelpIcon settingKey="maxRunAgeDays" />
          </Box>
          <TextField
            type="number"
            value={config.maxRunAgeDays}
            onChange={(e) =>
              onUpdateField('maxRunAgeDays', Math.max(1, parseInt(e.target.value) || 1))
            }
            size="small"
            InputProps={{ inputProps: { min: 1, max: 365 } }}
          />
        </FormControl>
      </CardContent>
    </Card>
  )
}

interface RecommendationConfigSectionProps {
  recConfig: RecommendationConfig | null
  libraryCounts: { movies: number; series: number } | null
  loadingRecConfig: boolean
  savingRecConfig: boolean
  recConfigError: string | null
  setRecConfigError: (error: string | null) => void
  recConfigSuccess: string | null
  setRecConfigSuccess: (success: string | null) => void
  movieConfigDirty: boolean
  seriesConfigDirty: boolean
  saveMovieConfig: () => void
  saveSeriesConfig: () => void
  resetMovieConfig: () => void
  resetSeriesConfig: () => void
  updateMovieConfigField: <K extends keyof MediaTypeConfig>(field: K, value: MediaTypeConfig[K]) => void
  updateSeriesConfigField: <K extends keyof MediaTypeConfig>(field: K, value: MediaTypeConfig[K]) => void
}

export function RecommendationConfigSection({
  recConfig,
  libraryCounts,
  loadingRecConfig,
  savingRecConfig,
  recConfigError,
  setRecConfigError,
  recConfigSuccess,
  setRecConfigSuccess,
  movieConfigDirty,
  seriesConfigDirty,
  saveMovieConfig,
  saveSeriesConfig,
  resetMovieConfig,
  resetSeriesConfig,
  updateMovieConfigField,
  updateSeriesConfigField,
}: RecommendationConfigSectionProps) {
  const { t } = useTranslation()
  return (
    <Box>
      <Typography variant="h6" gutterBottom>
        {t('settingsRecAlgo.title')}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t('settingsRecAlgo.subtitle')}
      </Typography>

      {recConfigError && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setRecConfigError(null)}>
          {recConfigError}
        </Alert>
      )}

      {recConfigSuccess && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setRecConfigSuccess(null)}>
          {recConfigSuccess}
        </Alert>
      )}

      {loadingRecConfig ? (
        <Box display="flex" justifyContent="center" py={4}>
          <CircularProgress />
        </Box>
      ) : recConfig ? (
        <Grid container spacing={2}>
          <Grid item xs={12} md={6}>
            <MediaTypeCard
              title={t('settingsRecAlgo.moviesCardTitle')}
              icon={<MovieIcon color="primary" />}
              config={recConfig.movie}
              libraryCount={libraryCounts?.movies ?? 0}
              isDirty={movieConfigDirty}
              isSaving={savingRecConfig}
              isLoading={loadingRecConfig}
              onSave={saveMovieConfig}
              onReset={resetMovieConfig}
              onUpdateField={updateMovieConfigField}
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <MediaTypeCard
              title={t('settingsRecAlgo.seriesCardTitle')}
              icon={<TvIcon color="secondary" />}
              config={recConfig.series}
              libraryCount={libraryCounts?.series ?? 0}
              isDirty={seriesConfigDirty}
              isSaving={savingRecConfig}
              isLoading={loadingRecConfig}
              onSave={saveSeriesConfig}
              onReset={resetSeriesConfig}
              onUpdateField={updateSeriesConfigField}
            />
          </Grid>
        </Grid>
      ) : (
        <Alert severity="warning">
          {t('settingsRecAlgo.loadFailed')}
        </Alert>
      )}

      <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 2 }}>
        {t('settingsRecAlgo.footer')}
      </Typography>
    </Box>
  )
}
