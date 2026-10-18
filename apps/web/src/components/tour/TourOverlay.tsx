import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import {
  alpha,
  Box,
  Popper,
  Portal,
  Unstable_TrapFocus as FocusTrap,
  useMediaQuery,
  useTheme,
} from '@mui/material'
import { useUserHelp } from '@/hooks/useUserHelp'
import { useOnboarding } from '@/hooks/useOnboarding'
import { useTour } from '@/hooks/useTour'
import { type TourPlacement } from './tours'
import { CARD_SURFACE, StepCard, WelcomeCard } from './TourCard'
import { findTourAnchor } from './anchors'

/** Space between the element and the edge of the light around it. */
const SPOTLIGHT_PADDING = 6
/** How long a step waits for its element to appear (a lazy section, a new route) before showing centred. */
const ANCHOR_WAIT_MS = 1200
/** The page behind the tour. */
const DIM = 'rgba(6,6,10,0.72)'
/** Size of the pointer from the card toward the element. */
const ARROW = 14

interface Rect {
  top: number
  left: number
  width: number
  height: number
}

function sameRect(a: Rect | null, b: Rect | null): boolean {
  if (!a || !b) return a === b
  return a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height
}

/**
 * A physical side as written for the RTL style plugin. In a right-to-left
 * language the app's emotion cache runs stylis-plugin-rtl, which swaps every
 * left and right it is handed; a side that must stay physical (the edge of
 * the card facing the element) is therefore written as its mirror there, so
 * the plugin swaps it back. Positions from getBoundingClientRect are physical
 * too, and go in inline `style`, which the plugin never sees.
 */
function physical(side: 'left' | 'right', rtl: boolean): 'left' | 'right' {
  if (!rtl) return side
  return side === 'left' ? 'right' : 'left'
}

function borderWidthKey(side: 'left' | 'right' | 'top' | 'bottom'): string {
  return `border${side[0].toUpperCase()}${side.slice(1)}Width`
}

/** A placement flipped for right-to-left: the sidebar is on the right there. */
function logicalPlacement(placement: TourPlacement, rtl: boolean): TourPlacement {
  if (!rtl) return placement
  if (placement === 'left') return 'right'
  if (placement === 'right') return 'left'
  return placement
}

/**
 * Draws the running tour: the page dimmed with a cut-out around the element a
 * step points at, and a card beside it. With no element on screen the card
 * sits in the middle with the same words.
 *
 * It steps aside (draws nothing, keeps its place) while the guide drawer or
 * the "How picks are made" explainer is open, because a step's own links open
 * them, and comes back on the same step when they close.
 */
