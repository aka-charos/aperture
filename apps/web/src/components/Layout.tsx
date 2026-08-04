import React, { useCallback, useState, useEffect, useRef } from 'react'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import {
  AppBar,
  Box,
  Button,
  Drawer,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Toolbar,
  Typography,
  useTheme,
  useMediaQuery,
  Avatar,
  Menu,
  MenuItem,
  Divider,
  Tooltip,
} from '@mui/material'
import MenuIcon from '@mui/icons-material/Menu'
import HomeIcon from '@mui/icons-material/Home'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome'
import HistoryIcon from '@mui/icons-material/History'
import PlaylistPlayIcon from '@mui/icons-material/PlaylistPlay'
import CollectionsBookmarkIcon from '@mui/icons-material/CollectionsBookmark'
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings'
import LogoutIcon from '@mui/icons-material/Logout'
import PersonIcon from '@mui/icons-material/Person'
import FingerprintIcon from '@mui/icons-material/Fingerprint'
import TuneIcon from '@mui/icons-material/Tune'
import HelpOutlineIcon from '@mui/icons-material/HelpOutline'
import WhatshotIcon from '@mui/icons-material/Whatshot'
import InsightsIcon from '@mui/icons-material/Insights'
import AddToQueueIcon from '@mui/icons-material/AddToQueue'
import HubOutlinedIcon from '@mui/icons-material/HubOutlined'
import ExploreIcon from '@mui/icons-material/Explore'
import VideoLibraryIcon from '@mui/icons-material/VideoLibrary'
import PlaylistAddCheckIcon from '@mui/icons-material/PlaylistAddCheck'
import MenuOpenIcon from '@mui/icons-material/MenuOpen'
import SmartToyIcon from '@mui/icons-material/SmartToy'
import FactCheckIcon from '@mui/icons-material/FactCheck'
import { useAuth } from '@/hooks/useAuth'
import { useAssistantDock } from '@/hooks/useAssistantDock'
import { WelcomeModal } from './WelcomeModal'
import { useWelcomeModal } from './useWelcomeModal'
import { ExplorationConfigModal } from './ExplorationConfigModal'
import { RunningJobsWidget } from './RunningJobsWidget'
import { GlobalSearch } from './GlobalSearch'
import { AppBarPageHeading } from './PageHeading'
import { PageHeaderProvider } from '@/hooks/PageHeaderProvider'
import { USER_SETTINGS_TAB_KEYS } from '@/pages/UserSettings/tabHelpers'
import { useAppName, useLogoUrl } from '@/lib/branding'
import { useTranslation } from 'react-i18next'
import { applyEffectiveUiLanguage } from '@/i18n/syncUiLanguage'

const DRAWER_WIDTH = 260
const DRAWER_WIDTH_COLLAPSED = 72
/** Shown in the sidebar footer, and in the rail's tooltip where there's no room for it. */
const APP_VERSION = 'v0.7.8'
/** Pointer intent: brushing past the rail on the way somewhere else must not open it. */
const FLYOUT_OPEN_DELAY_MS = 160
/** Longer than the open delay, so a moment outside the panel doesn't snap it shut. */
const FLYOUT_CLOSE_DELAY_MS = 240

type NavItem = { textKey: string; icon: React.ReactElement; path: string; feature: string | null }

// Base user-facing navigation items (some may be conditionally hidden)
const baseUserMenuItems: NavItem[] = [
  { textKey: 'nav.dashboard', icon: <HomeIcon />, path: '/', feature: null },
  { textKey: 'nav.assistant', icon: <SmartToyIcon />, path: '/assistant', feature: null },
  { textKey: 'nav.recommendations', icon: <AutoAwesomeIcon />, path: '/recommendations', feature: null },
  { textKey: 'nav.showsYouWatch', icon: <AddToQueueIcon />, path: '/watching', feature: 'watching' },
  { textKey: 'nav.topPicks', icon: <WhatshotIcon />, path: '/top-picks', feature: null },
  { textKey: 'nav.playlists', icon: <PlaylistPlayIcon />, path: '/playlists', feature: null },
  { textKey: 'nav.collections', icon: <CollectionsBookmarkIcon />, path: '/collections', feature: 'collections' },
  { textKey: 'nav.explore', icon: <HubOutlinedIcon />, path: '/explore', feature: null },
  { textKey: 'nav.discover', icon: <ExploreIcon />, path: '/discovery', feature: null },
  { textKey: 'nav.myRequests', icon: <PlaylistAddCheckIcon />, path: '/my-requests', feature: null },
  { textKey: 'nav.browse', icon: <VideoLibraryIcon />, path: '/browse', feature: null },
  { textKey: 'nav.watchHistory', icon: <HistoryIcon />, path: '/history', feature: null },
  { textKey: 'nav.watchStats', icon: <InsightsIcon />, path: '/stats', feature: null },
]

