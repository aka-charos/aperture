import { Button, type ButtonProps } from '@mui/material'
import { Download as DownloadIcon } from '@mui/icons-material'
import { useTranslation } from 'react-i18next'
import { downloadToFile } from './downloadToFile'

interface RunnerDownloadButtonProps {
  /** The runner's name, decided by the server; the button waits for it. */
  fileName: string | null
  size?: ButtonProps['size']
  /** What went wrong, or null once the file is saved. */
  onResult: (error: string | null) => void
}

/** The runner script for offsite batches and the bench's by-hand files alike. */
export function RunnerDownloadButton({ fileName, size, onResult }: RunnerDownloadButtonProps) {
  const { t } = useTranslation()

  const download = async () => {
    if (!fileName) return
    const result = await downloadToFile('/api/analysis-offsite/runner', fileName)
    onResult(result.ok ? null : (result.message ?? t('offsiteAnalysis.downloadRunnerFailed')))
  }

  return (
    <Button
      variant="outlined"
      size={size}
      startIcon={<DownloadIcon />}
      onClick={download}
      disabled={!fileName}
    >
      {t('offsiteAnalysis.downloadRunner')}
    </Button>
  )
}
