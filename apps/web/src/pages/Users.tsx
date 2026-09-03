import React, { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  Box,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Switch,
  Chip,
  IconButton,
  Skeleton,
  Alert,
  Button,
  CircularProgress,
  Tooltip,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  Divider,
  Snackbar,
  Card,
  CardContent,
  Stack,
  useTheme,
  useMediaQuery,
  Avatar,
  Select,
  type SelectChangeEvent,
} from '@mui/material'
import SettingsIcon from '@mui/icons-material/Settings'
import PersonAddIcon from '@mui/icons-material/PersonAdd'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import BlockIcon from '@mui/icons-material/Block'
import RefreshIcon from '@mui/icons-material/Refresh'
import SyncIcon from '@mui/icons-material/Sync'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import HistoryIcon from '@mui/icons-material/History'
import RecommendIcon from '@mui/icons-material/Recommend'
import FolderIcon from '@mui/icons-material/Folder'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import MovieIcon from '@mui/icons-material/Movie'
import TvIcon from '@mui/icons-material/Tv'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome'
import HubOutlinedIcon from '@mui/icons-material/HubOutlined'
import CollectionsBookmarkIcon from '@mui/icons-material/CollectionsBookmark'
import EmailIcon from '@mui/icons-material/Email'
import LoginIcon from '@mui/icons-material/Login'
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward'
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward'
import VisibilityIcon from '@mui/icons-material/Visibility'
import { usePageHeader } from '@/hooks/usePageHeader'
import { useAuth } from '@/hooks/useAuth'

interface ProviderUser {
  providerUserId: string
  name: string
  isAdmin: boolean
  isDisabled: boolean
  lastActivityDate?: string
  apertureUserId: string | null
  isImported: boolean
  isEnabled: boolean
  moviesEnabled: boolean
  seriesEnabled: boolean
  discoverEnabled: boolean
  discoverRequestEnabled: boolean
  collectionsEnabled: boolean
  emailNotificationsAllowed: boolean
  aiOverrideAllowed: boolean
  /** From `users.email` — set via media server sync, LLDAP import, or manual entry. Only imported users have one. */
  email: string | null
  /** When this Aperture account last signed in to the web app (persisted, survives session cleanup). Only imported users have one. */
  lastLoginAt: string | null
}

/** Renders a compact, locale-aware date+time — same convention as the Jobs history dialog. */
function formatTimestamp(value?: string | null): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleString()
}

/** 'default' is the existing enabled/imported/name grouping below — not a real ascending/descending field. */
type SortField = 'default' | 'email' | 'lastLogin' | 'lastActivity'
type SortDirection = 'asc' | 'desc'

/**
 * Nullable strings always sort to the end, regardless of direction — otherwise
 * flipping to descending would bury every user who's never logged in at the
 * top instead of the bottom, which reads as broken rather than "no data yet."
 * ISO date strings compare correctly as plain strings, so this one function
 * covers email (alphabetical) and both date fields (chronological).
 */
function compareNullable(a: string | null | undefined, b: string | null | undefined, direction: SortDirection): number {
  if (!a && !b) return 0
  if (!a) return 1
  if (!b) return -1
  const cmp = a.localeCompare(b)
  return direction === 'asc' ? cmp : -cmp
}

interface GlobalAiConfig {
  enabled: boolean
  userOverrideAllowed: boolean
}

