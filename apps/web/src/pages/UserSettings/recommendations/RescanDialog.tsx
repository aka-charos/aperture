import { Box, Button, ButtonBase, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography } from '@mui/material'
import RefreshIcon from '@mui/icons-material/Refresh'
import AddIcon from '@mui/icons-material/Add'
import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'
import type { RescanMode } from './useTasteData'

function Choice({ icon, title, body, onClick }: { icon: ReactElement; title: string; body: string; onClick: () => void }) {
  return (
    <ButtonBase
      onClick={onClick}
      sx={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 1.5,
        p: 2,
        width: '100%',
        textAlign: 'start',
        border: 1,
        borderColor: 'divider',
        borderRadius: 2,
        '&:hover, &.Mui-focusVisible': { borderColor: 'primary.main', backgroundColor: 'action.hover' },
      }}
    >
      <Box component="span" sx={{ color: 'primary.main', display: 'flex', pt: 0.25 }}>{icon}</Box>
      <Box component="span" sx={{ display: 'block' }}>
        <Typography variant="subtitle2" fontWeight={600} component="span" sx={{ display: 'block' }}>
          {title}
        </Typography>
        <Typography variant="body2" color="text.secondary" component="span" sx={{ display: 'block' }}>
          {body}
        </Typography>
      </Box>
    </ButtonBase>
  )
}

/** Asked only when there is something a rescan could overwrite: keep the viewer's adjustments, or start over. */
export function RescanDialog({ open, onClose, onChoose }: { open: boolean; onClose: () => void; onChoose: (mode: RescanMode) => void }) {
  const { t } = useTranslation()
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t('userSettings.recs.rescan')}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t('watcherIdentity.analyzeModalBody')}
        </Typography>
        <Stack spacing={1.5}>
          <Choice
            icon={<AddIcon />}
            title={t('watcherIdentity.analyzeMergeTitle')}
            body={t('watcherIdentity.analyzeMergeDescription')}
            onClick={() => onChoose('merge')}
          />
          <Choice
            icon={<RefreshIcon />}
            title={t('watcherIdentity.analyzeResetTitle')}
            body={t('watcherIdentity.analyzeResetDescription')}
            onClick={() => onChoose('reset')}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('watcherIdentity.dialogCancel')}</Button>
      </DialogActions>
    </Dialog>
  )
}
