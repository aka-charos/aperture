import {
  Box,
  Typography,
  Grid,
  Button,
  Skeleton,
  Alert,
  Snackbar,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  CircularProgress,
} from '@mui/material'
import { useTranslation } from 'react-i18next'
import AddIcon from '@mui/icons-material/Add'
import { usePlaylistsData } from '../playlists/hooks'
import { PlaylistCard, PlaylistDialog, PlaylistViewDialog, EmptyState } from '../playlists/components'
import { useServerDisplayName } from '../../hooks/useServerDisplayName'

// Reuses the Channel builder stack (hook + components) but targets server-wide Emby Collections
// instead of personal Playlists. The shared components resolve their labels from this namespace.
const NS = 'collections'

export function CollectionsPage() {
  const { t } = useTranslation()
  const serverName = useServerDisplayName()
  const {
    channels,
    loading,
    error,
    availableGenres,
    loadingGenres,
    formData,
    setFormData,
    editingChannel,
    generatingChannelId,
    snackbar,
    setSnackbar,
    dialogOpen,
    playlistDialogOpen,
    viewingChannel,
    playlistItems,
    loadingPlaylist,
    removingItemId,
    addingMovieId,
    deleteDialogOpen,
    deletingPlaylist,
    deleteLoading,
    handleOpenDialog,
    handleCloseDialog,
    handleSubmit,
    handleDelete,
    handleDeleteCancel,
    handleDeleteConfirm,
    handleGeneratePlaylist,
    addExampleMovie,
    removeExampleMovie,
    handleViewPlaylist,
    handleClosePlaylistDialog,
    handleRemoveFromPlaylist,
    handleAddToPlaylist,
  } = usePlaylistsData('collection')

  if (loading) {
    return (
      <Box>
        <Typography variant="h4" fontWeight={700} mb={4}>
          {t('collections.pageTitle')}
        </Typography>
        <Grid container spacing={3}>
          {Array.from({ length: 3 }).map((_, i) => (
            <Grid item xs={12} sm={6} md={4} key={i}>
              <Skeleton variant="rectangular" height={280} sx={{ borderRadius: 2 }} />
            </Grid>
          ))}
        </Grid>
      </Box>
    )
  }

  return (
    <Box>
      <Box
        display="flex"
        flexDirection={{ xs: 'column', sm: 'row' }}
        justifyContent="space-between"
        alignItems={{ xs: 'stretch', sm: 'center' }}
        gap={{ xs: 2, sm: 0 }}
        mb={4}
      >
        <Box>
          <Typography variant="h4" fontWeight={700} mb={1}>
            {t('collections.pageTitle')}
          </Typography>
          <Typography variant="body1" color="text.secondary">
            {serverName
              ? t('collections.pageSubtitleNamed', { serverName })
              : t('collections.pageSubtitle')}
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => handleOpenDialog()}
          sx={{ alignSelf: { xs: 'flex-start', sm: 'center' } }}
        >
          {t('collections.newPlaylist')}
        </Button>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 4 }}>
          {error}
        </Alert>
      )}

      {channels.length === 0 ? (
        <EmptyState onCreateClick={() => handleOpenDialog()} i18nNamespace={NS} />
      ) : (
        <Grid container spacing={3}>
          {channels.map((channel) => (
            <Grid item xs={12} sm={6} md={4} key={channel.id}>
              <PlaylistCard
                channel={channel}
                generatingChannelId={generatingChannelId}
                onEdit={handleOpenDialog}
                onDelete={handleDelete}
                onGenerate={handleGeneratePlaylist}
                onView={handleViewPlaylist}
                i18nNamespace={NS}
              />
            </Grid>
          ))}
        </Grid>
      )}

      {/* Create/Edit Dialog */}
      <PlaylistDialog
        open={dialogOpen}
        editingChannel={editingChannel}
        formData={formData}
        setFormData={setFormData}
        availableGenres={availableGenres}
        loadingGenres={loadingGenres}
        setSnackbar={setSnackbar}
        onClose={handleCloseDialog}
        onSubmit={handleSubmit}
        onAddExampleMovie={addExampleMovie}
        onRemoveExampleMovie={removeExampleMovie}
        i18nNamespace={NS}
      />

      {/* Collection View/Edit Dialog */}
      <PlaylistViewDialog
        open={playlistDialogOpen}
        channel={viewingChannel}
        playlistItems={playlistItems}
        loadingPlaylist={loadingPlaylist}
        removingItemId={removingItemId}
        addingMovieId={addingMovieId}
        onClose={handleClosePlaylistDialog}
        onRemoveItem={handleRemoveFromPlaylist}
        onAddMovie={handleAddToPlaylist}
        i18nNamespace={NS}
      />

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onClose={handleDeleteCancel} maxWidth="xs" fullWidth>
        <DialogTitle>{t('collections.deleteTitle')}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {t('collections.deleteConfirm', { name: deletingPlaylist?.name ?? '' })}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleDeleteCancel} disabled={deleteLoading}>
            {t('common.cancel')}
          </Button>
          <Button
            onClick={handleDeleteConfirm}
            color="error"
            variant="contained"
            disabled={deleteLoading}
            startIcon={deleteLoading ? <CircularProgress size={16} color="inherit" /> : null}
          >
            {deleteLoading ? t('collections.deleting') : t('collections.delete')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Snackbar */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={() => setSnackbar({ ...snackbar, open: false })}
          severity={snackbar.severity}
          sx={{ width: '100%' }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  )
}