// Admin navigation items (shown only to admins)
const adminMenuItems: { textKey: string; icon: React.ReactElement; path: string }[] = [
  { textKey: 'nav.admin', icon: <AdminPanelSettingsIcon />, path: '/admin' },
  { textKey: 'nav.gapAnalysis', icon: <FactCheckIcon />, path: '/admin/gaps' },
]

// The user-settings tabs (see UserSettings/tabHelpers), surfaced directly in
// the user menu instead of behind an intermediate "Settings" item — one click
// to any section instead of two. Icons and labels mirror UserSettingsPage's
// own tabs so the destination is recognizable on arrival.
const userSettingsMenuItems: {
  textKey: string
  icon: React.ReactElement
  tab: (typeof USER_SETTINGS_TAB_KEYS)[number]
}[] = [
  { textKey: 'userSettings.tabProfile', icon: <PersonIcon fontSize="small" />, tab: 'profile' },
  { textKey: 'userSettings.tabWatcherIdentity', icon: <FingerprintIcon fontSize="small" />, tab: 'watcher' },
  { textKey: 'userSettings.tabAlgorithm', icon: <TuneIcon fontSize="small" />, tab: 'algorithm' },
  { textKey: 'userSettings.tabPreferences', icon: <VideoLibraryIcon fontSize="small" />, tab: 'preferences' },
]

/**
 * The app shell. Wrapped rather than wrapping inline so the provider sits above
 * the bar and the outlet both — the bar reads what the page under it publishes.
 */
export function Layout() {
  return (
    <PageHeaderProvider>
      <AppShell />
    </PageHeaderProvider>
  )
}

