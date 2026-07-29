/**
 * Containment for render errors inside the chat thread.
 *
 * The thread renders model output through third-party primitives, and a throw
 * during render — not an API failure, which the stream error path already
 * handles — propagates all the way out of React and unmounts the whole SPA. A
 * chat widget should not be able to take the navigation, the library and the
 * settings down with it, so it gets its own boundary.
 *
 * Placed around `Thread` and INSIDE `AssistantRuntimeProvider`, so retrying
 * re-renders into the same runtime and the conversation survives. Retry is the
 * right affordance for the class of bug this catches: a transient inconsistency
 * has usually settled by the time the user clicks.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Box, Button, Typography } from '@mui/material'
import ReplayIcon from '@mui/icons-material/Replay'
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline'

/** Exported so this file has a component export — a lone class export leaves
 *  react-refresh unable to see one, and it flags the local component instead. */
export function ThreadCrashFallback({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation()
  return (
    <Box
      sx={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 1.5,
        p: 4,
        textAlign: 'center',
      }}
    >
      <ErrorOutlineIcon sx={{ fontSize: 40, color: 'text.disabled' }} />
      <Typography variant="subtitle1" fontWeight={600}>
        {t('assistant.threadCrashTitle')}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 420 }}>
        {t('assistant.threadCrashBody')}
      </Typography>
      <Button variant="outlined" size="small" startIcon={<ReplayIcon />} onClick={onRetry}>
        {t('assistant.threadCrashRetry')}
      </Button>
    </Box>
  )
}

interface ThreadErrorBoundaryProps {
  children: ReactNode
}

interface ThreadErrorBoundaryState {
  crashed: boolean
}

export class ThreadErrorBoundary extends Component<
  ThreadErrorBoundaryProps,
  ThreadErrorBoundaryState
> {
  state: ThreadErrorBoundaryState = { crashed: false }

  static getDerivedStateFromError(): ThreadErrorBoundaryState {
    return { crashed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // The stack is the only record of what actually broke — nothing reaches the
    // server, and the fallback deliberately doesn't show it to the user.
    console.error('Assistant thread crashed', error, info.componentStack)
  }

  render() {
    if (this.state.crashed) {
      return <ThreadCrashFallback onRetry={() => this.setState({ crashed: false })} />
    }
    return this.props.children
  }
}
