import { Box } from '@mui/material'
import { EvaluationResultsSection, EvaluationSeedsSection } from '@/pages/settings/components'

/**
 * How the offline recommender evaluation is pointed, and what it found.
 *
 * The `evaluate-recommender` job measures every stored embedding set in one
 * run, so comparing two models or two retrieval modes needs no configuration —
 * except for this. The neighbour dump is the instrument the comparison is
 * actually judged on, and it reads whatever seeds it is given; unset, it uses
 * the most-watched titles, which is precisely where two embedding spaces agree.
 *
 * Seeds first, results second: the results are only worth reading once the
 * seeds are ones that can tell two spaces apart.
 */
export default function EvaluationRoute() {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <EvaluationSeedsSection />
      <EvaluationResultsSection />
    </Box>
  )
}
