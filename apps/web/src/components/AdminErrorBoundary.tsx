import React from 'react'
import { Alert, AlertTitle, Box, Button } from '@mui/material'
import RefreshIcon from '@mui/icons-material/Refresh'
import { withTranslation, type WithTranslation } from 'react-i18next'

/**
 * Keeps a broken section inside its own pane.
 *
 * Every admin destination is now one lazily-loaded component in one outlet, and
 * React unmounts the whole tree when a render throws — so without a boundary
 * here, a single section failing takes the sidebar, the app bar and the nav
 * column with it. The console goes white with no way back except retyping the
 * URL, and nothing on screen says which section did it.
 *
 * Two failures reach this. A section that throws while rendering, which is a
 * bug and shows the message. And a chunk that no longer exists, which is not:
 * asset filenames are hashed and this deploys by swapping an image, so a tab
 * left open across a deploy asks for a file the new build does not serve.
 * Reloading is the whole fix for that one, which is why the button is the
 * primary action rather than a footnote.
 *
 * `resetKey` is the current path: navigating away from a broken section clears
 * the error, so one bad page does not strand the reader in it.
 *
 * Mirrors `ThreadErrorBoundary`, which exists so a chat render error can only
 * cost the chat.
 */

interface Props extends WithTranslation {
  children: React.ReactNode
  resetKey: string
}

interface State {
  error: Error | null
}

class AdminErrorBoundaryInner extends React.Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null })
    }
  }

  componentDidCatch(error: Error) {
    // The console is where an operator will look first, and the boundary
    // otherwise swallows the only record of what happened.
    console.error('Admin section failed to render:', error)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    const { t } = this.props
    return (
      <Box sx={{ py: 2 }}>
        <Alert
          severity="error"
          action={
            <Button
              color="inherit"
              size="small"
              startIcon={<RefreshIcon fontSize="small" />}
              onClick={() => window.location.reload()}
            >
              {t('adminNav.sectionErrorReload')}
            </Button>
          }
        >
          <AlertTitle>{t('adminNav.sectionErrorTitle')}</AlertTitle>
          {t('adminNav.sectionErrorBody')}
        </Alert>
      </Box>
    )
  }
}

export const AdminErrorBoundary = withTranslation()(AdminErrorBoundaryInner)
