import { useMediaQuery, useTheme } from '@mui/material'

/**
 * Below `sm`. A dialog that is not full screen here is about 296px wide with
 * ~248px inside its padding, which no form, list or table in this app fits —
 * so every multi-field dialog passes this to `fullScreen`.
 */
export function useIsPhone(): boolean {
  const theme = useTheme()
  return useMediaQuery(theme.breakpoints.down('sm'))
}
