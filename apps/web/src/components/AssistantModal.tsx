import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  Box,
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
import OpenInFullIcon from '@mui/icons-material/OpenInFull'
import VerticalSplitIcon from '@mui/icons-material/VerticalSplit'
import WebAssetIcon from '@mui/icons-material/WebAsset'
import { AssistantChatSurface } from './assistant/AssistantChatSurface'
import { useAssistantChat } from './assistant/useAssistantChat'
import { useAssistantDock } from '@/hooks/useAssistantDock'
import { gradients } from '@/theme'

// Surface the assistant renders in: blocking dialog or persistent side panel
// that leaves the rest of the app browsable.
type AssistantSurface = 'modal' | 'dock'
const SURFACE_STORAGE_KEY = 'aperture.assistant.surface'

// The dock is user-resizable between these bounds; the width persists.
// The floor was 320 back when a chat card was a thumbnail beside some text.
// Cards now carry a fixed 84px meta rail, so 320 left a ~160px prose column —
// around 25 characters a line, narrower than a newspaper column and unreadable
// whatever the clamps do.
const DOCK_WIDTH_STORAGE_KEY = 'aperture.assistant.dockWidth'
const DOCK_DEFAULT_WIDTH = 420
const DOCK_MIN_WIDTH = 400
const DOCK_MAX_WIDTH = 720

/** Keep the dock within bounds and leave the library at least ~a third of the viewport */
function clampDockWidth(width: number): number {
  const max = Math.max(DOCK_MIN_WIDTH, Math.min(DOCK_MAX_WIDTH, Math.round(window.innerWidth * 0.66)))
  return Math.min(Math.max(Math.round(width), DOCK_MIN_WIDTH), max)
}

function loadStoredDockWidth(): number {
  try {
    const stored = Number(localStorage.getItem(DOCK_WIDTH_STORAGE_KEY))
    if (Number.isFinite(stored) && stored >= DOCK_MIN_WIDTH) return clampDockWidth(stored)
  } catch {
    // Fall through to the default
  }
  return DOCK_DEFAULT_WIDTH
}

/**
 * Floating assistant: the Fab opens the dock (a side panel that leaves the
 * library usable), or the older dialog for anyone who toggles to it. The same
 * chat is also a regular page at /assistant (see pages/assistant), which the
 * header's expand button hands off to.
 */