export function UsersPage() {
  const { t } = useTranslation()
  usePageHeader(t('admin.users'))
  const { user: currentUser, impersonation, impersonate } = useAuth()
  const navigate = useNavigate()
  const theme = useTheme()
  const isMobile = useMediaQuery(theme.breakpoints.down('md'))
  const [providerUsers, setProviderUsers] = useState<ProviderUser[]>([])
  const [provider, setProvider] = useState<string>('emby')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [updating, setUpdating] = useState<string | null>(null)
  const [importing, setImporting] = useState<string | null>(null)
  // Track running jobs per user (userId -> job type)
  const [runningJobs, setRunningJobs] = useState<Map<string, string>>(new Map())
  const [syncingUsers, setSyncingUsers] = useState(false)
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({
    open: false,
    message: '',
    severity: 'success',
  })

  // Menu state
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null)
  const [menuUser, setMenuUser] = useState<ProviderUser | null>(null)
  
  // Global AI config (to know if per-user overrides are enabled globally)
  const [globalAiConfig, setGlobalAiConfig] = useState<GlobalAiConfig | null>(null)

  // Sort control for the email / web login / streaming activity columns
  const [sortField, setSortField] = useState<SortField>('default')
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')

  const fetchGlobalAiConfig = useCallback(async () => {
    try {
      const response = await fetch('/api/settings/ai-explanation', { credentials: 'include' })
      if (response.ok) {
        const data = await response.json()
        setGlobalAiConfig(data)
      }
    } catch {
      // Silently fail
    }
  }, [])

  const fetchProviderUsers = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/users/provider', { credentials: 'include' })
      if (response.ok) {
        const data = await response.json()
        setProviderUsers(data.users)
        setProvider(data.provider)
        setError(null)
      } else {
        const errData = await response.json().catch(() => ({}))
        setError(errData.error || t('admin.usersPage.errorLoadUsers'))
      }
    } catch {
      setError(t('admin.usersPage.errorConnect'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    fetchProviderUsers()
    fetchGlobalAiConfig()
  }, [fetchProviderUsers, fetchGlobalAiConfig])

  const handleSyncUsers = async () => {
    setSyncingUsers(true)
    try {
      const response = await fetch('/api/jobs/sync-users/run', {
        method: 'POST',
        credentials: 'include',
      })

      if (response.ok) {
        const data = await response.json()
        const result = data.result || {}
        const message = t('admin.usersPage.syncComplete', {
          imported: result.imported || 0,
          updated: result.updated || 0,
        })
        setSnackbar({ open: true, message, severity: 'success' })
        // Refresh the user list after sync
        await fetchProviderUsers()
      } else {
        const errData = await response.json().catch(() => ({}))
        setSnackbar({ 
          open: true, 
          message: errData.error || t('admin.usersPage.syncFailed'), 
          severity: 'error' 
        })
      }
    } catch {
      setSnackbar({ open: true, message: t('admin.usersPage.syncFailed'), severity: 'error' })
    } finally {
      setSyncingUsers(false)
    }
  }

  const handleImportUser = async (providerUserId: string, enableAfterImport: boolean = false) => {
    setImporting(providerUserId)
    try {
      const response = await fetch('/api/users/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ providerUserId, isEnabled: enableAfterImport }),
      })

      if (response.ok) {
        const data = await response.json()
        setProviderUsers((prev) =>
          prev.map((user) =>
            user.providerUserId === providerUserId
              ? { ...user, isImported: true, apertureUserId: data.user.id, isEnabled: enableAfterImport }
              : user
          )
        )
        setSnackbar({ open: true, message: t('admin.usersPage.userImported'), severity: 'success' })
      }
    } finally {
      setImporting(null)
    }
  }

  const handleToggleMovies = async (user: ProviderUser) => {
    if (!user.apertureUserId) return

    setUpdating(user.providerUserId)
    try {
      const newValue = !user.moviesEnabled
      const response = await fetch(`/api/users/${user.apertureUserId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ moviesEnabled: newValue }),
      })

      if (response.ok) {
        setProviderUsers((prev) =>
          prev.map((u) =>
            u.providerUserId === user.providerUserId
              ? { ...u, moviesEnabled: newValue, isEnabled: newValue || u.seriesEnabled }
              : u
          )
        )
      }
    } finally {
      setUpdating(null)
    }
  }

  const handleToggleSeries = async (user: ProviderUser) => {
    if (!user.apertureUserId) return

    setUpdating(user.providerUserId)
    try {
      const newValue = !user.seriesEnabled
      const response = await fetch(`/api/users/${user.apertureUserId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ seriesEnabled: newValue }),
      })

      if (response.ok) {
        setProviderUsers((prev) =>
          prev.map((u) =>
            u.providerUserId === user.providerUserId
              ? { ...u, seriesEnabled: newValue, isEnabled: u.moviesEnabled || newValue }
              : u
          )
        )
      }
    } finally {
      setUpdating(null)
    }
  }

  const handleToggleAiOverride = async (user: ProviderUser) => {
    if (!user.apertureUserId) return

    setUpdating(user.providerUserId)
    try {
      const newValue = !user.aiOverrideAllowed
      const response = await fetch(`/api/settings/ai-explanation/user/${user.apertureUserId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ overrideAllowed: newValue }),
      })

      if (response.ok) {
        setProviderUsers((prev) =>
          prev.map((u) =>
            u.providerUserId === user.providerUserId
              ? { ...u, aiOverrideAllowed: newValue }
              : u
          )
        )
        setSnackbar({ 
          open: true, 
          message: newValue 
            ? t('admin.usersPage.aiOverrideOn', { name: user.name })
            : t('admin.usersPage.aiOverrideOff', { name: user.name }),
          severity: 'success' 
        })
      }
    } finally {
      setUpdating(null)
    }
  }

  const handleToggleDiscover = async (user: ProviderUser) => {
    if (!user.apertureUserId) return

    setUpdating(user.providerUserId)
    try {
      const newValue = !user.discoverEnabled
      const response = await fetch(`/api/users/${user.apertureUserId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ 
          discoverEnabled: newValue,
          // If disabling discovery, also disable request permission
          ...(newValue === false && { discoverRequestEnabled: false }),
        }),
      })

      if (response.ok) {
        setProviderUsers((prev) =>
          prev.map((u) =>
            u.providerUserId === user.providerUserId
              ? { 
                  ...u, 
                  discoverEnabled: newValue,
                  // If disabling discovery, also disable request permission
                  discoverRequestEnabled: newValue ? u.discoverRequestEnabled : false,
                }
              : u
          )
        )
        setSnackbar({ 
          open: true, 
          message: newValue 
            ? t('admin.usersPage.discoverOn', { name: user.name })
            : t('admin.usersPage.discoverOff', { name: user.name }),
          severity: 'success' 
        })
      }
    } finally {
      setUpdating(null)
    }
  }

  const handleToggleDiscoverRequest = async (user: ProviderUser) => {
    if (!user.apertureUserId) return

    setUpdating(user.providerUserId)
    try {
      const newValue = !user.discoverRequestEnabled
      const response = await fetch(`/api/users/${user.apertureUserId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ discoverRequestEnabled: newValue }),
      })

      if (response.ok) {
        setProviderUsers((prev) =>
          prev.map((u) =>
            u.providerUserId === user.providerUserId
              ? { ...u, discoverRequestEnabled: newValue }
              : u
          )
        )
        setSnackbar({ 
          open: true, 
          message: newValue 
            ? t('admin.usersPage.discoverReqOn', { name: user.name })
            : t('admin.usersPage.discoverReqOff', { name: user.name }),
          severity: 'success' 
        })
      }
    } finally {
      setUpdating(null)
    }
  }

  const handleToggleCollections = async (user: ProviderUser) => {
    if (!user.apertureUserId) return

    setUpdating(user.providerUserId)
    try {
      const newValue = !user.collectionsEnabled
      const response = await fetch(`/api/users/${user.apertureUserId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ collectionsEnabled: newValue }),
      })

      if (response.ok) {
        setProviderUsers((prev) =>
          prev.map((u) =>
            u.providerUserId === user.providerUserId
              ? { ...u, collectionsEnabled: newValue }
              : u
          )
        )
        setSnackbar({
          open: true,
          message: newValue
            ? t('admin.usersPage.collectionsOn', { name: user.name })
            : t('admin.usersPage.collectionsOff', { name: user.name }),
          severity: 'success',
        })
      }
    } finally {
      setUpdating(null)
    }
  }

  const handleToggleEmailNotifications = async (user: ProviderUser) => {
    if (!user.apertureUserId) return

    setUpdating(user.providerUserId)
    try {
      const newValue = !user.emailNotificationsAllowed
      const response = await fetch(`/api/users/${user.apertureUserId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ emailNotificationsAllowed: newValue }),
      })

      if (response.ok) {
        setProviderUsers((prev) =>
          prev.map((u) =>
            u.providerUserId === user.providerUserId
              ? { ...u, emailNotificationsAllowed: newValue }
              : u
          )
        )
        setSnackbar({
          open: true,
          message: newValue
            ? t('admin.usersPage.emailOn', { name: user.name })
            : t('admin.usersPage.emailOff', { name: user.name }),
          severity: 'success',
        })
      }
    } finally {
      setUpdating(null)
    }
  }

  const handleSortFieldChange = (event: SelectChangeEvent) => {
    const field = event.target.value as SortField
    setSortField(field)
    // A fresh field picks the direction that reads naturally on first click —
    // most-recent-first for dates, A-Z for email — rather than always resetting
    // to ascending, which would show "never logged in" users before anyone else.
    if (field === 'lastLogin' || field === 'lastActivity') {
      setSortDirection('desc')
    } else if (field === 'email') {
      setSortDirection('asc')
    }
  }

  /**
   * Step into this user's view of the app.
   *
   * Succeeding ends in a full page load, so nothing here resets on success —
   * only a failure returns to this component, and that is the only case the
   * snackbar has to describe.
   */
  const handleViewAsUser = async (user: ProviderUser) => {
    handleMenuClose()
    if (!user.apertureUserId) return

    try {
      await impersonate(user.apertureUserId)
    } catch (err) {
      setSnackbar({
        open: true,
        message: t('admin.usersPage.viewAsError', {
          name: user.name,
          error: err instanceof Error ? err.message : t('admin.usersPage.jobFailed'),
        }),
        severity: 'error',
      })
    }
  }

  /**
   * Why "view as" is unavailable for this row, or null when it is available.
   *
   * Returned as a reason rather than a boolean because a control that is
   * simply greyed out with no explanation is the thing an admin files a ticket
   * about — the same reasoning as the admin nav's dimmed-with-a-reason gates.
   */
  const viewAsBlockedReason = (user: ProviderUser | null): string | null => {
    if (!user?.apertureUserId) return t('admin.usersPage.viewAsNotImported')
    if (!user.isEnabled) return t('admin.usersPage.viewAsDisabled')
    if (user.apertureUserId === currentUser?.id) return t('admin.usersPage.viewAsSelf')
    // Assumptions do not stack: there has to be exactly one account to return
    // to, so the server refuses a second one and the menu says so first.
    if (impersonation) return t('admin.usersPage.viewAsAlreadyActive')
    return null
  }

  /**
   * One definition, rendered into both action menus — the mobile card list and
   * the desktop table each own a copy of the menu, and a second hand-written
   * item is a second thing to keep in step.
   */
  const renderViewAsMenuItem = () => {
    const blocked = viewAsBlockedReason(menuUser)
    return (
      <MenuItem
        onClick={() => menuUser && handleViewAsUser(menuUser)}
        disabled={blocked !== null}
      >
        <ListItemIcon>
          <VisibilityIcon fontSize="small" />
        </ListItemIcon>
        <ListItemText
          primary={t('admin.usersPage.menuViewAs')}
          secondary={blocked ?? t('admin.usersPage.menuViewAsSecondary')}
        />
      </MenuItem>
    )
  }

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>, user: ProviderUser) => {
    setMenuAnchor(event.currentTarget)
    setMenuUser(user)
  }

  const handleMenuClose = () => {
    setMenuAnchor(null)
    setMenuUser(null)
  }

  const runUserJob = async (userId: string, jobType: 'sync-history' | 'generate-recommendations' | 'update-strm' | 'run-all', userName: string) => {
    handleMenuClose()
    
    // Add this user to running jobs
    setRunningJobs(prev => new Map(prev).set(userId, jobType))
    
    try {
      const response = await fetch(`/api/users/${userId}/${jobType}`, {
        method: 'POST',
        credentials: 'include',
      })

      if (response.ok) {
        const jobNames: Record<string, string> = {
          'sync-history': t('admin.usersPage.jobSyncHistory'),
          'generate-recommendations': t('admin.usersPage.jobGenRecs'),
          'update-strm': t('admin.usersPage.jobStrm'),
          'run-all': t('admin.usersPage.jobRunAll'),
        }
        setSnackbar({
          open: true,
          message: t('admin.usersPage.jobSnackOk', { name: userName, result: jobNames[jobType] }),
          severity: 'success',
        })
      } else {
        const errData = await response.json().catch(() => ({}))
        setSnackbar({
          open: true,
          message: t('admin.usersPage.jobSnackErr', {
            name: userName,
            error: errData.error || t('admin.usersPage.jobFailed'),
          }),
          severity: 'error',
        })
      }
    } catch {
      setSnackbar({ open: true, message: t('admin.usersPage.jobSnackRunErr', { name: userName }), severity: 'error' })
    } finally {
      // Remove this user from running jobs
      setRunningJobs(prev => {
        const next = new Map(prev)
        next.delete(userId)
        return next
      })
    }
  }

  if (loading) {
    return (
      <Box>
        <Skeleton variant="rectangular" height={400} />
      </Box>
    )
  }

  if (error) {
    return (
      <Box>
        <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>
        <Button variant="outlined" onClick={fetchProviderUsers} startIcon={<RefreshIcon />}>
          {t('admin.usersPage.retry')}
        </Button>
      </Box>
    )
  }

  // Default sort: imported & enabled first, then imported, then non-imported —
  // unchanged from before the sort control existed, and still what loads by
  // default. Picking a field below replaces this with a straight sort on that
  // field (nulls last), name as the tiebreaker.
  const sortFieldGetters: Record<'email' | 'lastLogin' | 'lastActivity', (u: ProviderUser) => string | null | undefined> = {
    email: (u) => u.email,
    lastLogin: (u) => u.lastLoginAt,
    lastActivity: (u) => u.lastActivityDate,
  }
  const sortedUsers = [...providerUsers].sort((a, b) => {
    if (sortField === 'default') {
      if (a.isEnabled && !b.isEnabled) return -1
      if (!a.isEnabled && b.isEnabled) return 1
      if (a.isImported && !b.isImported) return -1
      if (!a.isImported && b.isImported) return 1
      return a.name.localeCompare(b.name)
    }
    const getField = sortFieldGetters[sortField]
    const cmp = compareNullable(getField(a), getField(b), sortDirection)
    return cmp !== 0 ? cmp : a.name.localeCompare(b.name)
  })

  const isJobRunning = (userId: string) => runningJobs.has(userId)
  const providerLabel = provider.charAt(0).toUpperCase() + provider.slice(1)

  const sortControl = (
    <Stack direction="row" alignItems="center" spacing={0.5} flexWrap="wrap">
      <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
        {t('admin.usersPage.sortByLabel')}
      </Typography>
      <Select size="small" value={sortField} onChange={handleSortFieldChange} sx={{ minWidth: 160 }}>
        <MenuItem value="default">{t('admin.usersPage.sortDefault')}</MenuItem>
        <MenuItem value="email">{t('admin.usersPage.sortEmail')}</MenuItem>
        <MenuItem value="lastLogin">{t('admin.usersPage.sortLastLogin')}</MenuItem>
        <MenuItem value="lastActivity">{t('admin.usersPage.sortLastActivity', { provider: providerLabel })}</MenuItem>
      </Select>
      {sortField !== 'default' && (
        <Tooltip title={sortDirection === 'asc' ? t('admin.usersPage.sortAscending') : t('admin.usersPage.sortDescending')}>
          <IconButton size="small" onClick={() => setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'))}>
            {sortDirection === 'asc' ? <ArrowUpwardIcon fontSize="small" /> : <ArrowDownwardIcon fontSize="small" />}
          </IconButton>
        </Tooltip>
      )}
    </Stack>
  )

  // Mobile card view
  if (isMobile) {
    return (
      <Box>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3, flexWrap: 'wrap', gap: 1 }}>
          <Typography variant="body2" color="text.secondary">
            {t('admin.usersPage.subtitleMobile', { provider: providerLabel })}
          </Typography>
          <Stack direction="row" spacing={1}>
            <Tooltip title={t('admin.usersPage.syncTooltipShort')}>
              <Button
                variant="contained"
                size="small"
                onClick={handleSyncUsers}
                disabled={syncingUsers}
                startIcon={syncingUsers ? <CircularProgress size={16} color="inherit" /> : <SyncIcon />}
              >
                {syncingUsers ? t('admin.usersPage.syncing') : t('admin.usersPage.syncUsers')}
              </Button>
            </Tooltip>
            <Button
              variant="outlined"
              size="small"
              onClick={fetchProviderUsers}
              startIcon={<RefreshIcon />}
            >
              {t('admin.usersPage.refresh')}
            </Button>
          </Stack>
        </Box>

        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>{sortControl}</Box>

        <Stack spacing={2}>
          {sortedUsers.length === 0 ? (
            <Paper sx={{ p: 4, textAlign: 'center', backgroundColor: 'background.paper', borderRadius: 2 }}>
              <Typography variant="body2" color="text.secondary">
                {t('admin.usersPage.noUsers', { provider: providerLabel })}
              </Typography>
            </Paper>
          ) : (
            sortedUsers.map((user) => (
              <Card
                key={user.providerUserId}
                sx={{
                  backgroundColor: user.isEnabled ? 'rgba(82, 181, 75, 0.05)' : 'background.paper',
                  borderRadius: 2,
                  opacity: user.isDisabled ? 0.5 : 1,
                }}
              >
                <CardContent>
                  {/* User header with name and status */}
                  <Stack direction="row" alignItems="flex-start" justifyContent="space-between" mb={2}>
                    <Stack direction="row" spacing={1.5} alignItems="center" flex={1}>
                      <Avatar
                        sx={{
                          width: 40,
                          height: 40,
                          bgcolor: 'primary.main',
                          fontSize: '1rem',
                        }}
                      >
                        {user.name[0].toUpperCase()}
                      </Avatar>
                      <Box flex={1}>
                        <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap">
                          <Typography variant="subtitle2" fontWeight={600}>
                            {user.name}
                          </Typography>
                          {user.isAdmin && (
                            <Chip label={t('admin.usersPage.adminChip')} size="small" color="primary" sx={{ height: 20 }} />
                          )}
                        </Stack>
                        <Typography variant="caption" color="text.secondary" component="div">
                          {user.isDisabled ? (
                            <Chip 
                              icon={<BlockIcon sx={{ fontSize: 14 }} />}
                              label={t('admin.usersPage.providerDisabled', { provider: providerLabel })}
                              size="small" 
                              color="error" 
                              variant="outlined"
                              sx={{ height: 20, mt: 0.5, fontSize: '0.7rem' }}
                            />
                          ) : (
                            <Chip 
                              label={t('admin.usersPage.providerActive', { provider: providerLabel })}
                              size="small" 
                              color="success" 
                              variant="outlined"
                              sx={{ height: 20, mt: 0.5, fontSize: '0.7rem' }}
                            />
                          )}
                        </Typography>
                      </Box>
                    </Stack>
                    {user.isImported && (user.moviesEnabled || user.seriesEnabled) ? (
                      <Tooltip title={t('admin.usersPage.recsEnabledTooltip')}>
                        <CheckCircleIcon color="success" />
                      </Tooltip>
                    ) : null}
                  </Stack>

                  {/* Email + last login / last streaming activity */}
                  {(user.isImported || user.lastActivityDate) && (
                    <Stack spacing={0.25} mb={1.5}>
                      {user.isImported && user.email && (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          <EmailIcon sx={{ fontSize: 14 }} color="action" />
                          <Typography variant="caption" color="text.secondary">
                            {user.email}
                          </Typography>
                        </Box>
                      )}
                      {user.isImported && (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          <LoginIcon sx={{ fontSize: 14 }} color="action" />
                          <Typography variant="caption" color="text.secondary">
                            {t('admin.usersPage.lastWebLoginLabel')}{' '}
                            {formatTimestamp(user.lastLoginAt) || t('admin.usersPage.never')}
                          </Typography>
                        </Box>
                      )}
                      {user.lastActivityDate && (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          <PlayArrowIcon sx={{ fontSize: 14 }} color="action" />
                          <Typography variant="caption" color="text.secondary">
                            {t('admin.usersPage.lastStreamingLabel', { provider: providerLabel })}{' '}
                            {formatTimestamp(user.lastActivityDate)}
                          </Typography>
                        </Box>
                      )}
                    </Stack>
                  )}

                  {/* Import button for non-imported users */}
                  {!user.isImported && (
                    <Button
                      fullWidth
                      variant="contained"
                      color="primary"
                      disabled={importing === user.providerUserId || user.isDisabled}
                      onClick={() => handleImportUser(user.providerUserId, true)}
                      startIcon={
                        importing === user.providerUserId ? (
                          <CircularProgress size={16} color="inherit" />
                        ) : (
                          <PersonAddIcon />
                        )
                      }
                      sx={{ mb: 2 }}
                    >
                      {t('admin.usersPage.enableAiRecs')}
                    </Button>
                  )}

                  {/* Settings for imported users */}
                  {user.isImported && (
                    <>
                      {/* Media toggles in a compact row */}
                      <Stack direction="row" alignItems="center" spacing={2} mb={1.5}>
                        <Stack direction="row" alignItems="center" spacing={1}>
                          <MovieIcon fontSize="small" color="action" />
                          <Typography variant="body2" sx={{ fontSize: '0.875rem' }}>{t('admin.usersPage.movies')}</Typography>
                          <Switch
                            checked={user.moviesEnabled}
                            onChange={() => handleToggleMovies(user)}
                            disabled={updating === user.providerUserId || user.isDisabled}
                            color="primary"
                            size="small"
                          />
                        </Stack>
                        <Stack direction="row" alignItems="center" spacing={1}>
                          <TvIcon fontSize="small" color="action" />
                          <Typography variant="body2" sx={{ fontSize: '0.875rem' }}>{t('admin.usersPage.series')}</Typography>
                          <Switch
                            checked={user.seriesEnabled}
                            onChange={() => handleToggleSeries(user)}
                            disabled={updating === user.providerUserId || user.isDisabled}
                            color="primary"
                            size="small"
                          />
                        </Stack>
                      </Stack>

                      {/* Discovery toggles in a compact row */}
                      <Stack direction="row" alignItems="center" spacing={2} mb={1.5}>
                        <Stack direction="row" alignItems="center" spacing={1}>
                          <HubOutlinedIcon fontSize="small" color="action" />
                          <Typography variant="body2" sx={{ fontSize: '0.875rem' }}>{t('admin.usersPage.discover')}</Typography>
                          <Switch
                            checked={user.discoverEnabled}
                            onChange={() => handleToggleDiscover(user)}
                            disabled={updating === user.providerUserId || user.isDisabled}
                            color="primary"
                            size="small"
                          />
                        </Stack>
                        <Stack direction="row" alignItems="center" spacing={1}>
                          <HubOutlinedIcon fontSize="small" color="action" />
                          <Typography variant="body2" sx={{ fontSize: '0.875rem' }}>{t('admin.usersPage.request')}</Typography>
                          <Switch
                            checked={user.discoverRequestEnabled}
                            onChange={() => handleToggleDiscoverRequest(user)}
                            disabled={updating === user.providerUserId || user.isDisabled || !user.discoverEnabled}
                            color="primary"
                            size="small"
                          />
                        </Stack>
                      </Stack>

                      {/* Collections permission toggle */}
                      <Stack direction="row" alignItems="center" spacing={1} mb={1.5}>
                        <CollectionsBookmarkIcon fontSize="small" color="action" />
                        <Typography variant="body2" sx={{ fontSize: '0.875rem' }}>{t('admin.usersPage.collections')}</Typography>
                        <Switch
                          checked={user.collectionsEnabled}
                          onChange={() => handleToggleCollections(user)}
                          disabled={updating === user.providerUserId || user.isDisabled}
                          color="primary"
                          size="small"
                        />
                      </Stack>

                      {/* Email notifications permission toggle */}
                      <Stack direction="row" alignItems="center" spacing={1} mb={1.5}>
                        <Tooltip title={t('admin.usersPage.emailColTooltip')}>
                          <EmailIcon fontSize="small" color="action" />
                        </Tooltip>
                        <Typography variant="body2" sx={{ fontSize: '0.875rem' }}>{t('admin.usersPage.colEmail')}</Typography>
                        <Switch
                          checked={user.emailNotificationsAllowed}
                          onChange={() => handleToggleEmailNotifications(user)}
                          disabled={updating === user.providerUserId || user.isDisabled}
                          color="primary"
                          size="small"
                        />
                      </Stack>

                      {/* AI Override toggle (if enabled globally) */}
                      {globalAiConfig?.userOverrideAllowed && (
                        <Stack direction="row" alignItems="center" spacing={1} mb={2}>
                          <AutoAwesomeIcon fontSize="small" color="action" />
                          <Typography variant="body2" sx={{ fontSize: '0.875rem' }}>{t('admin.usersPage.aiOverride')}</Typography>
                          <Switch
                            checked={user.aiOverrideAllowed}
                            onChange={() => handleToggleAiOverride(user)}
                            disabled={updating === user.providerUserId || user.isDisabled}
                            color="secondary"
                            size="small"
                          />
                        </Stack>
                      )}

                      {/* Action buttons */}
                      <Stack direction="row" spacing={1} justifyContent="flex-end">
                        {isJobRunning(user.apertureUserId!) && (
                          <CircularProgress size={20} sx={{ mr: 1 }} />
                        )}
                        <Tooltip title={t('admin.usersPage.moreSettingsTooltip')}>
                          <IconButton
                            size="small"
                            onClick={() => navigate(`/admin/users/${user.apertureUserId}?tab=settings`)}
                            sx={{
                              bgcolor: 'action.hover',
                              '&:hover': { bgcolor: 'action.selected' },
                            }}
                          >
                            <SettingsIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        {user.isEnabled && (
                          <Tooltip title={t('admin.usersPage.userActionsTooltip')}>
                            <IconButton
                              size="small"
                              onClick={(e) => handleMenuOpen(e, user)}
                              disabled={isJobRunning(user.apertureUserId!)}
                              sx={{
                                bgcolor: 'action.hover',
                                '&:hover': { bgcolor: 'action.selected' },
                              }}
                            >
                              <MoreVertIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        )}
                      </Stack>
                    </>
                  )}
                </CardContent>
              </Card>
            ))
          )}
        </Stack>

        {/* Actions Menu */}
        <Menu
          anchorEl={menuAnchor}
          open={Boolean(menuAnchor)}
          onClose={handleMenuClose}
          anchorOrigin={{
            vertical: 'bottom',
            horizontal: theme.direction === 'rtl' ? 'left' : 'right',
          }}
          transformOrigin={{
            vertical: 'top',
            horizontal: theme.direction === 'rtl' ? 'left' : 'right',
          }}
        >
          <MenuItem 
            onClick={() => menuUser?.apertureUserId && runUserJob(menuUser.apertureUserId, 'run-all', menuUser.name)}
            sx={{ color: 'primary.main' }}
          >
            <ListItemIcon>
              <PlayArrowIcon fontSize="small" color="primary" />
            </ListItemIcon>
            <ListItemText
              primary={t('admin.usersPage.menuRunAll')}
              secondary={t('admin.usersPage.menuRunAllSecondary')}
            />
          </MenuItem>
          <Divider />
          <MenuItem onClick={() => menuUser?.apertureUserId && runUserJob(menuUser.apertureUserId, 'sync-history', menuUser.name)}>
            <ListItemIcon>
              <HistoryIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText primary={t('admin.usersPage.menuSyncHistory')} />
          </MenuItem>
          <MenuItem onClick={() => menuUser?.apertureUserId && runUserJob(menuUser.apertureUserId, 'generate-recommendations', menuUser.name)}>
            <ListItemIcon>
              <RecommendIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText primary={t('admin.usersPage.menuGenRecs')} />
          </MenuItem>
          <MenuItem onClick={() => menuUser?.apertureUserId && runUserJob(menuUser.apertureUserId, 'update-strm', menuUser.name)}>
            <ListItemIcon>
              <FolderIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText primary={t('admin.usersPage.menuUpdateStrm')} />
          </MenuItem>
          <Divider />
          {renderViewAsMenuItem()}
        </Menu>

        {/* Snackbar for notifications */}
        <Snackbar
          open={snackbar.open}
          autoHideDuration={4000}
          onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        >
          <Alert 
            onClose={() => setSnackbar((s) => ({ ...s, open: false }))} 
            severity={snackbar.severity}
            variant="filled"
          >
            {snackbar.message}
          </Alert>
        </Snackbar>
      </Box>
    )
  }

  // Desktop table view
  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3, flexWrap: 'wrap', gap: 1 }}>
        <Typography variant="body1" color="text.secondary">
          {t('admin.usersPage.subtitleDesktop', { provider: providerLabel })}
        </Typography>
        <Stack direction="row" spacing={1}>
          <Tooltip title={t('admin.usersPage.syncTooltip')}>
            <Button
              variant="contained"
              size="small"
              onClick={handleSyncUsers}
              disabled={syncingUsers}
              startIcon={syncingUsers ? <CircularProgress size={16} color="inherit" /> : <SyncIcon />}
            >
              {syncingUsers ? t('admin.usersPage.syncing') : t('admin.usersPage.syncUsers')}
            </Button>
          </Tooltip>
          <Button
            variant="outlined"
            size="small"
            onClick={fetchProviderUsers}
            startIcon={<RefreshIcon />}
          >
            {t('admin.usersPage.refresh')}
          </Button>
        </Stack>
      </Box>

      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>{sortControl}</Box>

      <TableContainer
        component={Paper}
        sx={{ backgroundColor: 'background.paper', borderRadius: 2 }}
      >
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>{t('admin.usersPage.colUser')}</TableCell>
              <TableCell>{t('admin.usersPage.colStatus')}</TableCell>
              <TableCell align="center">{t('admin.usersPage.colImported')}</TableCell>
              <TableCell align="center">
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5 }}>
                  <MovieIcon fontSize="small" />
                  {t('admin.usersPage.colMovies')}
                </Box>
              </TableCell>
              <TableCell align="center">
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5 }}>
                  <TvIcon fontSize="small" />
                  {t('admin.usersPage.colSeries')}
                </Box>
              </TableCell>
              <TableCell align="center">
                <Tooltip title={t('admin.usersPage.discoverColTooltip')}>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5 }}>
                    <HubOutlinedIcon fontSize="small" />
                    {t('admin.usersPage.colDiscover')}
                  </Box>
                </Tooltip>
              </TableCell>
              <TableCell align="center">
                <Tooltip title={t('admin.usersPage.requestColTooltip')}>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5 }}>
                    <HubOutlinedIcon fontSize="small" />
                    {t('admin.usersPage.colRequest')}
                  </Box>
                </Tooltip>
              </TableCell>
              <TableCell align="center">
                <Tooltip title={t('admin.usersPage.collectionsColTooltip')}>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5 }}>
                    <CollectionsBookmarkIcon fontSize="small" />
                    {t('admin.usersPage.colCollections')}
                  </Box>
                </Tooltip>
              </TableCell>
              <TableCell align="center">
                <Tooltip title={t('admin.usersPage.emailColTooltip')}>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5 }}>
                    <EmailIcon fontSize="small" />
                    {t('admin.usersPage.colEmail')}
                  </Box>
                </Tooltip>
              </TableCell>
              {globalAiConfig?.userOverrideAllowed && (
                <TableCell align="center">
                  <Tooltip title={t('admin.usersPage.aiOverrideColTooltip')}>
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5 }}>
                      <AutoAwesomeIcon fontSize="small" />
                      {t('admin.usersPage.colAiOverride')}
                    </Box>
                  </Tooltip>
                </TableCell>
              )}
              <TableCell align="right">{t('admin.usersPage.colActions')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {sortedUsers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={globalAiConfig?.userOverrideAllowed ? 11 : 10} align="center">
                  <Typography variant="body2" color="text.secondary" py={4}>
                    {t('admin.usersPage.noUsers', { provider: providerLabel })}
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              sortedUsers.map((user) => (
                <TableRow 
                  key={user.providerUserId} 
                  hover
                  sx={{ 
                    opacity: user.isDisabled ? 0.5 : 1,
                    backgroundColor: user.isEnabled ? 'rgba(82, 181, 75, 0.05)' : 'inherit'
                  }}
                >
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Typography variant="body2" fontWeight={500}>
                        {user.name}
                      </Typography>
                      {user.isAdmin && (
                        <Chip label={t('admin.usersPage.adminChip')} size="small" color="primary" />
                      )}
                    </Box>
                    <Stack spacing={0.25} sx={{ mt: (user.isImported || user.lastActivityDate) ? 0.5 : 0 }}>
                      {user.isImported && user.email && (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          <EmailIcon sx={{ fontSize: 14 }} color="action" />
                          <Typography variant="caption" color="text.secondary">
                            {user.email}
                          </Typography>
                        </Box>
                      )}
                      {user.isImported && (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          <LoginIcon sx={{ fontSize: 14 }} color="action" />
                          <Typography variant="caption" color="text.secondary">
                            {t('admin.usersPage.lastWebLoginLabel')}{' '}
                            {formatTimestamp(user.lastLoginAt) || t('admin.usersPage.never')}
                          </Typography>
                        </Box>
                      )}
                      {user.lastActivityDate && (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          <PlayArrowIcon sx={{ fontSize: 14 }} color="action" />
                          <Typography variant="caption" color="text.secondary">
                            {t('admin.usersPage.lastStreamingLabel', { provider: providerLabel })}{' '}
                            {formatTimestamp(user.lastActivityDate)}
                          </Typography>
                        </Box>
                      )}
                    </Stack>
                  </TableCell>
                  <TableCell>
                    {user.isDisabled ? (
                      <Chip 
                        icon={<BlockIcon />}
                        label={t('admin.usersPage.disabledOnServer')} 
                        size="small" 
                        color="error" 
                        variant="outlined"
                      />
                    ) : (
                      <Chip 
                        label={t('admin.usersPage.activeStatus')} 
                        size="small" 
                        color="success" 
                        variant="outlined"
                      />
                    )}
                  </TableCell>
                  <TableCell align="center">
                    {user.isImported ? (
                      <Tooltip title={t('admin.usersPage.importedTooltip')}>
                        <CheckCircleIcon color="success" />
                      </Tooltip>
                    ) : (
                      <Tooltip title={t('admin.usersPage.notImportedTooltip')}>
                        <Typography variant="body2" color="text.secondary">—</Typography>
                      </Tooltip>
                    )}
                  </TableCell>
                  <TableCell align="center">
                    {user.isImported ? (
                      <Switch
                        checked={user.moviesEnabled}
                        onChange={() => handleToggleMovies(user)}
                        disabled={updating === user.providerUserId || user.isDisabled}
                        color="primary"
                        size="small"
                      />
                    ) : (
                      <Typography variant="body2" color="text.secondary">—</Typography>
                    )}
                  </TableCell>
                  <TableCell align="center">
                    {user.isImported ? (
                      <Switch
                        checked={user.seriesEnabled}
                        onChange={() => handleToggleSeries(user)}
                        disabled={updating === user.providerUserId || user.isDisabled}
                        color="primary"
                        size="small"
                      />
                    ) : (
                      <Typography variant="body2" color="text.secondary">—</Typography>
                    )}
                  </TableCell>
                  <TableCell align="center">
                    {user.isImported ? (
                      <Tooltip title={user.discoverEnabled ? t('admin.usersPage.discoverToggleOn') : t('admin.usersPage.discoverToggleOff')}>
                        <Switch
                          checked={user.discoverEnabled}
                          onChange={() => handleToggleDiscover(user)}
                          disabled={updating === user.providerUserId || user.isDisabled}
                          color="primary"
                          size="small"
                        />
                      </Tooltip>
                    ) : (
                      <Typography variant="body2" color="text.secondary">—</Typography>
                    )}
                  </TableCell>
                  <TableCell align="center">
                    {user.isImported ? (
                      <Tooltip title={user.discoverRequestEnabled ? t('admin.usersPage.requestToggleOn') : t('admin.usersPage.requestToggleOff')}>
                        <Switch
                          checked={user.discoverRequestEnabled}
                          onChange={() => handleToggleDiscoverRequest(user)}
                          disabled={updating === user.providerUserId || user.isDisabled || !user.discoverEnabled}
                          color="primary"
                          size="small"
                        />
                      </Tooltip>
                    ) : (
                      <Typography variant="body2" color="text.secondary">—</Typography>
                    )}
                  </TableCell>
                  <TableCell align="center">
                    {user.isImported ? (
                      <Tooltip title={user.collectionsEnabled ? t('admin.usersPage.collectionsToggleOn') : t('admin.usersPage.collectionsToggleOff')}>
                        <Switch
                          checked={user.collectionsEnabled}
                          onChange={() => handleToggleCollections(user)}
                          disabled={updating === user.providerUserId || user.isDisabled}
                          color="primary"
                          size="small"
                        />
                      </Tooltip>
                    ) : (
                      <Typography variant="body2" color="text.secondary">—</Typography>
                    )}
                  </TableCell>
                  <TableCell align="center">
                    {user.isImported ? (
                      <Tooltip title={user.emailNotificationsAllowed ? t('admin.usersPage.emailToggleOn') : t('admin.usersPage.emailToggleOff')}>
                        <Switch
                          checked={user.emailNotificationsAllowed}
                          onChange={() => handleToggleEmailNotifications(user)}
                          disabled={updating === user.providerUserId || user.isDisabled}
                          color="primary"
                          size="small"
                        />
                      </Tooltip>
                    ) : (
                      <Typography variant="body2" color="text.secondary">—</Typography>
                    )}
                  </TableCell>
                  {globalAiConfig?.userOverrideAllowed && (
                    <TableCell align="center">
                      {user.isImported ? (
                        <Switch
                          checked={user.aiOverrideAllowed}
                          onChange={() => handleToggleAiOverride(user)}
                          disabled={updating === user.providerUserId || user.isDisabled}
                          color="secondary"
                          size="small"
                        />
                      ) : (
                        <Typography variant="body2" color="text.secondary">—</Typography>
                      )}
                    </TableCell>
                  )}
                  <TableCell align="right">
                    <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end', alignItems: 'center' }}>
                      {!user.isImported && (
                        <Tooltip title={t('admin.usersPage.enableImportTooltip')}>
                          <span>
                            <Button
                              size="small"
                              variant="contained"
                              color="primary"
                              disabled={importing === user.providerUserId || user.isDisabled}
                              onClick={() => handleImportUser(user.providerUserId, true)}
                              startIcon={
                                importing === user.providerUserId ? (
                                  <CircularProgress size={16} color="inherit" />
                                ) : (
                                  <PersonAddIcon />
                                )
                              }
                            >
                              {t('admin.usersPage.enable')}
                            </Button>
                          </span>
                        </Tooltip>
                      )}
                      {user.isImported && user.apertureUserId && (
                        <>
                          {isJobRunning(user.apertureUserId) && (
                            <CircularProgress size={20} sx={{ mr: 1 }} />
                          )}
                          <Tooltip title={t('admin.usersPage.moreSettingsTooltip')}>
                            <IconButton
                              size="small"
                              onClick={() => navigate(`/admin/users/${user.apertureUserId}?tab=settings`)}
                            >
                              <SettingsIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          {user.isEnabled && (
                            <Tooltip title={t('admin.usersPage.userActionsTooltip')}>
                              <IconButton
                                size="small"
                                onClick={(e) => handleMenuOpen(e, user)}
                                disabled={isJobRunning(user.apertureUserId)}
                              >
                                <MoreVertIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          )}
                        </>
                      )}
                    </Box>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Actions Menu */}
      <Menu
        anchorEl={menuAnchor}
        open={Boolean(menuAnchor)}
        onClose={handleMenuClose}
        anchorOrigin={{
          vertical: 'bottom',
          horizontal: theme.direction === 'rtl' ? 'left' : 'right',
        }}
        transformOrigin={{
          vertical: 'top',
          horizontal: theme.direction === 'rtl' ? 'left' : 'right',
        }}
      >
        <MenuItem 
          onClick={() => menuUser?.apertureUserId && runUserJob(menuUser.apertureUserId, 'run-all', menuUser.name)}
          sx={{ color: 'primary.main' }}
        >
          <ListItemIcon>
            <PlayArrowIcon fontSize="small" color="primary" />
          </ListItemIcon>
          <ListItemText
            primary={t('admin.usersPage.menuRunAll')}
            secondary={t('admin.usersPage.menuRunAllSecondary')}
          />
        </MenuItem>
        <Divider />
        <MenuItem onClick={() => menuUser?.apertureUserId && runUserJob(menuUser.apertureUserId, 'sync-history', menuUser.name)}>
          <ListItemIcon>
            <HistoryIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primary={t('admin.usersPage.menuSyncHistory')} />
        </MenuItem>
        <MenuItem onClick={() => menuUser?.apertureUserId && runUserJob(menuUser.apertureUserId, 'generate-recommendations', menuUser.name)}>
          <ListItemIcon>
            <RecommendIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primary={t('admin.usersPage.menuGenRecs')} />
        </MenuItem>
        <MenuItem onClick={() => menuUser?.apertureUserId && runUserJob(menuUser.apertureUserId, 'update-strm', menuUser.name)}>
          <ListItemIcon>
            <FolderIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primary={t('admin.usersPage.menuUpdateStrm')} />
        </MenuItem>
        <Divider />
        {renderViewAsMenuItem()}
      </Menu>

      {/* Snackbar for notifications */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert 
          onClose={() => setSnackbar((s) => ({ ...s, open: false }))} 
          severity={snackbar.severity}
          variant="filled"
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  )
}
