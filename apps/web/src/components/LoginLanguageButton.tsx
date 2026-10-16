import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  alpha,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Tooltip,
  useTheme,
} from '@mui/material'
import CheckIcon from '@mui/icons-material/Check'
import { LocaleFlag } from './LocaleFlag'

export type LoginLanguageOption = { code: string; label: string }

interface LoginLanguageButtonProps {
  options: LoginLanguageOption[]
  value: string
  onChange: (code: string) => void
}

/**
 * The language flag on the login page. There is no account yet, so this only
 * changes the page (and the browser's remembered language); the login page
 * saves the choice to the account when the person signs in. Only the app
 * language is offered — the recommendations language follows it unless the
 * person sets it apart later, from the flag in the app bar.
 */
export function LoginLanguageButton({ options, value, onChange }: LoginLanguageButtonProps) {
  const { t } = useTranslation()
  const theme = useTheme()
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null)
  const current = options.find((o) => o.code === value)
  const tooltip = t('languageMenu.tooltip', { app: current?.label ?? value })
  const side = theme.direction === 'rtl' ? ('left' as const) : ('right' as const)

  return (
    <>
      <Tooltip title={tooltip}>
        <IconButton
          onClick={(e) => setAnchorEl(e.currentTarget)}
          aria-label={tooltip}
          sx={{
            width: 44,
            height: 44,
            border: '1px solid',
            borderColor: alpha(theme.palette.common.white, 0.14),
            backgroundColor: alpha(theme.palette.common.black, 0.26),
            backdropFilter: 'blur(12px)',
            '&:hover': { backgroundColor: alpha(theme.palette.common.white, 0.08) },
          }}
        >
          <LocaleFlag locale={value} width={22} />
        </IconButton>
      </Tooltip>
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: side }}
        transformOrigin={{ vertical: 'top', horizontal: side }}
        slotProps={{ paper: { sx: { minWidth: 200, mt: 0.5 } } }}
      >
        {options.map((o) => (
          <MenuItem
            key={o.code}
            selected={o.code === value}
            lang={o.code}
            onClick={() => {
              setAnchorEl(null)
              if (o.code !== value) onChange(o.code)
            }}
          >
            <ListItemIcon sx={{ minWidth: 36 }}>
              <LocaleFlag locale={o.code} />
            </ListItemIcon>
            <ListItemText primary={o.label} />
            {o.code === value && (
              <CheckIcon fontSize="small" color="primary" sx={{ marginInlineStart: 1 }} />
            )}
          </MenuItem>
        ))}
      </Menu>
    </>
  )
}
