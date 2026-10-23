import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert, Box, Typography } from '@mui/material'
import { GraphLegend, SimilarityGraph, type GraphNode } from '@/components/SimilarityGraph'
import { roleKey } from './trail'
import type { TrailEntity, TrailRole, TrailTitle } from './types'
import { buildMapData, type MapLabels } from './map'
import type { NextFromHereResponse, NextItem, NextPeopleRow, NextRowMember } from './types'

interface NextMapProps {
  data: NextFromHereResponse
  onOpen: (title: TrailTitle) => void
  onStepItem: (item: NextItem) => void
  onStepRow: (row: NextPeopleRow, member: NextRowMember) => void
}

/**
 * The suggestions as a map around the start, drawn by the similarity graph:
 * a click opens a title's details, and the graph's own re-centre gesture
 * (Shift+click, the node's corner button, a long press) steps on to it, as
 * the corner button on a list poster does.
 */
export function NextMap({ data, onOpen, onStepItem, onStepRow }: NextMapProps) {
  const { t, i18n } = useTranslation()

  const labels = useMemo<MapLabels>(
    () => ({
      closeness: (rank, type) =>
        t(type === 'movie' ? 'next.map.closenessMovie' : 'next.map.closenessSeries', { rank }),
      via: (entity: TrailEntity, roles: readonly TrailRole[]) =>
        entity.kind === 'person' && roles[0] ? `${entity.name} · ${t(roleKey(roles[0]))}` : entity.name,
      themes: (names) =>
        t('next.map.themes', { names: new Intl.ListFormat(i18n.language, { type: 'conjunction' }).format(names) }),
    }),
    [t, i18n.language]
  )
  const graph = useMemo(() => buildMapData(data, labels), [data, labels])

  const titleFor = useCallback(
    (node: GraphNode): TrailTitle | null => {
      const ref = `${node.type}:${node.id}`
      if (data.start?.ref === ref) return data.start
      const item = data.close.find((entry) => entry.title.ref === ref)
      if (item) return item.title
      for (const row of data.people) {
        const member = row.members.find((entry) => entry.title.ref === ref)
        if (member) return member.title
      }
      return null
    },
    [data]
  )

  const onNodeOpen = useCallback(
    (node: GraphNode) => {
      const title = titleFor(node)
      if (title) onOpen(title)
    },
    [titleFor, onOpen]
  )

  // Stepping on from the map takes the same link the list would: the close
  // list's reasons first, else the first row the title sits in.
  const onNodeExplore = useCallback(
    (node: GraphNode) => {
      const ref = `${node.type}:${node.id}`
      const item = data.close.find((entry) => entry.title.ref === ref)
      if (item) return onStepItem(item)
      for (const row of data.people) {
        const member = row.members.find((entry) => entry.title.ref === ref)
        if (member) return onStepRow(row, member)
      }
    },
    [data, onStepItem, onStepRow]
  )

  if (!graph || graph.nodes.length < 2) {
    return <Alert severity="info">{t('next.map.empty')}</Alert>
  }
  return (
    <Box component="section" sx={{ mb: 4 }}>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        {t('next.map.description')}
      </Typography>
      <Box sx={{ height: { xs: 480, md: 640 }, borderRadius: 2, overflow: 'hidden' }}>
        <SimilarityGraph data={graph} onNodeOpen={onNodeOpen} onNodeExplore={onNodeExplore} />
      </Box>
      <GraphLegend edges={graph.edges} />
    </Box>
  )
}
