import React from 'react'
import { Box } from '@mui/material'

export interface TabPanelProps {
  children?: React.ReactNode
  /** This panel's tab key. */
  tab: string
  /** The selected tab key. */
  value: string
}

export function TabPanel({ children, value, tab }: TabPanelProps) {
  return (
    <div role="tabpanel" hidden={value !== tab}>
      {value === tab && <Box sx={{ pt: 3 }}>{children}</Box>}
    </div>
  )
}