export function AssistantModal() {
  const { t } = useTranslation()
  const theme = useTheme()
  const location = useLocation()
  const navigate = useNavigate()
  // Phones get a forced-fullscreen dialog; the dock needs room next to the library.
  const isSmDown = useMediaQuery(theme.breakpoints.down('sm'))
  const canDock = useMediaQuery(theme.breakpoints.up('md'))
  const [open, setOpen] = useState(false)
  const [surface, setSurface] = useState<AssistantSurface>(() => {
    try {
      // The dock is the default: it leaves the library browsable beside the chat
      // and can open picks in the main pane. The dialog is opt-in, and only for
      // people who stored that preference by toggling.
      return localStorage.getItem(SURFACE_STORAGE_KEY) === 'modal' ? 'modal' : 'dock'
    } catch {
      return 'dock'
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

  // User-resizable dock width, persisted across sessions.
  const [dockWidth, setLocalDockWidth] = useState(loadStoredDockWidth)
  // Latest width during a drag, so the pointer-up handler persists the exact
  // final value even if React hasn't re-rendered since the last move event.
  const dragWidthRef = useRef(dockWidth)
  const draggingRef = useRef(false)

  // Let Layout reserve space for the dock so the library stays fully visible.
  const { setDockWidth, setDockResizing } = useAssistantDock()
  useEffect(() => {
    setDockWidth(open && docked ? dockWidth : 0)
    return () => setDockWidth(0)
  }, [open, docked, dockWidth, setDockWidth])

  // Re-clamp when the window shrinks so the dock never squeezes out the library.
  useEffect(() => {
    if (!(open && docked)) return
    const onWindowResize = () => setLocalDockWidth(w => clampDockWidth(w))
    window.addEventListener('resize', onWindowResize)
    return () => window.removeEventListener('resize', onWindowResize)
  }, [open, docked])

  const persistDockWidth = (width: number) => {
    try {
      localStorage.setItem(DOCK_WIDTH_STORAGE_KEY, String(width))
    } catch {
      // Preference just won't persist
    }
  }

  const handleResizeStart = (e: React.PointerEvent<HTMLElement>) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    draggingRef.current = true
    setDockResizing(true)
  }

  const handleResizeMove = (e: React.PointerEvent<HTMLElement>) => {
    if (!draggingRef.current) return
    // The dock sits at the inline-end edge: physical right in LTR (MUI flips
    // anchor="right" to the left under RTL), so width is the distance from
    // the pointer to that edge.
    const width = theme.direction === 'rtl' ? e.clientX : window.innerWidth - e.clientX
    const clamped = clampDockWidth(width)
    dragWidthRef.current = clamped
    setLocalDockWidth(clamped)
  }

  const handleResizeEnd = () => {
    if (!draggingRef.current) return
    draggingRef.current = false
    setDockResizing(false)
    persistDockWidth(dragWidthRef.current)
  }

  const handleResizeReset = () => {
    setLocalDockWidth(DOCK_DEFAULT_WIDTH)
    persistDockWidth(DOCK_DEFAULT_WIDTH)
  }

  const handleOpen = () => {
    setOpen(true)
  }
  const handleClose = () => setOpen(false)

  // Supersedes the old fullscreen dialog: the same chat filling the viewport,
  // but with a URL, the app around it, and no backdrop to dismiss. The current
  // conversation rides along in the route state, so the page resumes it instead
  // of falling back to "most recently updated" — only sometimes the same thing.
  const handleOpenFullPage = () => {
    setOpen(false)
    navigate(
      '/assistant',
      chat.activeConversationId ? { state: { conversationId: chat.activeConversationId } } : undefined
    )
  }

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
      <Tooltip title={t('assistant.tooltipOpenFullPage')}>
        <IconButton onClick={handleOpenFullPage} size="small">
          <OpenInFullIcon />
        </IconButton>
      </Tooltip>
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
      // Neither floating surface is wide enough to give up 280px to the
      // conversation list; both reach it through the history toggle. The
      // dedicated page is the one that shows it inline.
      sidebarInline={false}
      headerActions={headerActions}
      onBeforeNavigate={handleClose}
      // Docked, the library is right there: clicking a pick routes the main pane
      // and the chat keeps its place beside it. The dialog covers that pane, so
      // routing behind it would look like nothing happened.
      openMediaInModal={!docked}
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
              background: gradients.primaryToSecondary,
              '&:hover': {
                background: `linear-gradient(135deg, ${theme.palette.primary.dark} 0%, ${theme.palette.secondary.dark} 100%)`,
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
        fullScreen={isSmDown}
        PaperProps={{
          sx: {
            height: isSmDown ? '100%' : '95vh',
            maxHeight: isSmDown ? '100%' : '90vh',
            bgcolor: 'rgba(15, 15, 15, 0.5)',
            backdropFilter: 'blur(10px)',
            backgroundImage: 'none',
            borderRadius: isSmDown ? 0 : 3,
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
            width: dockWidth,
            maxWidth: '100vw',
            bgcolor: 'rgba(15, 15, 15, 0.85)',
            backdropFilter: 'blur(16px)',
            backgroundImage: 'none',
            borderInlineStart: '1px solid rgba(255, 255, 255, 0.1)',
          },
        }}
      >
        {open && docked ? (
          <>
            {/* Drag to resize; double-click restores the default width. */}
            <Box
              role="separator"
              aria-orientation="vertical"
              aria-label={t('assistant.dockResizeHandle')}
              onPointerDown={handleResizeStart}
              onPointerMove={handleResizeMove}
              onPointerUp={handleResizeEnd}
              onPointerCancel={handleResizeEnd}
              onDoubleClick={handleResizeReset}
              sx={{
                position: 'absolute',
                insetInlineStart: 0,
                top: 0,
                bottom: 0,
                width: 8,
                cursor: 'ew-resize',
                touchAction: 'none',
                zIndex: 2,
                '&:hover, &:active': {
                  bgcolor: 'rgba(139, 92, 246, 0.35)',
                },
              }}
            />
            {chatSurface}
          </>
        ) : null}
      </Drawer>
    </>
  )
}
