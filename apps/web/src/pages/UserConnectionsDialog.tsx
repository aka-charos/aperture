import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Alert,
  Autocomplete,
  Avatar,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  Snackbar,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import { withServerMessageDetail } from '@/lib/withServerMessageDetail'
import { useAuth } from '@/hooks/useAuth'

/** The fields this dialog needs from a Users-page row. */
export interface ConnectionCandidate {
  apertureUserId: string | null
  name: string
  /** Access here (the Access switch). */
  isEnabled: boolean
  /** Disabled on the media server. */
  isDisabled: boolean
}

interface ConnectionEnd {
  id: string
  username: string
  name: string
  avatarUrl: string
  hasAccess: boolean
}

interface ConnectionPair {
  id: string
  userA: ConnectionEnd
  userB: ConnectionEnd
  createdAt: string
  createdByName: string | null
}

interface UserConnectionsDialogProps {
  open: boolean
  user: ConnectionCandidate | null
  /** The Users page's already-loaded list, for the picker. */
  users: ConnectionCandidate[]
  onClose: () => void
}

async function serverMessage(response: Response): Promise<string | null> {
  try {
    const body = (await response.json()) as { error?: unknown; message?: unknown }
    const text = body.error ?? body.message
    return typeof text === 'string' && text.trim() ? text : null
  } catch {
    return null
  }
}

/**
 * Who one person is connected to, and the controls to change it
 * (docs/plans/social-connections.md §7.8). Admin-only: people never see or
 * change their own connections.
 *
 * Reloads every pair on each opening, because a list kept from an earlier
 * opening would offer phantom pairs. Someone without access can still be
 * connected — setting a connection up before granting access is allowed — and
 * stays hidden from the other person until access is on.
 */