function AppShell() {
  const { t, i18n } = useTranslation()
  // Alt text can't go through a translation the way the visible wordmark does.
  const appName = useAppName()
  const logoUrl = useLogoUrl()
  const theme = useTheme()
  const navigate = useNavigate()
  const location = useLocation()
  const isMobile = useMediaQuery(theme.breakpoints.down('md'))
  /**
   * Below this, 260px of navigation against a ~1000px window leaves the content
   * column cramped, so the icon rail is the better opening position. Above it,
   * labelled navigation costs nothing worth having.
   */
  const isWideEnoughForLabels = useMediaQuery(theme.breakpoints.up('lg'))
  /**
   * A touch screen has no hover — there, "hovering" the rail is a tap that
   * should navigate. The flyout is for mice and trackpads only.
   */
  const pointerCanHover = useMediaQuery('(hover: hover) and (pointer: fine)')
  const [mobileOpen, setMobileOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(!isWideEnoughForLabels)
  /** Once the user takes a side, their choice holds at every width. */
  const [hasSidebarPreference, setHasSidebarPreference] = useState(false)
  /** The rail is temporarily showing its labels over the page. */
  const [flyout, setFlyout] = useState(false)
  const flyoutTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null)
  const [watchingEnabled, setWatchingEnabled] = useState(true) // Default to true until we know
  const { user, logout } = useAuth()
  const { open: welcomeOpen, showWelcome, hideWelcome } = useWelcomeModal()
  // Space reserved on the inline-end side for the docked AI assistant;
  // while its resize handle is dragged, transitions are dropped so the
  // content tracks the pointer instead of easing behind it.
  const { dockWidth, dockResizing } = useAssistantDock()

  /**
   * The rail's own width. The AppBar and the page are laid out against this and
   * not against the flyout, which is the point: revealing the labels never
   * moves the content under the pointer.
   */
  const drawerWidth = collapsed ? DRAWER_WIDTH_COLLAPSED : DRAWER_WIDTH
  const showLabels = !collapsed || flyout

  // Filter menu items based on feature flags
  const userMenuItems = baseUserMenuItems.filter(item => {
    if (item.feature === 'watching' && !watchingEnabled) {
      return false
    }
    // Collections are admin-gated per user (like Discover/Request)
    if (item.feature === 'collections' && !(user?.isAdmin || user?.collectionsEnabled)) {
      return false
    }
    return true
  })

  // Fetch user's sidebar preference on mount; align i18n with effective UI language (single request)
  useEffect(() => {
    const fetchPreferences = async () => {
      try {
        const response = await fetch('/api/auth/me/preferences', { credentials: 'include' })
        if (response.ok) {
          const prefs = await response.json()
          // Absent until the user has actually toggled the sidebar, which is
          // what lets the window width decide for everyone else.
          if (prefs.sidebarCollapsed !== undefined) {
            setCollapsed(prefs.sidebarCollapsed)
            setHasSidebarPreference(true)
          }
          if (prefs.effectiveUiLanguage && typeof prefs.effectiveUiLanguage === 'string') {
            await applyEffectiveUiLanguage(prefs.effectiveUiLanguage)
          }
        }
      } catch {
        // Ignore errors, use default
      }
    }
    void fetchPreferences()
  }, [])

  // Fetch watching library config to check if feature is enabled
  useEffect(() => {
    const fetchWatchingConfig = async () => {
      try {
        const response = await fetch('/api/settings/watching', { credentials: 'include' })
        if (response.ok) {
          const config = await response.json()
          setWatchingEnabled(config.enabled ?? true)
        }
      } catch {
        // Ignore errors, default to showing the menu item
      }
    }
    fetchWatchingConfig()
  }, [])

  // Until the user has a preference of their own, the window decides — and
  // keeps deciding, so dragging a window narrow folds the sidebar down with it.
  useEffect(() => {
    if (hasSidebarPreference) return
    setCollapsed(!isWideEnoughForLabels)
  }, [isWideEnoughForLabels, hasSidebarPreference])

  // An expanded sidebar has nothing to fly out, and a pending timer would
  // otherwise open one over it.
  useEffect(() => {
    if (collapsed) return
    if (flyoutTimer.current) clearTimeout(flyoutTimer.current)
    setFlyout(false)
  }, [collapsed])

  useEffect(
    () => () => {
      if (flyoutTimer.current) clearTimeout(flyoutTimer.current)
    },
    []
  )

  const scheduleFlyout = useCallback((next: boolean, delay: number) => {
    if (flyoutTimer.current) clearTimeout(flyoutTimer.current)
    flyoutTimer.current = setTimeout(() => setFlyout(next), delay)
  }, [])

  const handleDrawerToggle = () => {
    setMobileOpen(!mobileOpen)
  }

  const handleCollapseToggle = async () => {
    const newCollapsed = !collapsed
    setCollapsed(newCollapsed)
    setHasSidebarPreference(true)
    setFlyout(false)

    // Persist preference to server
    try {
      await fetch('/api/auth/me/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ sidebarCollapsed: newCollapsed }),
      })
    } catch {
      // Ignore errors, state is already updated locally
    }
  }

  const handleNavClick = (path: string) => {
    navigate(path)
    if (isMobile) {
      setMobileOpen(false)
    }
  }

  // Hovering the rail reveals its labels; tabbing into it does the same without
  // a delay, or a keyboard user would be navigating by icon alone.
  const railRevealProps =
    isMobile || !collapsed
      ? {}
      : {
          ...(pointerCanHover
            ? {
                onMouseEnter: () => scheduleFlyout(true, FLYOUT_OPEN_DELAY_MS),
                onMouseLeave: () => scheduleFlyout(false, FLYOUT_CLOSE_DELAY_MS),
              }
            : {}),
          onFocus: () => scheduleFlyout(true, 0),
          onBlur: (event: React.FocusEvent<HTMLDivElement>) => {
            // Fires on every move between items; only a departure counts.
            if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
            scheduleFlyout(false, 0)
          },
        }

  const handleUserMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget)
  }

  const handleUserMenuClose = () => {
    setAnchorEl(null)
  }

  const handleLogout = async () => {
    handleUserMenuClose()
    await logout()
    navigate('/login')
  }

  // Check if current path matches or starts with the menu item path
  const isPathActive = (itemPath: string) => {
    if (itemPath === '/') {
      return location.pathname === '/'
    }
    return location.pathname === itemPath || location.pathname.startsWith(itemPath + '/')
  }

    /** Admin sidebar: avoid highlighting "Admin" when on Gap Analysis */
  const isAdminPathActive = (itemPath: string) => {
    if (itemPath === '/admin/gaps') {
      return (
        location.pathname === '/admin/gaps' || location.pathname.startsWith('/admin/gaps/')
      )
    }
    if (itemPath === '/admin') {
      if (location.pathname.startsWith('/admin/gaps')) return false
      return location.pathname === '/admin' || location.pathname.startsWith('/admin/')
    }
    return isPathActive(itemPath)
  }

  /**
   * `labels` is not the same question as "is the sidebar collapsed": the rail
   * shows its labels while flying out, and the mobile drawer is an overlay you
   * dismiss, so it always shows them and has nothing to collapse.
   */
  const renderDrawer = ({ labels, collapsible }: { labels: boolean; collapsible: boolean }) => (
    <Box sx={{ overflow: 'auto', mt: 2, display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Logo */}
      <Box
        px={labels ? 3 : 2}
        mb={3}
        sx={{
          display: 'flex',
          justifyContent: labels ? 'flex-start' : 'center',
          cursor: collapsible ? 'pointer' : 'default',
          ...(collapsible && { '&:hover': { opacity: 0.8 } }),
          transition: 'opacity 0.2s',
        }}
        onClick={collapsible ? handleCollapseToggle : undefined}
      >
        {!labels ? (
          <Tooltip title={t('nav.expandSidebar')} placement="right">
            <Box
              component="img"
              src={logoUrl}
              alt={appName}
              sx={{ width: 40, height: 40 }}
            />
          </Tooltip>
        ) : (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Box
              component="img"
              src={logoUrl}
              alt={appName}
              sx={{ width: 40, height: 40 }}
            />
            <Typography
              sx={{
                fontFamily: '"Open Sans", sans-serif',
                fontWeight: 600,
                fontSize: '1.5rem',
                color: 'text.primary',
                letterSpacing: '-0.01em',
              }}
            >
              {t('common.appName')}
            </Typography>
          </Box>
        )}
      </Box>

      {/* User Navigation */}
      <List>
        {userMenuItems.map((item) => (
          <ListItem key={item.path} disablePadding>
            <Tooltip title={labels ? '' : t(item.textKey)} placement="right" arrow>
              <ListItemButton
                selected={isPathActive(item.path)}
                onClick={() => handleNavClick(item.path)}
                sx={{
                  justifyContent: labels ? 'flex-start' : 'center',
                  px: labels ? 3 : 2,
                }}
              >
                <ListItemIcon
                  sx={{
                    color: isPathActive(item.path) ? 'primary.main' : 'text.secondary',
                    minWidth: labels ? 40 : 0,
                    mr: labels ? 1 : 0,
                  }}
                >
                  {item.icon}
                </ListItemIcon>
                {labels && (
                  <ListItemText
                    primary={t(item.textKey)}
                    primaryTypographyProps={{
                      fontWeight: isPathActive(item.path) ? 600 : 400,
                    }}
                  />
                )}
              </ListItemButton>
            </Tooltip>
          </ListItem>
        ))}
      </List>

      {/* Spacer */}
      <Box flex={1} />

      {/* Admin Section (only shown to admins) */}
      {user?.isAdmin && (
        <>
          <Divider sx={{ mx: 2, my: 1 }} />
          <List>
            {adminMenuItems.map((item) => (
              <ListItem key={item.path} disablePadding>
                <Tooltip title={labels ? '' : t(item.textKey)} placement="right" arrow>
                  <ListItemButton
                    selected={isAdminPathActive(item.path)}
                    onClick={() => handleNavClick(item.path)}
                    sx={{
                      justifyContent: labels ? 'flex-start' : 'center',
                      px: labels ? 3 : 2,
                    }}
                  >
                    <ListItemIcon
                      sx={{
                        color: isAdminPathActive(item.path) ? 'primary.main' : 'text.secondary',
                        minWidth: labels ? 40 : 0,
                        mr: labels ? 1 : 0,
                      }}
                    >
                      {item.icon}
                    </ListItemIcon>
                    {labels && (
                      <ListItemText
                        primary={t(item.textKey)}
                        primaryTypographyProps={{
                          fontWeight: isAdminPathActive(item.path) ? 600 : 400,
                        }}
                      />
                    )}
                  </ListItemButton>
                </Tooltip>
              </ListItem>
            ))}
          </List>
        </>
      )}

      {/* Collapse toggle and version at bottom */}
      <Box
        px={labels ? 2 : 1}
        py={1.5}
        sx={{
          borderTop: 1,
          borderColor: 'divider',
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          justifyContent: labels ? 'space-between' : 'center',
        }}
      >
        {collapsible &&
          // Named rather than an icon you have to hover to understand. While
          // the rail is flying out it offers to make that permanent, which is
          // the only thing a click there could sensibly mean.
          (labels ? (
            <Button
              onClick={handleCollapseToggle}
              size="small"
              color="inherit"
              startIcon={
                <MenuOpenIcon
                  fontSize="small"
                  sx={{
                    transform: collapsed ? 'rotate(180deg)' : 'none',
                    transition: 'transform 0.2s',
                  }}
                />
              }
              sx={{
                color: 'text.secondary',
                textTransform: 'none',
                minWidth: 0,
                whiteSpace: 'nowrap',
              }}
            >
              {collapsed ? t('nav.expandSidebar') : t('nav.collapseSidebar')}
            </Button>
          ) : (
            <Tooltip title={`${t('nav.expandSidebar')} · ${APP_VERSION}`} placement="right">
              <IconButton
                onClick={handleCollapseToggle}
                size="small"
                aria-label={t('nav.expandSidebar')}
                sx={{
                  color: 'text.secondary',
                  transform: 'rotate(180deg)',
                  transition: 'transform 0.2s',
                }}
              >
                <MenuOpenIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          ))}
        {/* Keeps the version on the far side when there is no toggle beside it */}
        {!collapsible && <Box />}
        {labels && (
          <Typography
            variant="caption"
            sx={{
              color: 'text.secondary',
              opacity: 0.6,
              fontFamily: 'monospace',
              fontSize: '0.7rem',
            }}
          >
            {APP_VERSION}
          </Typography>
        )}
      </Box>
    </Box>
  )

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      {/* App Bar */}
      <AppBar
        position="fixed"
        sx={{
          width: { md: `calc(100% - ${drawerWidth + dockWidth}px)` },
          ml: { md: `${drawerWidth}px` },
          transition: dockResizing
            ? 'none'
            : theme.transitions.create(['width', 'margin'], {
                easing: theme.transitions.easing.sharp,
                duration: theme.transitions.duration.leavingScreen,
              }),
        }}
        elevation={0}
      >
        <Toolbar>
          {/* Mobile: Hamburger on left */}
          <IconButton
            color="inherit"
            edge="start"
            onClick={handleDrawerToggle}
            sx={{ display: { md: 'none' } }}
          >
            <MenuIcon />
          </IconButton>

          {/* Mobile: Centered logo and name */}
          <Box
            sx={{
              display: { xs: 'flex', md: 'none' },
              alignItems: 'center',
              gap: 1,
              position: 'absolute',
              left: '50%',
              transform: 'translateX(-50%)',
            }}
          >
            <Box
              component="img"
              src={logoUrl}
              alt={appName}
              sx={{ width: 28, height: 28 }}
            />
            <Typography
              sx={{
                fontFamily: '"Open Sans", sans-serif',
                fontWeight: 600,
                fontSize: '1.1rem',
                color: 'text.primary',
                letterSpacing: '-0.01em',
              }}
            >
              {t('common.appName')}
            </Typography>
          </Box>

          {/* The page's own title, at md+. It claims the flex space that used to
              be an empty spacer — the bar was 64px of chrome for three
              right-aligned controls while every page repeated the same words
              below it. */}
          <AppBarPageHeading />
          <Box sx={{ flexGrow: 1 }} />

          {/* Running Jobs Widget (admin only) */}
          <RunningJobsWidget />

          {/* Global Search */}
          <GlobalSearch />

          {/* User menu */}
          {user && (
            <>
              <IconButton onClick={handleUserMenuOpen} size="small">
                <Avatar
                  src={user.avatarUrl || undefined}
                  sx={{
                    width: 36,
                    height: 36,
                    bgcolor: 'primary.main',
                  }}
                >
                  {user.username[0].toUpperCase()}
                </Avatar>
              </IconButton>

              <Menu
                anchorEl={anchorEl}
                open={Boolean(anchorEl)}
                onClose={handleUserMenuClose}
                transformOrigin={{
                  horizontal: theme.direction === 'rtl' ? 'left' : 'right',
                  vertical: 'top',
                }}
                anchorOrigin={{
                  horizontal: theme.direction === 'rtl' ? 'left' : 'right',
                  vertical: 'bottom',
                }}
              >
                <Box px={2} py={1}>
                  <Typography variant="subtitle2" fontWeight={600}>
                    {user.displayName || user.username}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {user.isAdmin ? t('nav.roleLabelAdmin') : t('nav.roleLabelUser')}
                  </Typography>
                </Box>
                <Divider />
                {userSettingsMenuItems.map((item) => (
                  <MenuItem
                    key={item.tab}
                    onClick={() => {
                      handleUserMenuClose()
                      navigate(`/settings?tab=${item.tab}`)
                    }}
                  >
                    <ListItemIcon>{item.icon}</ListItemIcon>
                    {t(item.textKey)}
                  </MenuItem>
                ))}
                <Divider />
                <MenuItem onClick={() => { handleUserMenuClose(); navigate('/history'); }}>
                  <ListItemIcon>
                    <HistoryIcon fontSize="small" />
                  </ListItemIcon>
                  {t('nav.myWatchHistory')}
                </MenuItem>
                <MenuItem onClick={() => { handleUserMenuClose(); showWelcome(); }}>
                  <ListItemIcon>
                    <HelpOutlineIcon fontSize="small" />
                  </ListItemIcon>
                  {t('nav.howItWorks')}
                </MenuItem>
                <Divider />
                <MenuItem onClick={handleLogout}>
                  <ListItemIcon>
                    <LogoutIcon fontSize="small" />
                  </ListItemIcon>
                  {t('nav.logout')}
                </MenuItem>
              </Menu>
            </>
          )}
        </Toolbar>
      </AppBar>

      {/* Drawer */}
      <Box
        component="nav"
        sx={{
          width: { md: drawerWidth },
          flexShrink: { md: 0 },
          transition: theme.transitions.create('width', {
            easing: theme.transitions.easing.sharp,
            duration: theme.transitions.duration.leavingScreen,
          }),
        }}
      >
        {/* Mobile drawer — an overlay you dismiss, so it is always full width
            and labelled; the desktop rail preference has no say over it */}
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={handleDrawerToggle}
          ModalProps={{ keepMounted: true }}
          sx={{
            display: { xs: 'block', md: 'none' },
            '& .MuiDrawer-paper': {
              boxSizing: 'border-box',
              width: DRAWER_WIDTH,
              overflowX: 'hidden',
            },
          }}
        >
          {renderDrawer({ labels: true, collapsible: false })}
        </Drawer>

        {/* Desktop drawer */}
        <Drawer
          variant="permanent"
          PaperProps={railRevealProps}
          sx={{
            display: { xs: 'none', md: 'block' },
            '& .MuiDrawer-paper': {
              boxSizing: 'border-box',
              width: flyout ? DRAWER_WIDTH : drawerWidth,
              transition: theme.transitions.create('width', {
                easing: theme.transitions.easing.sharp,
                duration: theme.transitions.duration.leavingScreen,
              }),
              overflowX: 'hidden',
              // The paper is position:fixed, so the flyout floats over the page
              // rather than pushing it. The shadow is what says "this is a
              // layer that will go away", not a sidebar that just resized.
              ...(flyout && {
                boxShadow: theme.shadows[8],
                zIndex: theme.zIndex.drawer + 2,
              }),
            },
          }}
          open
        >
          {renderDrawer({ labels: showLabels, collapsible: true })}
        </Drawer>
      </Box>

      {/* Main content */}
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          p: { xs: 2, sm: 3 },
          width: { md: `calc(100% - ${drawerWidth}px)` },
          marginInlineEnd: { md: `${dockWidth}px` },
          maxWidth: '100%',
          overflowX: 'hidden',
          mt: '64px',
          backgroundColor: 'background.default',
          minHeight: 'calc(100vh - 64px)',
          transition: dockResizing
            ? 'none'
            : theme.transitions.create(['width', 'margin'], {
                easing: theme.transitions.easing.sharp,
                duration: theme.transitions.duration.leavingScreen,
              }),
        }}
      >
        <Outlet key={i18n.language} />
      </Box>

      {/* Welcome Modal - opens itself on the recommendations page it explains,
          and on request from the user menu anywhere */}
      <WelcomeModal open={welcomeOpen} onClose={hideWelcome} />

      {/* Exploration Config Modal - prompts admins to configure new AI provider */}
      <ExplorationConfigModal />
    </Box>
  )
}
