import { useEffect, useRef, useState, useMemo, memo } from 'react'
import { useTranslation } from 'react-i18next'
import * as d3 from 'd3'
import { Box, Typography, Fade, CircularProgress, Chip, Stack } from '@mui/material'
import { alpha } from '@mui/material/styles'
import { getProxiedImageUrl } from '@aperture/ui'
import type { GraphNode, GraphEdge, GraphData, ConnectionReason, LoadingStatus, ConnectionType } from './types'
import { CONNECTION_COLORS } from './types'
import { edgeColorType, edgeIsLit, litNodeIds } from './connectionHighlight'
import { useConnectionHighlight } from './connectionHighlightStore'
import { connectionTypeLabel } from '../../i18n/connectionTypeLabel'
import { palette } from '@/theme'

// Node dimensions (2:3 poster ratio)
const NODE_WIDTH = 100
const NODE_HEIGHT = 150
const CENTER_NODE_WIDTH = 120
const CENTER_NODE_HEIGHT = 180
const PRIMARY_NODE_WIDTH = 110
const PRIMARY_NODE_HEIGHT = 165
const TITLE_HEIGHT = 32
const PRIMARY_LABEL_HEIGHT = 16
/** How long a touch must rest on a node before the graph re-centres on it. */
const LONG_PRESS_MS = 500
/** Movement allowed during a long press before it counts as a drag instead. */
const LONG_PRESS_SLOP_PX = 8
/** Line opacity at rest, when highlighted, and when dimmed by a highlight elsewhere. */
const EDGE_OPACITY = { rest: 0.6, lit: 0.9, dim: 0.06 }
/** Poster opacity when a highlight does not reach it. */
const DIMMED_NODE_OPACITY = 0.18
/**
 * Pull toward the middle. Small, so a linked cluster keeps its own shape; it is
 * what stops clusters with no link between them drifting apart until the
 * layout fills a canvas many screens wide.
 */
const CENTRE_PULL = 0.06
/** Ticks run before the first paint, so the graph appears close to settled. */
const PRESETTLE_TICKS = 120
/** Space left round the graph when it is fitted to the view. */
const FIT_PADDING = 40
/** Furthest a fit zooms out; past this a poster is a coloured dot. */
const MIN_ZOOM = 0.15
/** @mui/icons-material Hub, on a 24px grid: the explore-from-here button. */
const HUB_ICON_PATH =
  'M8.4 18.2c.38.5.6 1.12.6 1.8 0 1.66-1.34 3-3 3s-3-1.34-3-3 1.34-3 3-3c.44 0 .85.09 1.23.26l1.41-1.77c-.92-1.03-1.29-2.39-1.09-3.69l-2.03-.68c-.54.83-1.46 1.38-2.52 1.38-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3c0 .07 0 .14-.01.21l2.03.68c.64-1.21 1.82-2.09 3.22-2.32V5.91C9.96 5.57 9 4.4 9 3c0-1.66 1.34-3 3-3s3 1.34 3 3c0 1.4-.96 2.57-2.25 2.91v2.16c1.4.23 2.58 1.11 3.22 2.32L18 9.71V9.5c0-1.66 1.34-3 3-3s3 1.34 3 3-1.34 3-3 3c-1.06 0-1.98-.55-2.52-1.37l-2.03.68c.2 1.29-.16 2.65-1.09 3.69l1.41 1.77Q17.34 17 18 17c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3c0-.68.22-1.3.6-1.8l-1.41-1.77c-1.35.75-3.01.76-4.37 0z'

interface NodeConnectionInfo {
  node: GraphNode
  connections: Array<{
    targetNode: GraphNode
    reasons: ConnectionReason[]
    similarity: number
  }>
}

interface SimilarityGraphProps {
  data: GraphData | null
  loading?: boolean
  loadingStatus?: LoadingStatus
  /** Click or tap: show the title's details. */
  onNodeOpen?: (node: GraphNode) => void
  /**
   * Re-centre the graph on a title: Shift+click, the node's corner button, or a
   * long press on touch. Not offered on the one centre of a focused graph,
   * which is already where the graph is centred.
   */
  onNodeExplore?: (node: GraphNode) => void
  compact?: boolean
  width?: number
  height?: number
}

