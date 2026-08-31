import { Box } from '@mui/material'
import { EvaluationSeedsSection } from '@/pages/settings/components'

/**
 * How the offline recommender evaluation is pointed.
 *
 * The `evaluate-recommender` job measures every stored embedding set in one
 * run, so comparing two models or two retrieval modes needs no configuration —
 * except for this. The neighbour dump is the instrument the comparison is
 * actually judged on, and it reads whatever seeds it is given; unset, it uses
 * the most-watched titles, which is precisely where two embedding spaces agree.
 */
export default function EvaluationRoute() {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <EvaluationSeedsSection />
    </Box>
  )
}
