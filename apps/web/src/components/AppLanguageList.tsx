import { List, ListItemButton, ListItemIcon, ListItemText } from '@mui/material'
import CheckIcon from '@mui/icons-material/Check'
import { LocaleFlag } from './LocaleFlag'

export type AppLanguageOption = { code: string; label: string }

interface AppLanguageListProps {
  options: AppLanguageOption[]
  /** The language on screen; its row is marked. */
  value: string
  onSelect: (code: string) => void
  disabled?: boolean
}

/**
 * The list of app languages, flag and native name per row, the current one
 * ticked. Shared by the app-bar switcher and the login page so the two cannot
 * drift. Choosing the current row does nothing.
 */
export function AppLanguageList({ options, value, onSelect, disabled }: AppLanguageListProps) {
  return (
    <List dense disablePadding sx={{ pb: 1 }}>
      {options.map((option) => (
        <ListItemButton
          key={option.code}
          selected={option.code === value}
          disabled={disabled}
          onClick={() => {
            if (option.code !== value) onSelect(option.code)
          }}
          lang={option.code}
        >
          <ListItemIcon sx={{ minWidth: 36 }}>
            <LocaleFlag locale={option.code} />
          </ListItemIcon>
          <ListItemText primary={option.label} />
          {option.code === value && (
            <CheckIcon fontSize="small" color="primary" sx={{ marginInlineStart: 1 }} />
          )}
        </ListItemButton>
      ))}
    </List>
  )
}
