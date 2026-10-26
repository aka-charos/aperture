import { IconButton, Tooltip } from '@mui/material'
import EditNoteIcon from '@mui/icons-material/EditNote'
import { setInlineEditEnabled } from '@/i18n/inlineEdit/store'
import { useEditorT, useInlineEdit } from './useInlineEdit'

/**
 * The app bar's switch for inline text editing (admins only — Layout decides).
 * Lit while on, so an admin who forgot it is on can see why clicks open an
 * editor.
 */
export function InlineEditButton() {
  const t = useEditorT()
  const { enabled } = useInlineEdit()
  const label = enabled ? t('inlineEdit.turnOff') : t('inlineEdit.turnOn')
  return (
    <Tooltip title={label}>
      <IconButton
        size="small"
        aria-label={label}
        aria-pressed={enabled}
        data-inline-edit-ui
        onClick={() => setInlineEditEnabled(!enabled)}
        color={enabled ? 'primary' : 'default'}
        sx={enabled ? { bgcolor: 'action.selected' } : undefined}
      >
        <EditNoteIcon fontSize="small" />
      </IconButton>
    </Tooltip>
  )
}
