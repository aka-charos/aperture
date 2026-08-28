import { useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  Box,
  Divider,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Popover,
  Tooltip,
  Typography,
} from '@mui/material'
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings'
import SearchIcon from '@mui/icons-material/Search'
import { useAdminSearch } from '@/hooks/useAdminSearch'
import {
  ADMIN_GROUPS,
  adminEntriesInGroup,
  adminEntryPath,
} from '@/pages/admin/nav/registry'
import { ADMIN_ELEMENTS } from '@/pages/admin/nav/elements'

/**
 * The console's front door, in the app bar beside the avatar.
 *
 * Administration used to sit at the bottom of the sidebar, in the same list as
 * Browse and Watch History. That is the user's content navigation; admin is a
 * mode you enter, and its natural neighbour is the other control about this
 * instance rather than about the library. Moving it here also returns two
 * permanent slots at the bottom of every admin's sidebar.
 *
 * The popover opens on search, because naming the setting is faster than
 * finding it — the tree below is for when you do not have a name yet.
 */
export function AdminMenuButton() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const { open: openSearch } = useAdminSearch()
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null)
  // Same platform sniff GlobalSearch uses for its own shortcut hint.
  const shortcut = useMemo(
    () =>
      typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform)
        ? t('adminNav.searchShortcutMac')
        : t('adminNav.searchShortcutWin'),
    [t]
  )

  const inAdmin = location.pathname === '/admin' || location.pathname.startsWith('/admin/')

  const close = () => setAnchorEl(null)

  const go = (path: string) => {
    close()
    navigate(path)
  }

  return (
    <>
      <Tooltip title={t('nav.admin')}>
        <IconButton
          onClick={(e) => setAnchorEl(e.currentTarget)}
          size="small"
          aria-label={t('nav.admin')}
          sx={{ mr: 0.5, color: inAdmin ? 'primary.main' : 'inherit' }}
        >
          <AdminPanelSettingsIcon />
        </IconButton>
      </Tooltip>

      <Popover
        open={Boolean(anchorEl)}
        anchorEl={anchorEl}
        onClose={close}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { width: 280, borderRadius: 2 } } }}
      >
        <Box px={2} py={1.25}>
          <Typography variant="subtitle2" fontWeight={600}>
            {t('admin.title')}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {t('admin.subtitle')}
          </Typography>
        </Box>
        <Divider />

        <List dense disablePadding>
          <ListItemButton
            onClick={() => {
              close()
              openSearch()
            }}
          >
            <ListItemIcon sx={{ minWidth: 36 }}>
              <SearchIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText
              primary={t('adminNav.searchPlaceholder')}
              primaryTypographyProps={{ fontSize: '0.875rem' }}
            />
            <Typography variant="caption" color="text.disabled">
              {shortcut}
            </Typography>
          </ListItemButton>

          <Divider sx={{ my: 0.5 }} />

          {ADMIN_GROUPS.map((group) => {
            const entries = adminEntriesInGroup(group.id)
            if (entries.length === 0) return null
            // A group opens at its first leaf. There is no group landing page,
            // deliberately — an index that only lists what the nav column is
            // already showing is a click that buys nothing.
            const target = adminEntryPath(entries[0])
            return (
              <ListItemButton key={group.id} onClick={() => go(target)}>
                <ListItemIcon sx={{ minWidth: 36 }}>
                  {ADMIN_ELEMENTS[entries[0].id]?.icon}
                </ListItemIcon>
                <ListItemText
                  primary={t(group.labelKey)}
                  primaryTypographyProps={{ fontSize: '0.875rem' }}
                />
                {entries.length > 1 && (
                  <Typography variant="caption" color="text.disabled">
                    {entries.length}
                  </Typography>
                )}
              </ListItemButton>
            )
          })}
        </List>
      </Popover>
    </>
  )
}
