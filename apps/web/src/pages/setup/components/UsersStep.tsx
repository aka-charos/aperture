import { useEffect, useMemo, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import {
  Box,
  Button,
  Typography,
  Alert,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Switch,
  Chip,
  CircularProgress,
  IconButton,
  Tooltip,
  Divider,
  TablePagination,
} from '@mui/material'
import RefreshIcon from '@mui/icons-material/Refresh'
import AutoAwesomeMotionIcon from '@mui/icons-material/AutoAwesomeMotion'
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings'
import { useTranslation } from 'react-i18next'
import type { SetupWizardContext, SetupUser } from '../types'

const ROWS_PER_PAGE = 10

interface UsersStepProps {
  wizard: SetupWizardContext
}

interface UserTableProps {
  users: SetupUser[]
  toggleUserRecommendations: (providerUserId: string, enabled: boolean) => Promise<void>
  enabledAdminCount: number
  isAdminSection?: boolean
}

function UserTable({ users, toggleUserRecommendations, enabledAdminCount, isAdminSection }: UserTableProps) {
  const { t } = useTranslation()
  const [page, setPage] = useState(0)

  if (users.length === 0) return null

  const paginatedUsers = users.slice(page * ROWS_PER_PAGE, (page + 1) * ROWS_PER_PAGE)
  const showPagination = users.length > ROWS_PER_PAGE

  return (
    <TableContainer component={Paper} variant="outlined">
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>{t('setup.users.colUser')}</TableCell>
            <TableCell align="center" sx={{ width: 160 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5 }}>
                <AutoAwesomeMotionIcon fontSize="small" />
                {t('setup.users.colRecommendations')}
              </Box>
            </TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {paginatedUsers.map((user) => {
            // For admins: prevent disabling if this is the last enabled admin
            const isLastEnabledAdmin =
              isAdminSection && user.isAdmin && user.recommendationsEnabled && enabledAdminCount <= 1

            return (
              <TableRow
                key={user.providerUserId}
                sx={{
                  opacity: user.isDisabled ? 0.5 : 1,
                  '&:last-child td, &:last-child th': { border: 0 },
                }}
              >
                <TableCell>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography variant="body2">{user.name}</Typography>
                    {user.isAdmin && (
                      <Chip
                        icon={<AdminPanelSettingsIcon />}
                        label={t('setup.users.adminChip')}
                        size="small"
                        color="primary"
                        variant="outlined"
                      />
                    )}
                    {user.isDisabled && (
                      <Chip label={t('setup.users.disabledChip')} size="small" color="default" variant="outlined" />
                    )}
                  </Box>
                </TableCell>
                <TableCell align="center">
                  <Tooltip title={isLastEnabledAdmin ? t('setup.users.tooltipLastAdmin') : ''}>
                    <span>
                      <Switch
                        checked={user.recommendationsEnabled}
                        onChange={(e) => toggleUserRecommendations(user.providerUserId, e.target.checked)}
                        disabled={user.isDisabled || isLastEnabledAdmin}
                        size="small"
                      />
                    </span>
                  </Tooltip>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
      {showPagination && (
        <TablePagination
          component="div"
          count={users.length}
          page={page}
          onPageChange={(_, newPage) => setPage(newPage)}
          rowsPerPage={ROWS_PER_PAGE}
          rowsPerPageOptions={[ROWS_PER_PAGE]}
          labelDisplayedRows={({ from, to, count }) =>
            t('setup.users.paginationRange', { from, to, count })
          }
          sx={{ borderTop: 1, borderColor: 'divider' }}
        />
      )}
    </TableContainer>
  )
}

export function UsersStep({ wizard }: UsersStepProps) {
  const { t } = useTranslation()
  const {
    goToStep,
    updateProgress,
    setupUsers,
    loadingUsers,
    usersError,
    setupCompleteForUsers,
    fetchSetupUsers,
    toggleUserRecommendations,
  } = wizard

  // Fetch users when this step loads
  useEffect(() => {
    fetchSetupUsers()
  }, [fetchSetupUsers])

  // Split users into admins and non-admins
  const { adminUsers, regularUsers, enabledAdminCount } = useMemo(() => {
    const admins = setupUsers.filter((u) => u.isAdmin)
    const regular = setupUsers.filter((u) => !u.isAdmin)
    const enabledCount = admins.filter((u) => u.recommendationsEnabled).length
    return { adminUsers: admins, regularUsers: regular, enabledAdminCount: enabledCount }
  }, [setupUsers])

  const handleContinue = async () => {
    await updateProgress({ completedStep: 'users' })
    goToStep('topPicks')
  }

  // Show friendly message if setup is already complete
  if (setupCompleteForUsers) {
    return (
      <Box>
        <Typography variant="h6" gutterBottom>
          {t('setup.users.titleEnableUsers')}
        </Typography>

        <Alert severity="info" sx={{ mb: 3 }}>
          <Typography variant="body2">
            {usersError || t('setup.users.setupCompleteFallback')}{' '}
            <RouterLink to="/admin/users" style={{ color: 'inherit', fontWeight: 600 }}>
              {t('setup.users.manageUsersLink')}
            </RouterLink>
          </Typography>
        </Alert>

        <Box sx={{ display: 'flex', gap: 2, mt: 3 }}>
          <Button variant="outlined" onClick={() => goToStep('validate')}>
            {t('setup.users.back')}
          </Button>
          <Button variant="contained" onClick={handleContinue}>
            {t('setup.users.continue')}
          </Button>
        </Box>
      </Box>
    )
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
        <Typography variant="h6">{t('setup.users.titleMain')}</Typography>
        <Tooltip title={t('setup.users.refreshTooltip')}>
          <IconButton onClick={fetchSetupUsers} disabled={loadingUsers} size="small">
            <RefreshIcon />
          </IconButton>
        </Tooltip>
      </Box>

      <Typography variant="body2" color="text.secondary" paragraph>
        {t('setup.users.bodyText')}
      </Typography>

      {usersError && !setupCompleteForUsers && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {usersError}
        </Alert>
      )}

      {loadingUsers ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress />
        </Box>
      ) : setupUsers.length === 0 ? (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {t('setup.users.noUsersWarning')}
        </Alert>
      ) : (
        <>
          {/* Admin Users Section */}
          {adminUsers.length > 0 && (
            <Box sx={{ mb: 3 }}>
              <Typography
                variant="subtitle2"
                color="primary"
                gutterBottom
                sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
              >
                <AdminPanelSettingsIcon fontSize="small" />
                {t('setup.users.adminSectionTitle', { count: adminUsers.length })}
              </Typography>
              <Alert severity="info" sx={{ mb: 2, py: 0.5 }} icon={false}>
                <Typography variant="caption">{t('setup.users.adminInfoCaption')}</Typography>
              </Alert>
              <UserTable
                users={adminUsers}
                toggleUserRecommendations={toggleUserRecommendations}
                enabledAdminCount={enabledAdminCount}
                isAdminSection
              />
            </Box>
          )}

          {/* Regular Users Section */}
          {regularUsers.length > 0 && (
            <Box sx={{ mb: 3 }}>
              {adminUsers.length > 0 && <Divider sx={{ my: 2 }} />}
              <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                {t('setup.users.otherUsersTitle', { count: regularUsers.length })}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
                {t('setup.users.otherUsersCaption')}
              </Typography>
              <UserTable
                users={regularUsers}
                toggleUserRecommendations={toggleUserRecommendations}
                enabledAdminCount={enabledAdminCount}
              />
            </Box>
          )}
        </>
      )}

      <Alert severity="warning" sx={{ mb: 2, py: 0.5 }} icon={false}>
        <Typography variant="caption">
          <strong>{t('setup.users.noteLabel')}</strong> {t('setup.users.noteText')}
        </Typography>
      </Alert>

      <Box sx={{ display: 'flex', gap: 2, mt: 3 }}>
        <Button variant="outlined" onClick={() => goToStep('validate')}>
          {t('setup.users.back')}
        </Button>
        <Button variant="contained" onClick={handleContinue}>
          {t('setup.users.continue')}
        </Button>
      </Box>
    </Box>
  )
}
