import { useTranslation } from 'react-i18next'
import { IconButton, Tooltip } from '@mui/material'
import HelpOutlineIcon from '@mui/icons-material/HelpOutline'
import { useUserHelp } from '@/hooks/useUserHelp'

interface HelpHintProps {
  /** A user guide page, as its path under docs/features/ without `.md`. */
  doc: string
  /** A heading on that page, as the page's own heading id. */
  anchor?: string
  /** What the icon explains, for its tooltip and its accessible name. */
  label?: string
}

/**
 * A small ? beside a dense widget (score bars, a weight slider) that opens the
 * user guide at the part explaining it. Pinned by `tours.test.ts`, which fails
 * on a `doc` or `anchor` that does not exist in docs/features/ — so write both
 * as plain string literals, which is what it reads.
 */
export function HelpHint({ doc, anchor, label }: HelpHintProps) {
  const { t } = useTranslation()
  const { openHelp } = useUserHelp()
  const text = label ?? t('onboarding.helpHint')
  return (
    <Tooltip title={text}>
      <IconButton
        size="small"
        aria-label={text}
        onClick={(event) => {
          // Usually sits inside something clickable (an accordion header).
          event.stopPropagation()
          openHelp([doc], { anchor })
        }}
        sx={{ p: 0.25, color: 'text.secondary' }}
      >
        <HelpOutlineIcon sx={{ fontSize: 16 }} />
      </IconButton>
    </Tooltip>
  )
}