export function TourOverlay() {
  const theme = useTheme()
  const location = useLocation()
  const { active, next, back, skip } = useTour()
  const { openHelp, isOpen: helpOpen } = useUserHelp()
  const { showRecommenderExplainer, explainerOpen } = useOnboarding()
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  // Keyboard hints only where there is likely a keyboard.
  const finePointer = useMediaQuery('(hover: hover) and (pointer: fine)')
  const [arrowEl, setArrowEl] = useState<HTMLElement | null>(null)
  const rtl = theme.direction === 'rtl'
  const titleId = useId()
  const bodyId = useId()
  const maskId = useId().replace(/:/g, '')
  const cardRef = useRef<HTMLDivElement>(null)
  const [rect, setRect] = useState<Rect | null>(null)
  /** The step has looked for its element and given up: show it centred. */
  const [settled, setSettled] = useState(false)

  const step = active ? active.steps[active.index] : null
  const hidden = helpOpen || explainerOpen
  const startPath = useRef<string | null>(null)

  // A screen tour belongs to the screen it started on; leaving it ends the
  // tour. The welcome tour points at the app's own chrome, which every screen
  // has, so it survives a navigation.
  useEffect(() => {
    if (!active) {
      startPath.current = null
      return
    }
    if (startPath.current === null) startPath.current = location.pathname
    else if (active.id !== 'welcome' && location.pathname !== startPath.current) skip()
  }, [active, location.pathname, skip])

  // Follow the element. Finding it polls once a frame, for at most
  // ANCHOR_WAIT_MS, because it may mount late (a lazy section, a list still
  // loading). Once found it is measured only when something could move it —
  // a scroll anywhere, a window resize, a size change of the element or of
  // the page — instead of a selector query and a layout read on every frame
  // for as long as the step is open. An element React replaced, or one that
  // stopped showing, sends it back to finding.
  useEffect(() => {
    setRect(null)
    setSettled(false)
    if (!step || hidden) return
    const anchor = step.anchor
    if (!anchor) {
      setSettled(true)
      return
    }
    let frame = 0
    let element: HTMLElement | null = null
    let observer: ResizeObserver | null = null
    let scrolled = false
    let last: Rect | null = null

    function clearRect() {
      if (last) {
        last = null
        setRect(null)
      }
    }

    function detach() {
      observer?.disconnect()
      observer = null
      window.removeEventListener('scroll', onMove, true)
      window.removeEventListener('resize', onMove)
      element = null
    }

    function measure() {
      if (!element) return
      const box = element.getBoundingClientRect()
      if (!element.isConnected || box.width <= 0 || box.height <= 0) {
        detach()
        clearRect()
        find()
        return
      }
      const current = { top: box.top, left: box.left, width: box.width, height: box.height }
      if (!sameRect(current, last)) {
        last = current
        setRect(current)
      }
    }

    function onMove() {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(measure)
    }

    function attach(found: HTMLElement) {
      element = found
      if (!scrolled) {
        scrolled = true
        const box = found.getBoundingClientRect()
        if (box.top < 0 || box.bottom > window.innerHeight) {
          found.scrollIntoView({ block: 'center', behavior: reducedMotion ? 'auto' : 'smooth' })
        }
      }
      observer = new ResizeObserver(onMove)
      observer.observe(found)
      observer.observe(document.body)
      window.addEventListener('scroll', onMove, { capture: true, passive: true })
      window.addEventListener('resize', onMove)
      measure()
      setSettled(true)
    }

    function find() {
      const started = performance.now()
      const tick = () => {
        const found = findTourAnchor(anchor!)
        if (found) {
          attach(found)
          return
        }
        // Gave up: the step shows centred, with the same words.
        if (performance.now() - started > ANCHOR_WAIT_MS) {
          setSettled(true)
          return
        }
        frame = requestAnimationFrame(tick)
      }
      frame = requestAnimationFrame(tick)
    }

    find()
    return () => {
      cancelAnimationFrame(frame)
      detach()
    }
  }, [step, hidden, reducedMotion])

  // The card takes focus on every step, so a screen reader reads the step and
  // the keyboard is already inside it.
  useEffect(() => {
    if (settled && !hidden) cardRef.current?.focus()
  }, [settled, hidden, active?.index])

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        skip()
        return
      }
      const forward = rtl ? 'ArrowLeft' : 'ArrowRight'
      const backward = rtl ? 'ArrowRight' : 'ArrowLeft'
      if (event.key === forward) {
        event.preventDefault()
        next()
      } else if (event.key === backward) {
        event.preventDefault()
        back()
      }
    },
    [back, next, rtl, skip]
  )

  const spotlight = useMemo(() => {
    if (!rect) return null
    return {
      top: rect.top - SPOTLIGHT_PADDING,
      left: rect.left - SPOTLIGHT_PADDING,
      width: rect.width + SPOTLIGHT_PADDING * 2,
      height: rect.height + SPOTLIGHT_PADDING * 2,
    }
  }, [rect])

  // One anchor object for the whole tour, reading the latest rect, and an
  // explicit re-position when it moves. A new anchor (or a new modifiers
  // array) on every render made MUI's Popper tear popper.js down and build it
  // again on every scroll.
  const spotlightRef = useRef(spotlight)
  const popperInstance = useRef<{ forceUpdate: () => void } | null>(null)
  const setPopperInstance = useCallback((instance: { forceUpdate: () => void } | null) => {
    popperInstance.current = instance
  }, [])
  const virtualAnchor = useMemo(
    () => ({
      getBoundingClientRect: () => {
        const box = spotlightRef.current ?? { left: 0, top: 0, width: 0, height: 0 }
        return DOMRect.fromRect({ x: box.left, y: box.top, width: box.width, height: box.height })
      },
    }),
    []
  )
  useLayoutEffect(() => {
    spotlightRef.current = spotlight
    popperInstance.current?.forceUpdate()
  }, [spotlight])

  const zIndex = theme.zIndex.tooltip + 1
  const popperSx = useMemo(() => {
    const towardLeft = physical('left', rtl)
    const towardRight = physical('right', rtl)
    const edge = -ARROW / 2 - 1
    return {
      zIndex: zIndex + 1,
      '&[data-popper-placement^="right"] .tour-arrow': { [towardLeft]: edge, [borderWidthKey(towardLeft)]: 1, borderBottomWidth: 1 },
      '&[data-popper-placement^="left"] .tour-arrow': { [towardRight]: edge, borderTopWidth: 1, [borderWidthKey(towardRight)]: 1 },
      '&[data-popper-placement^="bottom"] .tour-arrow': { top: edge, borderTopWidth: 1, [borderWidthKey(towardLeft)]: 1 },
      '&[data-popper-placement^="top"] .tour-arrow': { bottom: edge, borderBottomWidth: 1, [borderWidthKey(towardRight)]: 1 },
    }
  }, [rtl, zIndex])
  const modifiers = useMemo(
    () => [
      { name: 'offset', options: { offset: [0, 16] } },
      { name: 'flip', options: { padding: 12 } },
      { name: 'preventOverflow', options: { padding: 12, altAxis: true } },
      { name: 'arrow', enabled: Boolean(arrowEl), options: { element: arrowEl, padding: 16 } },
    ],
    [arrowEl]
  )

  if (!active || !step || hidden || !settled) return null

  const isWelcomeIntro = active.id === 'welcome' && active.index === 0
  const common = {
    tour: active.id,
    step,
    index: active.index,
    total: active.steps.length,
    titleId,
    bodyId,
    rtl,
    onKeyDown,
    onNext: next,
    onBack: back,
    onSkip: skip,
    onReadMore: step.doc ? () => openHelp([step.doc!.slug], { anchor: step.doc!.anchor }) : undefined,
    onExplainer: step.action === 'recommenderExplainer' ? showRecommenderExplainer : undefined,
  }

  // The pointer sits on the card's edge facing the element: the arrow
  // modifier places it along that edge, the placement says which edge.
  const arrow = spotlight ? (
    <Box
      ref={setArrowEl}
      className="tour-arrow"
      aria-hidden="true"
      sx={{
        position: 'absolute',
        width: ARROW,
        height: ARROW,
        bgcolor: CARD_SURFACE,
        borderStyle: 'solid',
        borderWidth: 0,
        borderColor: alpha(theme.palette.text.primary, 0.1),
        transform: 'rotate(45deg)',
      }}
    />
  ) : undefined

  const card = isWelcomeIntro ? (
    <FocusTrap open isEnabled={() => true}>
      <WelcomeCard ref={cardRef} {...common} showKeys={finePointer} />
    </FocusTrap>
  ) : (
    <FocusTrap open isEnabled={() => true}>
      <StepCard ref={cardRef} {...common} arrow={arrow} />
    </FocusTrap>
  )

  return (
    <Portal>
      {/* The dimmed page. It takes the clicks, so the tour is not walked
          through by accident by clicking what it points at. */}
      <Box sx={{ position: 'fixed', inset: 0, zIndex }} aria-hidden="true">
        <svg width="100%" height="100%" style={{ display: 'block' }}>
          <defs>
            <mask id={maskId}>
              <rect width="100%" height="100%" fill="white" />
              {spotlight && (
                <rect
                  x={spotlight.left}
                  y={spotlight.top}
                  width={spotlight.width}
                  height={spotlight.height}
                  rx={10}
                  fill="black"
                />
              )}
            </mask>
          </defs>
          <rect width="100%" height="100%" fill={DIM} mask={`url(#${maskId})`} />
        </svg>
        {spotlight && (
          <Box
            // Physical viewport coordinates, so inline: the RTL style plugin
            // would turn an sx `left` into `right` and mirror the ring away
            // from the cut-out, which the SVG mask draws by attribute.
            style={{ top: spotlight.top, left: spotlight.left, width: spotlight.width, height: spotlight.height }}
            sx={{
              position: 'fixed',
              borderRadius: '10px',
              border: 2,
              borderColor: 'primary.main',
              // A soft halo, so the eye finds the element before the card.
              boxShadow: `0 0 0 6px ${alpha(theme.palette.primary.main, 0.25)}, 0 0 32px ${alpha(theme.palette.primary.main, 0.35)}`,
              pointerEvents: 'none',
              transition: reducedMotion ? 'none' : 'top 0.2s ease, left 0.2s ease, width 0.2s ease, height 0.2s ease',
            }}
          />
        )}
      </Box>

      {spotlight ? (
        <Popper
          open
          anchorEl={virtualAnchor}
          popperRef={setPopperInstance}
          placement={logicalPlacement(step.placement ?? 'bottom', rtl)}
          sx={popperSx}
          modifiers={modifiers}
        >
          {card}
        </Popper>
      ) : (
        <Box
          sx={{
            position: 'fixed',
            inset: 0,
            zIndex: zIndex + 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            p: 2,
            pointerEvents: 'none',
            '& > *': { pointerEvents: 'auto' },
          }}
        >
          {card}
        </Box>
      )}
    </Portal>
  )
}