export const SimilarityGraph = memo(function SimilarityGraph({
  data,
  loading = false,
  loadingStatus,
  onNodeOpen,
  onNodeExplore,
  compact = false,
  width: propWidth,
  height: propHeight,
}: SimilarityGraphProps) {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 })
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null)
  const [hoveredEdge, setHoveredEdge] = useState<GraphEdge | null>(null)
  const simulationRef = useRef<d3.Simulation<GraphNode, GraphEdge> | null>(null)
  
  // Store callbacks in refs to prevent effect re-runs when parent re-renders
  const onNodeOpenRef = useRef(onNodeOpen)
  const onNodeExploreRef = useRef(onNodeExplore)

  // Keep refs updated with latest callbacks
  useEffect(() => {
    onNodeOpenRef.current = onNodeOpen
  }, [onNodeOpen])

  useEffect(() => {
    onNodeExploreRef.current = onNodeExplore
  }, [onNodeExplore])

  // The highlighted connection types (connectionHighlight.ts). They only change
  // how lines and posters are drawn, never what is laid out, so they live in a
  // ref the drawing reads and do not re-run the simulation.
  const { effective: highlight } = useConnectionHighlight()
  const highlightRef = useRef(highlight)
  const applyHighlightRef = useRef<((animate: boolean) => void) | null>(null)

  // Create a stable key for data to prevent unnecessary re-renders: only when
  // the nodes or the edges change, not when object references do.
  const dataKey = useMemo(() => {
    if (!data) return ''
    const nodeIds = data.nodes.map(n => n.id).sort().join(',')
    const centerId = data.nodes.find(n => n.isCenter)?.id || ''
    const endId = (end: string | GraphNode) => (typeof end === 'string' ? end : end.id)
    const edgeIds = data.edges
      .map((e) => `${endId(e.source)}>${endId(e.target)}:${e.reasons.map((r) => r.type).join('+')}`)
      .sort()
      .join(',')
    return `${centerId}:${nodeIds}|${edgeIds}`
  }, [data])
  const dataRef = useRef(data)

  useEffect(() => {
    dataRef.current = data
  }, [data])

  // Build node connection map for tooltips
  const nodeConnectionMap = useMemo(() => {
    if (!data) return new Map<string, NodeConnectionInfo>()
    
    const map = new Map<string, NodeConnectionInfo>()
    
    // Initialize all nodes
    for (const node of data.nodes) {
      map.set(node.id, { node, connections: [] })
    }
    
    // Add edge connections to each node
    for (const edge of data.edges) {
      const sourceId = typeof edge.source === 'string' ? edge.source : edge.source.id
      const targetId = typeof edge.target === 'string' ? edge.target : edge.target.id
      const sourceNode = data.nodes.find(n => n.id === sourceId)
      const targetNode = data.nodes.find(n => n.id === targetId)
      
      if (sourceNode && targetNode) {
        map.get(sourceId)?.connections.push({
          targetNode,
          reasons: edge.reasons,
          similarity: edge.similarity,
        })
        map.get(targetId)?.connections.push({
          targetNode: sourceNode,
          reasons: edge.reasons,
          similarity: edge.similarity,
        })
      }
    }
    
    return map
  }, [data])

  // Handle resize
  useEffect(() => {
    if (!containerRef.current) return

    const updateDimensions = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect()
        setDimensions({
          width: propWidth || rect.width || 800,
          height: propHeight || rect.height || 600,
        })
      }
    }

    updateDimensions()
    const observer = new ResizeObserver(updateDimensions)
    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [propWidth, propHeight])

  // D3 force simulation
  useEffect(() => {
    const graphData = dataRef.current
    if (!graphData || !svgRef.current || graphData.nodes.length === 0) return

    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()

    const { width, height } = dimensions
    // The lone centre of a focused graph is already where the graph is
    // centred; on the browse and search graphs every centre is a result, and
    // each can be explored from.
    const centerCount = graphData.nodes.filter((n) => n.isCenter).length
    const canExplore = (d: GraphNode) =>
      Boolean(onNodeExploreRef.current) && !(d.isCenter && centerCount === 1)
    const exploreLabel = t('graphExplorer.exploreFromHere')
    const nodeWidth = compact ? NODE_WIDTH * 0.8 : NODE_WIDTH
    const nodeHeight = compact ? NODE_HEIGHT * 0.8 : NODE_HEIGHT
    const centerNodeWidth = compact ? CENTER_NODE_WIDTH * 0.8 : CENTER_NODE_WIDTH
    const centerNodeHeight = compact ? CENTER_NODE_HEIGHT * 0.8 : CENTER_NODE_HEIGHT
    const primaryNodeWidth = compact ? PRIMARY_NODE_WIDTH * 0.8 : PRIMARY_NODE_WIDTH
    const primaryNodeHeight = compact ? PRIMARY_NODE_HEIGHT * 0.8 : PRIMARY_NODE_HEIGHT

    // Helper function to get node dimensions
    const getNodeWidth = (d: GraphNode) => d.isCenter ? centerNodeWidth : (d.isPrimary ? primaryNodeWidth : nodeWidth)
    const getNodeHeight = (d: GraphNode) => d.isCenter ? centerNodeHeight : (d.isPrimary ? primaryNodeHeight : nodeHeight)
    const getNodeTitleHeight = (d: GraphNode) => d.isPrimary && d.primaryLabel ? TITLE_HEIGHT + PRIMARY_LABEL_HEIGHT : TITLE_HEIGHT
    const getNodeStroke = (d: GraphNode) => d.isCenter ? palette.secondary.main : (d.isPrimary ? palette.warning.main : '#333')
    const getNodeStrokeWidth = (d: GraphNode) => d.isCenter ? 2 : (d.isPrimary ? 2 : 1)

    // Create zoom behavior. A zoom the viewer made themselves carries the
    // pointer or wheel event that caused it; a fit has none. Once they have
    // moved the view, it is theirs and no later fit takes it back.
    let viewerMovedView = false
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([MIN_ZOOM, 3])
      .on('zoom', (event) => {
        if (event.sourceEvent) viewerMovedView = true
        container.attr('transform', event.transform)
      })

    svg.call(zoom)

    // Container for zoom/pan
    const container = svg.append('g')

    const edgeOpacity = (d: GraphEdge) => {
      const current = highlightRef.current
      if (current.size === 0) return EDGE_OPACITY.rest
      return edgeIsLit(d.reasons, current) ? EDGE_OPACITY.lit : EDGE_OPACITY.dim
    }

    // Create edges
    const edges = container
      .append('g')
      .attr('class', 'edges')
      .selectAll<SVGLineElement, GraphEdge>('line')
      .data(graphData.edges)
      .join('line')
      .attr('stroke-width', (d) => Math.max(1, d.similarity * 4))
      .style('cursor', 'pointer')
      .on('mouseenter', function (_event, d) {
        d3.select(this).attr('stroke-opacity', 1).attr('stroke-width', Math.max(2, d.similarity * 6))
        setHoveredEdge(d)
      })
      .on('mouseleave', function (_event, d) {
        d3.select(this)
          .attr('stroke-opacity', edgeOpacity(d))
          .attr('stroke-width', Math.max(1, d.similarity * 4))
        setHoveredEdge(null)
      })

    // Long press opens details on touch, where there is no double-click to speak
    // of (a double tap zooms the page) and the mobile hint has always promised
    // it. It rides on d3's drag, which already owns the pointer: the timer
    // starts with the gesture, a real drag cancels it, and the click that ends a
    // long press is swallowed so it does not also select the node.
    let longPressTimer: ReturnType<typeof setTimeout> | null = null
    let longPressStart: { x: number; y: number } | null = null
    let longPressFired = false
    const cancelLongPress = () => {
      if (longPressTimer) clearTimeout(longPressTimer)
      longPressTimer = null
      longPressStart = null
    }
    const isTouchGesture = (sourceEvent: unknown) => {
      const e = sourceEvent as { pointerType?: string; type?: string } | null
      return e?.pointerType === 'touch' || (e?.type?.startsWith('touch') ?? false)
    }

    // Create node groups
    const nodes = container
      .append('g')
      .attr('class', 'nodes')
      .selectAll<SVGGElement, GraphNode>('g')
      .data(graphData.nodes)
      .join('g')
      .attr('class', 'node')
      .style('cursor', 'pointer')
      .call(
        d3.drag<SVGGElement, GraphNode>()
          .on('start', (event, d) => {
            if (!event.active) simulationRef.current?.alphaTarget(0.3).restart()
            d.fx = d.x
            d.fy = d.y
            longPressFired = false
            if (isTouchGesture(event.sourceEvent) && canExplore(d)) {
              cancelLongPress()
              longPressStart = { x: event.x, y: event.y }
              longPressTimer = setTimeout(() => {
                longPressTimer = null
                longPressFired = true
                onNodeExploreRef.current?.(d)
              }, LONG_PRESS_MS)
            }
          })
          .on('drag', (event, d) => {
            d.fx = event.x
            d.fy = event.y
            if (
              longPressStart &&
              Math.hypot(event.x - longPressStart.x, event.y - longPressStart.y) > LONG_PRESS_SLOP_PX
            ) {
              cancelLongPress()
            }
          })
          .on('end', (event, d) => {
            cancelLongPress()
            if (!event.active) simulationRef.current?.alphaTarget(0)
            d.fx = null
            d.fy = null
          })
      )
      .on('click', (event: MouseEvent, d) => {
        event.stopPropagation()
        if (longPressFired) {
          longPressFired = false
          return
        }
        // Shift+click re-centres the graph; a plain click shows the details.
        if (event.shiftKey && canExplore(d)) onNodeExploreRef.current?.(d)
        else onNodeOpenRef.current?.(d)
      })
      // Swallowed so a quick second click does not also zoom the canvas.
      .on('dblclick', (event) => {
        event.stopPropagation()
      })
      // pointer events filtered to a mouse: a tap fires mouseenter and never
      // mouseleave, which left the connection panel stuck over the graph.
      .on('pointerenter', (event: PointerEvent, d) => {
        if (event.pointerType === 'mouse') setHoveredNode(d)
      })
      .on('pointerleave', () => setHoveredNode(null))

    // Node background (card)
    nodes
      .append('rect')
      .attr('width', (d) => getNodeWidth(d))
      .attr('height', (d) => getNodeHeight(d) + getNodeTitleHeight(d))
      .attr('x', (d) => -getNodeWidth(d) / 2)
      .attr('y', (d) => -getNodeHeight(d) / 2)
      .attr('rx', 6)
      .attr('ry', 6)
      .attr('fill', '#1a1a2e')
      .attr('stroke', (d) => getNodeStroke(d))
      .attr('stroke-width', (d) => getNodeStrokeWidth(d))

    // Poster clip path
    nodes
      .append('clipPath')
      .attr('id', (d) => `clip-${d.id}`)
      .append('rect')
      .attr('width', (d) => getNodeWidth(d) - 8)
      .attr('height', (d) => getNodeHeight(d) - 4)
      .attr('x', (d) => -(getNodeWidth(d) - 8) / 2)
      .attr('y', (d) => -getNodeHeight(d) / 2 + 4)
      .attr('rx', 4)
      .attr('ry', 4)

    // Poster image
    nodes
      .append('image')
      .attr('xlink:href', (d) => getProxiedImageUrl(d.poster_url, '/placeholder-poster.png'))
      .attr('width', (d) => getNodeWidth(d) - 8)
      .attr('height', (d) => getNodeHeight(d) - 4)
      .attr('x', (d) => -(getNodeWidth(d) - 8) / 2)
      .attr('y', (d) => -getNodeHeight(d) / 2 + 4)
      .attr('clip-path', (d) => `url(#clip-${d.id})`)
      .attr('preserveAspectRatio', 'xMidYMid slice')

    // Title text
    nodes
      .append('text')
      .text((d) => truncateTitle(d.title, d.isCenter || d.isPrimary ? 14 : 12))
      .attr('text-anchor', 'middle')
      .attr('y', (d) => getNodeHeight(d) / 2 + 14)
      .attr('fill', '#fff')
      .attr('font-size', (d) => (d.isCenter || d.isPrimary ? '11px' : '9px'))
      .attr('font-weight', (d) => (d.isCenter || d.isPrimary ? 600 : 400))

    // Year text
    nodes
      .append('text')
      .text((d) => (d.year ? `(${d.year})` : ''))
      .attr('text-anchor', 'middle')
      .attr('y', (d) => getNodeHeight(d) / 2 + 26)
      .attr('fill', '#888')
      .attr('font-size', '8px')

    // Primary label (for browse sources)
    nodes
      .filter((d) => !!(d.isPrimary && d.primaryLabel))
      .append('text')
      .text((d) => d.primaryLabel || '')
      .attr('text-anchor', 'middle')
      .attr('y', (d) => getNodeHeight(d) / 2 + 40)
      .attr('fill', palette.warning.main)
      .attr('font-size', '7px')
      .attr('font-weight', 500)

    // Explore button - top right corner, on every node the graph could
    // re-centre on (a click on the poster itself shows the details).
    if (onNodeExploreRef.current) {
      const detailsButtonGroup = nodes
        .filter((d) => canExplore(d))
        .append('g')
        .attr('class', 'explore-button')
        .attr('transform', (d) => {
          const nw = getNodeWidth(d)
          const nh = getNodeHeight(d)
          return `translate(${nw / 2 - 16}, ${-nh / 2 + 8})`
        })
        .style('cursor', 'pointer')
        .style('opacity', 0.7)
        .on('mouseenter', function () {
          d3.select(this).style('opacity', 1)
        })
        .on('mouseleave', function () {
          d3.select(this).style('opacity', 0.7)
        })
        .on('click', (event, d) => {
          event.stopPropagation()
          onNodeExploreRef.current?.(d)
        })
        .on('dblclick', (event) => {
          event.stopPropagation()
        })

      // Hover text, read by the browser rather than drawn
      detailsButtonGroup.append('title').text(exploreLabel)

      // Button background circle
      detailsButtonGroup
        .append('circle')
        .attr('r', 12)
        .attr('fill', alpha(palette.secondary.main, 0.9))
        .attr('stroke', '#fff')
        .attr('stroke-width', 1.5)

      // Explore icon (MUI's Hub glyph, 24px, drawn at 14px)
      detailsButtonGroup
        .append('path')
        .attr('d', HUB_ICON_PATH)
        .attr('transform', 'translate(-7, -7) scale(0.5833)')
        .attr('fill', '#fff')
        .style('pointer-events', 'none')
    }

    // Pre-position nodes in a circle around center for smoother initial layout
    const centerNode = graphData.nodes.find(n => n.isCenter)
    const otherNodes = graphData.nodes.filter(n => !n.isCenter)
    const radius = Math.min(width, height) * 0.3
    
    // Place center node at center
    if (centerNode) {
      centerNode.x = width / 2
      centerNode.y = height / 2
    }
    
    // Arrange other nodes in a circle
    otherNodes.forEach((node, i) => {
      const angle = (2 * Math.PI * i) / otherNodes.length - Math.PI / 2
      node.x = width / 2 + radius * Math.cos(angle)
      node.y = height / 2 + radius * Math.sin(angle)
    })

    // Draw the current highlight: colour and strength per line, dimming per
    // poster. Positions are not touched, so a highlight never moves anything.
    const applyHighlight = (animate: boolean) => {
      const current = highlightRef.current
      const lit = litNodeIds(graphData.nodes, graphData.edges, current)
      // A zero-length transition when drawing for the first time: one code path,
      // and it lands before the graph fades in.
      const duration = animate ? 180 : 0
      edges
        .transition()
        .duration(duration)
        .attr('stroke', (d) => CONNECTION_COLORS[edgeColorType(d.reasons, current)])
        .attr('stroke-opacity', (d) => edgeOpacity(d))
      nodes
        .transition()
        .duration(duration)
        .style('opacity', (d) => (lit === null || lit.has(d.id) ? 1 : DIMMED_NODE_OPACITY))
    }
    applyHighlight(false)
    applyHighlightRef.current = applyHighlight

    // Start with container hidden, fade in after initial settling
    container.style('opacity', 0)
    
    // Create simulation with gentler initial energy
    const simulation = d3
      .forceSimulation<GraphNode>(graphData.nodes)
      .alpha(0.4) // Start with lower energy (default is 1)
      .alphaDecay(0.02) // Slightly faster settling
      .velocityDecay(0.4) // More friction for smoother movement
      .force(
        'link',
        d3
          .forceLink<GraphNode, GraphEdge>(graphData.edges)
          .id((d) => d.id)
          .distance((d) => {
            // Moderate distance between nodes (200-300 range)
            return 300 - d.similarity * 100
          })
          .strength((d) => d.similarity * 0.4)
      )
      .force('charge', d3.forceManyBody().strength(-650))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('x', d3.forceX<GraphNode>(width / 2).strength(CENTRE_PULL))
      .force('y', d3.forceY<GraphNode>(height / 2).strength(CENTRE_PULL))
      .force('collision', d3.forceCollide().radius((d) => {
        const gn = d as GraphNode
        const nodeW = gn.isCenter ? centerNodeWidth : (gn.isPrimary ? primaryNodeWidth : nodeWidth)
        return nodeW / 2 + 50
      }))

    simulationRef.current = simulation

    const drawPositions = () => {
      edges
        .attr('x1', (d) => (d.source as GraphNode).x || 0)
        .attr('y1', (d) => (d.source as GraphNode).y || 0)
        .attr('x2', (d) => (d.target as GraphNode).x || 0)
        .attr('y2', (d) => (d.target as GraphNode).y || 0)

      nodes.attr('transform', (d) => `translate(${d.x || 0},${d.y || 0})`)
    }

    /**
     * Zoom and pan so every poster is on screen, never past natural size (a
     * small graph stays at 100% rather than being blown up). Skipped once the
     * viewer has zoomed or panned.
     */
    const fitToView = (duration: number) => {
      if (viewerMovedView) return
      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      for (const node of graphData.nodes) {
        if (node.x === undefined || node.y === undefined) continue
        const halfWidth = getNodeWidth(node) / 2
        minX = Math.min(minX, node.x - halfWidth)
        maxX = Math.max(maxX, node.x + halfWidth)
        minY = Math.min(minY, node.y - getNodeHeight(node) / 2)
        maxY = Math.max(maxY, node.y + getNodeHeight(node) / 2 + getNodeTitleHeight(node))
      }
      if (!Number.isFinite(minX)) return
      const boxWidth = maxX - minX + FIT_PADDING * 2
      const boxHeight = maxY - minY + FIT_PADDING * 2
      const scale = Math.max(MIN_ZOOM, Math.min(1, width / boxWidth, height / boxHeight))
      const target = d3.zoomIdentity
        .translate(width / 2, height / 2)
        .scale(scale)
        .translate(-(minX + maxX) / 2, -(minY + maxY) / 2)
      if (duration > 0) svg.transition().duration(duration).call(zoom.transform, target)
      else svg.call(zoom.transform, target)
    }

    // Most of the settling happens before the first paint, so the graph
    // appears nearly in place and already fitted instead of drifting in from
    // its starting circle. Manual ticks dispatch no tick event, hence the draw.
    simulation.tick(PRESETTLE_TICKS)
    drawPositions()
    fitToView(0)

    // Fade in after brief settling period
    const fadeTimer = setTimeout(() => {
      container.transition().duration(400).style('opacity', 1)
    }, 150)

    simulation.on('tick', drawPositions)

    // Fit again once settled, gently: the last of the settling can still move
    // the edges of the graph. Once only, so dragging a poster later (which
    // reheats the simulation) never moves the camera under the viewer.
    let settledFitDone = false
    simulation.on('end', () => {
      if (settledFitDone) return
      settledFitDone = true
      fitToView(400)
    })

    return () => {
      cancelLongPress()
      clearTimeout(fadeTimer)
      simulation.stop()
      applyHighlightRef.current = null
    }
  }, [dataKey, dimensions, compact, t])

  // A new highlight restyles what is already drawn and moves nothing.
  useEffect(() => {
    highlightRef.current = highlight
    applyHighlightRef.current?.(true)
  }, [highlight])

  if (loading) {
    return (
      <Box
        ref={containerRef}
        sx={{
          width: '100%',
          height: compact ? 550 : '100%',
          // A phone's pane is shorter than 600px, and a floor taller than the
          // container clipped the SVG and centred the graph off screen.
          minHeight: compact ? 550 : { xs: 0, md: 600 },
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 2,
          bgcolor: '#0f0f1a',
          borderRadius: 2,
        }}
      >
        {/* Progress indicator */}
        <Box sx={{ position: 'relative', display: 'inline-flex' }}>
          {loadingStatus?.progress !== undefined ? (
            <>
              <CircularProgress
                variant="determinate"
                value={loadingStatus.progress}
                size={60}
                thickness={4}
                sx={{ color: 'primary.main' }}
              />
              <Box
                sx={{
                  top: 0,
                  left: 0,
                  bottom: 0,
                  right: 0,
                  position: 'absolute',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Typography variant="caption" color="text.secondary" fontWeight={600}>
                  {Math.round(loadingStatus.progress)}%
                </Typography>
              </Box>
            </>
          ) : (
            <CircularProgress size={60} thickness={4} />
          )}
        </Box>

        {/* Phase message */}
        <Typography
          variant="body1"
          color="text.primary"
          fontWeight={500}
          sx={{ textAlign: 'center' }}
        >
          {loadingStatus?.message || t('similarityGraph.loadingFallback')}
        </Typography>

        {/* Detail message (e.g., current validation being checked) */}
        {loadingStatus?.detail && (
          <Fade in={true} key={loadingStatus.detail}>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{
                textAlign: 'center',
                maxWidth: 300,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {loadingStatus.detail}
            </Typography>
          </Fade>
        )}

        {/* Phase indicator chips */}
        <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
          <Chip
            label={t('similarityGraph.phaseFetch')}
            size="small"
            color={loadingStatus?.phase === 'fetching' ? 'primary' : 'default'}
            variant={loadingStatus?.phase === 'fetching' ? 'filled' : 'outlined'}
            sx={{ 
              opacity: loadingStatus?.phase === 'fetching' ? 1 : 0.5,
              transition: 'all 0.3s ease',
            }}
          />
          <Chip
            label={t('similarityGraph.phaseValidate')}
            size="small"
            color={loadingStatus?.phase === 'validating' ? 'primary' : 'default'}
            variant={loadingStatus?.phase === 'validating' ? 'filled' : 'outlined'}
            sx={{ 
              opacity: loadingStatus?.phase === 'validating' ? 1 : 0.5,
              transition: 'all 0.3s ease',
            }}
          />
          <Chip
            label={t('similarityGraph.phaseBuild')}
            size="small"
            color={loadingStatus?.phase === 'building' ? 'primary' : 'default'}
            variant={loadingStatus?.phase === 'building' ? 'filled' : 'outlined'}
            sx={{ 
              opacity: loadingStatus?.phase === 'building' ? 1 : 0.5,
              transition: 'all 0.3s ease',
            }}
          />
        </Stack>
      </Box>
    )
  }

  if (!data || data.nodes.length === 0) {
    return (
      <Box
        ref={containerRef}
        sx={{
          width: '100%',
          height: compact ? 550 : '100%',
          // A phone's pane is shorter than 600px, and a floor taller than the
          // container clipped the SVG and centred the graph off screen.
          minHeight: compact ? 550 : { xs: 0, md: 600 },
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: '#0f0f1a',
          borderRadius: 2,
        }}
      >
        <Typography color="text.secondary">{t('similarityGraph.empty')}</Typography>
      </Box>
    )
  }

  return (
    <Box
      ref={containerRef}
      sx={{
        width: '100%',
        height: compact ? 550 : '100%',
        // A phone's pane is shorter than 600px, and a floor taller than the
          // container clipped the SVG and centred the graph off screen.
          minHeight: compact ? 550 : { xs: 0, md: 600 },
        position: 'relative',
        bgcolor: '#0f0f1a',
        borderRadius: 2,
        overflow: 'hidden',
      }}
    >
      <svg
        ref={svgRef}
        width={dimensions.width}
        height={dimensions.height}
        style={{ display: 'block' }}
      />

      {/* Rich tooltip for nodes showing connection reasons */}
      <Fade in={Boolean(hoveredNode)}>
        <Box
          sx={{
            position: 'absolute',
            bottom: 16,
            left: 16,
            bgcolor: 'rgba(10,10,20,0.95)',
            borderRadius: 2,
            p: 2,
            maxWidth: 'min(380px, calc(100% - 32px))',
            maxHeight: 300,
            overflowY: 'auto',
            pointerEvents: 'none',
            border: '1px solid rgba(139,92,246,0.3)',
            backdropFilter: 'blur(8px)',
          }}
        >
          {hoveredNode && (() => {
            const connectionInfo = nodeConnectionMap.get(hoveredNode.id)
            const connections = connectionInfo?.connections || []
            
            // Group all reasons by type
            const allReasons = connections.flatMap(c => c.reasons)
            const reasonsByType = allReasons.reduce((acc, reason) => {
              if (!acc[reason.type]) acc[reason.type] = new Set<string>()
              if (reason.value) acc[reason.type].add(reason.value)
              return acc
            }, {} as Record<string, Set<string>>)
            
            return (
              <>
                <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 0.5 }}>
                  {hoveredNode.title}
                </Typography>
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.5 }}>
                  {hoveredNode.year} •{' '}
                  {hoveredNode.type === 'movie'
                    ? t('similarityGraph.movie')
                    : t('similarityGraph.series')}
                </Typography>
                
                {hoveredNode.isCenter ? (
                  <Typography variant="caption" color="primary.light">
                    {t('similarityGraph.centerNode', { count: connections.length })}
                  </Typography>
                ) : connections.length > 0 ? (
                  <Box>
                    <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
                      {t('similarityGraph.connectedVia')}
                    </Typography>
                    <Stack spacing={1}>
                      {Object.entries(reasonsByType).map(([type, values]) => (
                        <Box key={type}>
                          <Chip
                            size="small"
                            label={connectionTypeLabel(type as ConnectionType, t)}
                            sx={{
                              bgcolor: CONNECTION_COLORS[type as keyof typeof CONNECTION_COLORS] || '#666',
                              color: '#fff',
                              fontSize: '10px',
                              height: 20,
                              mr: 0.5,
                              mb: 0.5,
                            }}
                          />
                          {values.size > 0 && (
                            <Typography variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>
                              {Array.from(values).slice(0, 3).join(', ')}
                              {values.size > 3 &&
                                ` ${t('similarityGraph.moreCount', { count: values.size - 3 })}`}
                            </Typography>
                          )}
                        </Box>
                      ))}
                    </Stack>
                  </Box>
                ) : (
                  <Typography variant="caption" color="text.secondary">
                    {t('similarityGraph.noDirectConnections')}
                  </Typography>
                )}
              </>
            )
          })()}
        </Box>
      </Fade>

      {/* Hover tooltip for edges */}
      <Fade in={Boolean(hoveredEdge)}>
        <Box
          sx={{
            position: 'absolute',
            bottom: 16,
            right: 16,
            bgcolor: 'rgba(0,0,0,0.9)',
            borderRadius: 1,
            p: 1.5,
            maxWidth: 300,
            pointerEvents: 'none',
          }}
        >
          {hoveredEdge && (
            <>
              <Typography variant="subtitle2" fontWeight={600}>
                {t('similarityGraph.percentSimilar', {
                  pct: Math.round(hoveredEdge.similarity * 100),
                })}
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                {hoveredEdge.reasons.map((reason, idx) => (
                  <Box
                    key={idx}
                    sx={{
                      px: 1,
                      py: 0.25,
                      borderRadius: 1,
                      bgcolor: CONNECTION_COLORS[reason.type],
                      color: '#fff',
                      fontSize: '10px',
                    }}
                  >
                    {connectionTypeLabel(reason.type, t)}
                    {reason.value && `: ${reason.value}`}
                  </Box>
                ))}
              </Box>
            </>
          )}
        </Box>
      </Fade>
    </Box>
  )
})

function truncateTitle(title: string, maxLength: number): string {
  if (title.length <= maxLength) return title
  return title.slice(0, maxLength - 1) + '…'
}

