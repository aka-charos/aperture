import { useTranslation } from 'react-i18next'
import { alpha, IconButton, Tooltip } from '@mui/material'
import QuestionMarkRoundedIcon from '@mui/icons-material/QuestionMarkRounded'
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
        sx={{
          width: 24,
          height: 24,
          p: 0,
          flex: '0 0 auto',
          color: 'primary.light',
          border: 1,
          borderColor: (theme) => alpha(theme.palette.primary.light, 0.45),
          bgcolor: (theme) => alpha(theme.palette.primary.main, 0.12),
          '&:hover': { bgcolor: (theme) => alpha(theme.palette.primary.main, 0.24) },
          // Drawn small beside a heading, but tapped at a full 44px.
          '&::after': { content: '""', position: 'absolute', inset: -10 },
        }}
      >
        <QuestionMarkRoundedIcon sx={{ fontSize: 15 }} />
      </IconButton>
    </Tooltip>
  )
}
