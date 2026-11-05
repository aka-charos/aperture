import { Box, CircularProgress } from '@mui/material'

/** A page's chunk on its way, inside a shell that is already on screen. */
export function PageLoading() {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', p: 6 }}>
      <CircularProgress />
    </Box>
  )
}
