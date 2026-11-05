import React from 'react'
import { Alert, AlertTitle, Box, Button } from '@mui/material'
import RefreshIcon from '@mui/icons-material/Refresh'
import { useTranslation } from 'react-i18next'
import { isChunkReloadPending } from '@/lib/staleChunk'
import { PageLoading } from './PageLoading'

/**
 * Keeps a broken page inside its own pane.
 *
 * React unmounts the whole tree when a render throws, so without a boundary one
 * page failing takes the sidebar and the app bar with it and leaves a white
 * window with no way back except retyping the URL.
 *
 * Two failures reach this. A page that throws while rendering, which is a bug and
 * shows the message. And a chunk that no longer exists, which is not: a tab left
 * open across a deploy asks for a file the new build does not serve.
 * `lib/staleChunk.ts` reloads once for that, and while it does this keeps a
 * spinner up. A chunk still failing after that reload gets the message, and the
 * button is the primary action because reloading is the fix.
 *
 * `resetKey` is the current path: navigating away clears the error, so one bad
 * page does not strand the reader in it. `header` is for a pane whose controls live
 * in the content that failed, drawn above the message so they survive it.
 */

interface BoundaryProps {
  children: React.ReactNode
  resetKey: string
  title: string
  body: string
  reload: string
  header?: React.ReactNode
}

interface BoundaryState {
  error: Error | null
}

class Boundary extends React.Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error }
  }

  componentDidUpdate(prev: BoundaryProps) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null })
    }
  }

  componentDidCatch(error: Error) {
    // The console is where an operator will look first, and the boundary
    // otherwise swallows the only record of what happened.
    console.error('Page failed to render:', error)
  }

  render() {
    if (!this.state.error) return this.props.children
    const { title, body, reload, header } = this.props
    if (isChunkReloadPending()) {
      return (
        <>
          {header}
          <PageLoading />
        </>
      )
    }

    return (
      <Box sx={{ py: 2 }}>
        {header}
        <Alert
          severity="error"
          action={
            <Button
              color="inherit"
              size="small"
              startIcon={<RefreshIcon fontSize="small" />}
              onClick={() => window.location.reload()}
            >
              {reload}
            </Button>
          }
        >
          <AlertTitle>{title}</AlertTitle>
          {body}
        </Alert>
      </Box>
    )
  }
}

interface Props {
  children: React.ReactNode
  resetKey: string
  /** For a pane with its own words; the shared page message otherwise. */
  title?: string
  body?: string
  reload?: string
  header?: React.ReactNode
}

export function PageErrorBoundary({ children, resetKey, title, body, reload, header }: Props) {
  const { t } = useTranslation()
  return (
    <Boundary
      resetKey={resetKey}
      title={title ?? t('common.pageError.title')}
      body={body ?? t('common.pageError.body')}
      reload={reload ?? t('common.pageError.reload')}
      header={header}
    >
      {children}
    </Boundary>
  )
}
