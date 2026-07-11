import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router-dom'
import {
  Dialog,
  Drawer,
  Fab,
  Tooltip,
  IconButton,
  Zoom,
  useMediaQuery,
  useTheme,
} from '@mui/material'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome'
import CloseIcon from '@mui/icons-material/Close'
import FullscreenIcon from '@mui/icons-material/Fullscreen'
import FullscreenExitIcon from '@mui/icons-material/FullscreenExit'
import VerticalSplitIcon from '@mui/icons-material/VerticalSplit'
import WebAssetIcon from '@mui/icons-material/WebAsset'
import { AssistantChatSurface } from './assistant/AssistantChatSurface'
import { useAssistantChat } from './assistant/useAssistantChat'
import { useAssistantDock } from '@/hooks/useAssistantDock'

// Surface the assistant renders in: blocking dialog or persistent side panel
// that leaves the rest of the app browsable.
type AssistantSurface = 'modal' | 'dock'
const SURFACE_STORAGE_KEY = 'aperture.assistant.surface'
const DOCK_WIDTH = 420

/**
 * Floating assistant: Fab + dialog / dockable side panel. The same chat is
 * also available as a regular page at /assistant (see pages/assistant).
 */
export function AssistantModal() {
  const { t } = useTranslation()
  const theme = useTheme()
  const location = useLocation()
  // Phones get a forced-fullscreen dialog; the dock needs room next to the library.
  const isSmDown = useMediaQuery(theme.breakpoints.down('sm'))
  const canDock = useMediaQuery(theme.breakpoints.up('md'))
  const [open, setOpen] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [surface, setSurface] = useState<AssistantSurface>(() => {
    try {
      return localStorage.getItem(SURFACE_STORAGE_KEY) === 'dock' ? 'dock' : 'modal'
    } catch {
      return 'modal'
    }
  })

  // The dedicated /assistant page renders the same chat; hide the floating
  // surface there so the chat never shows twice.
  const onAssistantPage = location.pathname === '/assistant'
  useEffect(() => {
    if (onAssistantPage) setOpen(false)
  }, [onAssistantPage])

  const chat = useAssistantChat(open)

  const docked = surface === 'dock' && canDock
  const effectiveFullscreen = fullscreen || isSmDown
  // The conversation sidebar renders inline only in desktop fullscreen; every
  // other surface (dock, windowed dialog, mobile) reaches it via the drawer.
  const sidebarInline = !docked && fullscreen && !isSmDown

  // Let Layout reserve space for the dock so the library stays fully visible.
  const { setDockWidth } = useAssistantDock()
  useEffect(() => {
    setDockWidth(open && docked ? DOCK_WIDTH : 0)
    return () => setDockWidth(0)
  }, [open, docked, setDockWidth])

  const handleOpen = () => {
    setOpen(true)
  }
  const handleClose = () => setOpen(false)
  const toggleFullscreen = () => setFullscreen(prev => !prev)

  const toggleSurface = () => {
    setSurface(prev => {
      const next: AssistantSurface = prev === 'dock' ? 'modal' : 'dock'
      try {
        localStorage.setItem(SURFACE_STORAGE_KEY, next)
      } catch {
        // Preference just won't persist
      }
      return next
    })
    // Moving between Dialog and Drawer remounts the thread, dropping live
    // runtime messages; they're saved server-side after each turn, so re-pull.
    if (chat.activeConversationId) void chat.refreshConversation(chat.activeConversationId)
  }

  const headerActions = (
    <>
      {canDock && (
        <Tooltip title={docked ? t('assistant.tooltipUndock') : t('assistant.tooltipDock')}>
          <IconButton onClick={toggleSurface} size="small">
            {docked ? <WebAssetIcon /> : <VerticalSplitIcon />}
          </IconButton>
        </Tooltip>
      )}
      {!docked && !isSmDown && (
        <Tooltip title={fullscreen ? t('assistant.tooltipExitFullscreen') : t('assistant.tooltipFullscreen')}>
          <IconButton onClick={toggleFullscreen} size="small">
            {fullscreen ? <FullscreenExitIcon /> : <FullscreenIcon />}
          </IconButton>
        </Tooltip>
      )}
      <IconButton onClick={handleClose} size="small">
        <CloseIcon />
      </IconButton>
    </>
  )

  // Shared chat surface, mounted in exactly one container at a time
  // (Dialog in modal mode, persistent Drawer when docked).
  const chatSurface = (
    <AssistantChatSurface
      chat={chat}
      sidebarInline={sidebarInline}
      headerActions={headerActions}
      onBeforeNavigate={handleClose}
    />
  )

  return (
    <>
      {/* Floating Action Button */}
      <Tooltip title={t('assistant.fabTooltip')} placement="left">
        <Zoom in={!open && !onAssistantPage}>
          <Fab
            color="primary"
            onClick={handleOpen}
            sx={{
              position: 'fixed',
              bottom: 24,
              insetInlineEnd: 24,
              zIndex: 1000,
              background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
              '&:hover': {
                background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
              },
            }}
          >
            <AutoAwesomeIcon />
          </Fab>
        </Zoom>
      </Tooltip>

      {/* Modal surface - stable, doesn't remount on conversation switch */}
      <Dialog
        open={open && !docked}
        onClose={handleClose}
        maxWidth="lg"
        fullWidth
        fullScreen={effectiveFullscreen}
        PaperProps={{
          sx: {
            height: effectiveFullscreen ? '100%' : '95vh',
            maxHeight: effectiveFullscreen ? '100%' : '90vh',
            bgcolor: 'rgba(15, 15, 15, 0.5)',
            backdropFilter: 'blur(10px)',
            backgroundImage: 'none',
            borderRadius: effectiveFullscreen ? 0 : 3,
            overflow: 'hidden',
            border: '1px solid rgba(255, 255, 255, 0.1)',
          },
        }}
      >
        {chatSurface}
      </Dialog>

      {/* Dock surface - persistent side panel without a backdrop, so the
          library stays browsable while chatting. Layout reserves the width
          via AssistantDockContext. Children render only while visible so the
          chat thread is never mounted twice. */}
      <Drawer
        variant="persistent"
        anchor="right"
        open={open && docked}
        PaperProps={{
          sx: {
            width: DOCK_WIDTH,
            maxWidth: '100vw',
            bgcolor: 'rgba(15, 15, 15, 0.85)',
            backdropFilter: 'blur(16px)',
            backgroundImage: 'none',
            borderInlineStart: '1px solid rgba(255, 255, 255, 0.1)',
          },
        }}
      >
        {open && docked ? chatSurface : null}
      </Drawer>
    </>
  )
}
