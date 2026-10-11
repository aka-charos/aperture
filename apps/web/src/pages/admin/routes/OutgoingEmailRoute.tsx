import { Box } from '@mui/material'
import { AccountDriftSection, SmtpConfigSection } from '@/pages/settings/components'

/**
 * The connection, then who it would reach. Account drift sits under Outgoing
 * email rather than as its own entry because the question it answers is
 * whether the accounts an email would go to are still the right people:
 * someone removed from the media server keeps an Aperture account and an
 * address on file, and nothing else on the console shows it.
 */
export default function OutgoingEmailRoute() {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <SmtpConfigSection />
      <AccountDriftSection />
    </Box>
  )
}
