/**
 * The decision-model benchmark's results: labelled pairs, scored for the
 * similarity threshold, the free director-or-franchise rule and the model side
 * by side. The no-shared-credits subtotal gets its own line because it is the
 * only place the model can be worth more than the rule.
 *
 * The score line is the answer; the table is the evidence for it. Each pair
 * shows the label a person gave it and why, then each side's call, coloured by
 * whether it matches the label — so a reader can disagree with a label and see
 * at once what the score would be without it. Arguable pairs are shown in
 * grey and never counted, which is the server's rule (scoreBenchmark); this
 * file only renders the counts it is sent.
 *
 * The shapes below mirror core's evidenceBenchmarkPairs.ts by hand: the web
 * bundle never imports @aperture/core.
 */
import { useTranslation } from 'react-i18next'
import {
  Alert,
  Box,
  Chip,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'

type BenchmarkLabel = 'yes' | 'no' | 'arguable'

interface BenchmarkPairResult {
  id: string
  label: BenchmarkLabel
  reason: { kind: string; name?: string }
  pickTitle: string
  watchedTitle: string
  status: 'scored' | 'notInLibrary' | 'failed' | 'notRun'
  missing: Array<'pick' | 'watched'>
  similarity: number | null
  thresholdSays: boolean | null
  modelRuns: number[]
  modelSays: boolean | null
  unstable: boolean
  /** Absent on a server older than the credits rule. */
  ruleSays?: boolean | null
  ruleBasis?: 'director' | 'franchise' | null
  error?: string
}

interface BenchmarkTally {
  scored: number
  thresholdRight: number
  ruleRight?: number
  modelRight: number
}

interface BenchmarkScore extends BenchmarkTally {
  modelFixed: number
  modelBroke: number
  modelBeatRule?: number
  ruleBeatModel?: number
  noSharedCredits?: BenchmarkTally
  unstable: number
  arguable: number
  notInLibrary: number
  failed: number
  notRun: number
}

export type BenchmarkResult =
  | {
      success: true
      model: string
      answeredModel: string | null
      threshold: number
      embeddingSet: string | null
      durationMs: number
      stoppedReason: string | null
      score: BenchmarkScore
      pairs: BenchmarkPairResult[]
    }
  | { success: false; error: string }

/** Green when a side agrees with the label, red when not, grey when there is nothing to agree with. */
function verdictColor(says: boolean | null, label: BenchmarkLabel): string {
  if (says == null || label === 'arguable') return 'text.secondary'
  return says === (label === 'yes') ? 'success.main' : 'error.main'
}

export function DecisionModelBenchmarkResults({ result }: { result: BenchmarkResult }) {
  const { t } = useTranslation()

  if (!result.success) {
    return <Alert severity="error">{result.error}</Alert>
  }

  const { score } = result
  const shown = result.pairs.filter((p) => p.status !== 'notInLibrary')
  const missing = result.pairs.filter((p) => p.status === 'notInLibrary')
  const verdictText = (says: boolean | null) =>
    says == null
      ? '—'
      : says
        ? t('settingsDecisionModel.verdictYes')
        : t('settingsDecisionModel.verdictNo')

  return (
    <Stack spacing={1.5}>
      {score.scored === 0 ? (
        <Alert severity="warning">{t('settingsDecisionModel.benchmarkNone')}</Alert>
      ) : (
        <Alert severity={score.modelRight > Math.max(score.thresholdRight, score.ruleRight ?? 0) ? 'success' : 'info'}>
          {t('settingsDecisionModel.benchmarkSummary', {
            scored: score.scored,
            thresholdRight: score.thresholdRight,
            ruleRight: score.ruleRight ?? 0,
            modelRight: score.modelRight,
            fixed: score.modelFixed,
            broke: score.modelBroke,
            beatRule: score.modelBeatRule ?? 0,
            lostToRule: score.ruleBeatModel ?? 0,
          })}
        </Alert>
      )}

      {/* The subtotal that decides whether the model is worth more than reading
          two columns: on pairs the rule has nothing to match on, only reading
          the films can get the answer right. */}
      {score.noSharedCredits && score.noSharedCredits.scored > 0 && (
        <Alert severity="info" icon={false}>
          {t('settingsDecisionModel.benchmarkNoSharedCredits', {
            scored: score.noSharedCredits.scored,
            thresholdRight: score.noSharedCredits.thresholdRight,
            ruleRight: score.noSharedCredits.ruleRight ?? 0,
            modelRight: score.noSharedCredits.modelRight,
          })}
        </Alert>
      )}
      {score.noSharedCredits && score.noSharedCredits.scored < 10 && score.scored > 0 && (
        <Typography variant="caption" color="text.secondary">
          {t('settingsDecisionModel.benchmarkFewNoCredits', {
            count: score.noSharedCredits.scored,
          })}
        </Typography>
      )}

      {result.stoppedReason && (
        <Alert severity="warning">
          {t('settingsDecisionModel.benchmarkStopped', { reason: result.stoppedReason })}
        </Alert>
      )}
      {score.unstable > 0 && (
        <Alert severity="warning">
          {t('settingsDecisionModel.benchmarkUnstable', { count: score.unstable })}
        </Alert>
      )}

      <Typography variant="caption" color="text.secondary">
        {t('settingsDecisionModel.benchmarkDetail', {
          model: result.answeredModel ?? result.model,
          arguable: score.arguable,
          embeddingSet: result.embeddingSet ?? '—',
          threshold: result.threshold.toFixed(2),
          ms: result.durationMs,
        })}
      </Typography>

      {shown.length > 0 && (
        <Box sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('settingsDecisionModel.benchmarkColumnPair')}</TableCell>
                <TableCell>{t('settingsDecisionModel.benchmarkColumnLabel')}</TableCell>
                <TableCell align="right">{t('settingsDecisionModel.columnSimilarity')}</TableCell>
                <TableCell>{t('settingsDecisionModel.benchmarkColumnThreshold')}</TableCell>
                <TableCell>{t('settingsDecisionModel.benchmarkColumnRule')}</TableCell>
                <TableCell>{t('settingsDecisionModel.benchmarkColumnModel')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {shown.map((pair) => (
                <TableRow key={pair.id} sx={pair.label === 'arguable' ? { opacity: 0.7 } : undefined}>
                  <TableCell>
                    <Typography variant="body2">
                      {pair.pickTitle} ← {pair.watchedTitle}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">
                      {t(
                        pair.label === 'yes'
                          ? 'settingsDecisionModel.labelYes'
                          : pair.label === 'no'
                            ? 'settingsDecisionModel.labelNo'
                            : 'settingsDecisionModel.labelArguable'
                      )}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {t(`settingsDecisionModel.benchmarkReason.${pair.reason.kind}`, {
                        name: pair.reason.name ?? '',
                      })}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    {pair.similarity != null ? pair.similarity.toFixed(3) : '—'}
                  </TableCell>
                  <TableCell sx={{ color: verdictColor(pair.thresholdSays, pair.label) }}>
                    {verdictText(pair.thresholdSays)}
                  </TableCell>
                  <TableCell sx={{ color: verdictColor(pair.ruleSays ?? null, pair.label) }}>
                    {verdictText(pair.ruleSays ?? null)}
                    {pair.ruleBasis && (
                      <Typography variant="caption" color="text.secondary" display="block">
                        {t(
                          pair.ruleBasis === 'director'
                            ? 'settingsDecisionModel.ruleBasisDirector'
                            : 'settingsDecisionModel.ruleBasisFranchise'
                        )}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell sx={{ color: verdictColor(pair.modelSays, pair.label) }}>
                    {pair.status === 'failed' ? (
                      <Typography variant="caption" color="error.main">
                        {t('settingsDecisionModel.benchmarkFailed', { error: pair.error ?? '' })}
                      </Typography>
                    ) : pair.status === 'notRun' ? (
                      <Typography variant="caption" color="text.secondary">
                        {t('settingsDecisionModel.benchmarkNotRun')}
                      </Typography>
                    ) : (
                      <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
                        <span>{verdictText(pair.modelSays)}</span>
                        <Typography variant="caption" color="text.secondary">
                          {pair.modelRuns.map((p) => `${Math.round(p * 100)}%`).join(' / ')}
                        </Typography>
                        {pair.unstable && (
                          <Chip
                            size="small"
                            color="warning"
                            variant="outlined"
                            label={t('settingsDecisionModel.benchmarkUnstableChip')}
                          />
                        )}
                      </Box>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      )}

      {missing.length > 0 && (
        <Typography variant="caption" color="text.secondary">
          {t('settingsDecisionModel.benchmarkNotInLibrary', {
            titles: missing.map((p) => `${p.pickTitle} ← ${p.watchedTitle}`).join('; '),
          })}
        </Typography>
      )}
    </Stack>
  )
}
