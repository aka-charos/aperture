import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Box,
  Typography,
  Card,
  CardContent,
  Button,
  Alert,
  Stack,
  CircularProgress,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  IconButton,
} from '@mui/material'
import AssessmentIcon from '@mui/icons-material/Assessment'
import DownloadIcon from '@mui/icons-material/Download'
import TableChartIcon from '@mui/icons-material/TableChart'
import HubIcon from '@mui/icons-material/Hub'

interface EvaluationRun {
  id: string
  createdAt: string
  mediaType: string
  model: string
  dimensions: number
  poolSize: number
  qualifiedUsers: number
  seedTitles: string[]
  usedDefaultSeeds: boolean
}

/**
 * What past evaluations measured, and the CSVs of it.
 *
 * The job log cannot serve this. A single set's report is roughly 450 entries
 * and the log keeps a 30-entry head plus a tail within 300, so on a two-set run
 * -- the only kind that answers a comparison -- the second set's summary table
 * is always in the discarded middle. Worse, what survived read as coherent:
 * one set's table sitting directly above another set's neighbour dump.
 *
 * "Download everything" is the primary action rather than a per-run one,
 * because the stated use is comparing across models and seed lists, and each
 * row already carries the model, the pool size and the run date that make a
 * merged sheet pivotable.
 */
export function EvaluationResultsSection() {
  const { t } = useTranslation()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [runs, setRuns] = useState<EvaluationRun[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/settings/evaluation/runs', { credentials: 'include' })
      if (!res.ok) {
        setError(t('settingsEvaluation.results.loadError'))
        return
      }
      const data = (await res.json()) as { runs: EvaluationRun[] }
      setRuns(data.runs)
    } catch {
      setError(t('settingsEvaluation.results.loadError'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  // Same idiom as the backup download: a plain GET carrying the session
  // cookie, with the filename decided by Content-Disposition on the server.
  const download = (kind: 'metrics' | 'neighbours', runId?: string) => {
    const params = new URLSearchParams({ kind })
    if (runId) params.set('runId', runId)
    window.open(`/api/settings/evaluation/export?${params.toString()}`, '_blank')
  }

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
        <CircularProgress />
      </Box>
    )
  }

  return (
    <Card>
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <AssessmentIcon color="primary" />
          <Typography variant="h6">{t('settingsEvaluation.results.title')}</Typography>
        </Box>

        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t('settingsEvaluation.results.description')}
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: 'wrap', gap: 1 }}>
          <Button
            variant="contained"
            startIcon={<TableChartIcon />}
            onClick={() => download('metrics')}
            disabled={runs.length === 0}
          >
            {t('settingsEvaluation.results.downloadMetrics')}
          </Button>
          <Button
            variant="outlined"
            startIcon={<HubIcon />}
            onClick={() => download('neighbours')}
            disabled={runs.length === 0}
          >
            {t('settingsEvaluation.results.downloadNeighbours')}
          </Button>
        </Stack>

        {runs.length === 0 ? (
          <Alert severity="info">{t('settingsEvaluation.results.empty')}</Alert>
        ) : (
          <>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              {t('settingsEvaluation.results.poolWarning')}
            </Typography>
            <TableContainer sx={{ overflowX: 'auto' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{t('settingsEvaluation.results.colDate')}</TableCell>
                    <TableCell>{t('settingsEvaluation.results.colSet')}</TableCell>
                    <TableCell align="right">{t('settingsEvaluation.results.colTitles')}</TableCell>
                    <TableCell align="right">{t('settingsEvaluation.results.colViewers')}</TableCell>
                    <TableCell align="right">{t('settingsEvaluation.results.colSeeds')}</TableCell>
                    <TableCell align="right">{t('settingsEvaluation.results.colDownload')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {runs.map((run) => (
                    <TableRow key={run.id}>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>
                        {new Date(run.createdAt).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <Typography
                          variant="body2"
                          sx={{ fontFamily: 'monospace', fontSize: '0.75rem', wordBreak: 'break-all' }}
                        >
                          {run.model}
                        </Typography>
                      </TableCell>
                      <TableCell align="right">{run.poolSize.toLocaleString()}</TableCell>
                      <TableCell align="right">{run.qualifiedUsers}</TableCell>
                      <TableCell align="right">
                        {run.usedDefaultSeeds
                          ? t('settingsEvaluation.results.defaultSeeds')
                          : run.seedTitles.length}
                      </TableCell>
                      <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                        <Tooltip title={t('settingsEvaluation.results.downloadMetrics')}>
                          <IconButton size="small" onClick={() => download('metrics', run.id)}>
                            <DownloadIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title={t('settingsEvaluation.results.downloadNeighbours')}>
                          <IconButton size="small" onClick={() => download('neighbours', run.id)}>
                            <HubIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </>
        )}
      </CardContent>
    </Card>
  )
}
