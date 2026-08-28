import { Box } from '@mui/material'
import { EmbeddingsSection, LegacyEmbeddingsSection } from '@/pages/settings/components'

/**
 * Everything about stored vectors on one page: what each embedding set holds,
 * whether episodes are embedded, and the per-dimension tables left behind by
 * an earlier model.
 *
 * These were two screens apart before — the sets manager stacked under the AI
 * provider roles, the legacy tables under Maintenance — which is why an admin
 * could switch model without ever seeing that the old set was still on disk and
 * switching back would be free.
 */
export default function EmbeddingsRoute() {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <EmbeddingsSection />
      <LegacyEmbeddingsSection />
    </Box>
  )
}
