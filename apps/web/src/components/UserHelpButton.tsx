import { useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { IconButton, Tooltip } from '@mui/material'
import HelpOutlineIcon from '@mui/icons-material/HelpOutline'
import { docsForLocation } from '@/pages/guide/routeDocs'
import { useUserHelp } from '@/hooks/useUserHelp'
import { USER_GUIDE_ROUTE } from './docs/guidePaths'

/**
 * The app bar's help button: the user guide pages for the screen you are on,
 * in a drawer beside it, or the guide's contents where no page describes the
 * screen. Absent in the admin console, which has its own Guide button per
 * section, and on the guide itself. The drawer belongs to `UserHelpProvider`,
 * so a hint or an inline ? icon opens the same one.
 */
export function UserHelpButton() {
  const { t } = useTranslation()
  const location = useLocation()
  const navigate = useNavigate()
  const { openHelp } = useUserHelp()

  const docs = useMemo(
    () => docsForLocation(location.pathname, location.search),
    [location.pathname, location.search]
  )

  const path = location.pathname
  if (path.startsWith('/admin') || path === USER_GUIDE_ROUTE || path.startsWith(`${USER_GUIDE_ROUTE}/`)) {
    return null
  }

  const label = docs.length > 0 ? t('userGuide.help.tooltip') : t('userGuide.help.openGuide')

  return (
    <Tooltip title={label}>
      <IconButton
        size="small"
        aria-label={label}
        data-tour="app-help"
        onClick={() => {
          if (docs.length === 0) {
            navigate(USER_GUIDE_ROUTE)
            return
          }
          openHelp(docs)
        }}
      >
        <HelpOutlineIcon />
      </IconButton>
    </Tooltip>
  )
}