export function UserConnectionsDialog({ open, user, users, onClose }: UserConnectionsDialogProps) {
  const { t } = useTranslation()
  // An admin can connect themselves; their own Shared with me, Recommend button
  // and dashboard rows depend on the `social` capability, decided at page load.
  const { refreshCapabilities } = useAuth()
  const [pairs, setPairs] = useState<ConnectionPair[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [snackbar, setSnackbar] = useState<{ message: string; severity: 'success' | 'error' } | null>(null)

  const userId = user?.apertureUserId ?? null

  const load = useCallback(async () => {
    const response = await fetch('/api/social/connections/all', { credentials: 'include' })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data = (await response.json()) as { connections?: ConnectionPair[] }
    return data.connections ?? []
  }, [])

  useEffect(() => {
    if (!open || !userId) return
    let current = true
    setPairs([])
    setLoadError(false)
    setLoading(true)
    load()
      .then((all) => {
        if (current) setPairs(all)
      })
      .catch((err) => {
        console.error('Failed to load connections:', err)
        if (current) setLoadError(true)
      })
      .finally(() => {
        if (current) setLoading(false)
      })
    return () => {
      current = false
    }
  }, [open, userId, load])

  /** This person's pairs, each shown as the OTHER person. */
  const rows = useMemo(
    () =>
      pairs
        .filter((p) => p.userA.id === userId || p.userB.id === userId)
        .map((p) => ({ pairId: p.id, other: p.userA.id === userId ? p.userB : p.userA }))
        .sort((a, b) => a.other.name.localeCompare(b.other.name)),
    [pairs, userId]
  )
  const connectedIds = useMemo(() => new Set(rows.map((r) => r.other.id)), [rows])

  const options = useMemo(
    () =>
      users
        .filter((u): u is ConnectionCandidate & { apertureUserId: string } => u.apertureUserId != null)
        .filter((u) => u.apertureUserId !== userId)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [users, userId]
  )

  const fail = async (response: Response | null) => {
    const message = response ? await serverMessage(response) : null
    setSnackbar({
      severity: 'error',
      message: message
        ? `${t('admin.connectionsDialog.failed')}: ${withServerMessageDetail(t, message)}`
        : t('admin.connectionsDialog.failed'),
    })
  }

  const refetch = async () => {
    // Re-read the capabilities too: if the admin was one end of the change,
    // their own social features appear or go without a reload.
    void refreshCapabilities()
    try {
      setPairs(await load())
    } catch (err) {
      console.error('Failed to reload connections:', err)
    }
  }

  const handleAdd = async (other: ConnectionCandidate & { apertureUserId: string }) => {
    if (!userId || !user) return
    setBusy(true)
    try {
      const response = await fetch('/api/social/connections', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userAId: userId, userBId: other.apertureUserId }),
      })
      if (!response.ok) {
        await fail(response)
        return
      }
      setSnackbar({
        severity: 'success',
        message: t('admin.connectionsDialog.added', { a: user.name, b: other.name }),
      })
      await refetch()
    } catch (err) {
      console.error('Failed to add connection:', err)
      await fail(null)
    } finally {
      setBusy(false)
    }
  }

  const handleRemove = async (pairId: string) => {
    setBusy(true)
    try {
      const response = await fetch(`/api/social/connections/${pairId}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (!response.ok && response.status !== 404) {
        await fail(response)
        return
      }
      setSnackbar({ severity: 'success', message: t('admin.connectionsDialog.removed') })
      await refetch()
    } catch (err) {
      console.error('Failed to remove connection:', err)
      await fail(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pr: 1 }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            {t('admin.connectionsDialog.title', { name: user?.name ?? '' })}
          </Box>
          <IconButton onClick={onClose} size="small" aria-label={t('common.close')}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t('admin.connectionsDialog.description')}
          </Typography>

          {loading && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
              <CircularProgress size={28} />
            </Box>
          )}

          {!loading && loadError && <Alert severity="error">{t('admin.connectionsDialog.failed')}</Alert>}

          {!loading && !loadError && rows.length === 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
              {t('admin.connectionsDialog.empty')}
            </Typography>
          )}

          {!loading && !loadError && rows.length > 0 && (
            <List dense disablePadding sx={{ mb: 1 }}>
              {rows.map(({ pairId, other }) => (
                <ListItem
                  key={pairId}
                  disableGutters
                  secondaryAction={
                    <Tooltip title={t('admin.connectionsDialog.remove')}>
                      <span>
                        <IconButton
                          edge="end"
                          aria-label={`${t('admin.connectionsDialog.remove')}: ${other.name}`}
                          onClick={() => handleRemove(pairId)}
                          disabled={busy}
                        >
                          <DeleteOutlineIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                  }
                >
                  <ListItemAvatar>
                    <Avatar src={other.avatarUrl} alt="" sx={{ opacity: other.hasAccess ? 1 : 0.5 }}>
                      {other.name.charAt(0).toUpperCase()}
                    </Avatar>
                  </ListItemAvatar>
                  <ListItemText
                    primary={other.name}
                    primaryTypographyProps={{ sx: { opacity: other.hasAccess ? 1 : 0.6 } }}
                    secondary={
                      other.hasAccess ? `@${other.username}` : t('admin.connectionsDialog.noAccess')
                    }
                    secondaryTypographyProps={{
                      sx: { color: other.hasAccess ? 'text.secondary' : 'warning.main' },
                    }}
                  />
                </ListItem>
              ))}
            </List>
          )}

          <Autocomplete
            options={options}
            value={null}
            blurOnSelect
            clearOnBlur
            disabled={busy || loading || loadError || !userId}
            getOptionLabel={(option) => option.name}
            getOptionDisabled={(option) => connectedIds.has(option.apertureUserId)}
            isOptionEqualToValue={(a, b) => a.apertureUserId === b.apertureUserId}
            onChange={(_, value) => {
              if (value) void handleAdd(value)
            }}
            renderOption={(props, option) => {
              const { key, ...rest } = props as typeof props & { key: string }
              const noAccess = !option.isEnabled || option.isDisabled
              return (
                <li key={key} {...rest}>
                  <Box>
                    <Typography variant="body2">{option.name}</Typography>
                    {noAccess && (
                      <Typography variant="caption" color="warning.main">
                        {t('admin.connectionsDialog.noAccess')}
                      </Typography>
                    )}
                  </Box>
                </li>
              )
            }}
            renderInput={(params) => (
              <TextField
                {...params}
                size="small"
                label={t('admin.connectionsDialog.addPlaceholder')}
                sx={{ mt: 1 }}
              />
            )}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} variant="contained">
            {t('common.close')}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={snackbar !== null}
        autoHideDuration={4000}
        onClose={() => setSnackbar(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity={snackbar?.severity ?? 'success'} variant="filled" onClose={() => setSnackbar(null)}>
          {snackbar?.message}
        </Alert>
      </Snackbar>
    </>
  )
}
