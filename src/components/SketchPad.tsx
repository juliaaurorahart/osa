import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  cloneSketchDocument,
  type SketchDocument,
  type SketchElement,
  type SketchLayer,
  type SketchPoint,
  type SketchStroke,
} from '../graph/textNode'

const PEN_COLORS = ['#222222', '#f5a9b8', '#5bcefa', '#9b59d0', '#ff8c00'] as const
const MIN_PAGE_SIZE = 100
const MAX_PAGE_SIZE = 20_000
const MIN_ZOOM = 0.1
const MAX_ZOOM = 8

/** The small, portable tool set stored on every Visual canvas. */
type SketchTool = 'select' | 'pen' | 'rectangle' | 'ellipse' | 'arrow' | 'text' | 'eraser' | 'pan'

type SketchPadProps = {
  document: SketchDocument
  onChange: (document: SketchDocument) => void
  /** Optional source photo, slide, or render underneath the editable marks. */
  backgroundImage?: string
  /** Lets an embedded editor name the same canvas more precisely. */
  ariaLabel?: string
  /** Notebook sketches begin with a pen; Visual canvases begin in selection. */
  initialTool?: SketchTool
}

type PanState = {
  pointerId: number
  x: number
  y: number
  scrollLeft: number
  scrollTop: number
} | null

type TouchPoint = { x: number; y: number }

type PinchState = {
  pointerIds: [number, number]
  startDistance: number
  startZoom: number
  worldX: number
  worldY: number
}

type ActiveElementInteraction = {
  pointerId: number
  layerId: string
  element: SketchElement
  original: SketchElement | null
  startPoint: SketchPoint
  mode: 'create' | 'move' | 'resize'
}

type ElementBounds = { x: number; y: number; width: number; height: number }

function replaceLayer(
  document: SketchDocument,
  layerId: string,
  update: (layer: SketchLayer) => SketchLayer,
): SketchDocument {
  return {
    ...document,
    layers: document.layers.map((layer) => layer.id === layerId ? update(layer) : layer),
  }
}

function visibleLayers(document: SketchDocument) {
  return document.layers.filter((layer) => layer.visible)
}

function elementBounds(element: SketchElement): ElementBounds {
  if (element.kind === 'arrow') {
    return {
      x: Math.min(element.x, element.x + element.width),
      y: Math.min(element.y, element.y + element.height),
      width: Math.abs(element.width),
      height: Math.abs(element.height),
    }
  }
  return {
    x: element.x,
    y: element.y,
    width: element.width,
    height: element.height,
  }
}

function normalizedBox(start: SketchPoint, end: SketchPoint): ElementBounds {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  }
}

function createElement(
  kind: Exclude<SketchElement['kind'], 'text'>,
  start: SketchPoint,
  end: SketchPoint,
  color: string,
  strokeWidth: number,
  opacity: number,
): SketchElement {
  const box = normalizedBox(start, end)
  return {
    id: crypto.randomUUID(),
    kind,
    // Arrows retain their signed vector so they can point left/up as well as
    // right/down. Everything else uses a normalized drawing box.
    x: kind === 'arrow' ? start.x : box.x,
    y: kind === 'arrow' ? start.y : box.y,
    width: kind === 'arrow' ? end.x - start.x : box.width,
    height: kind === 'arrow' ? end.y - start.y : box.height,
    stroke: color,
    fill: 'transparent',
    strokeWidth,
    opacity,
  }
}

function SketchElementGraphic({
  element,
  interactive = false,
  selected = false,
  onPointerDown,
}: {
  element: SketchElement
  interactive?: boolean
  selected?: boolean
  onPointerDown?: (event: ReactPointerEvent<SVGGElement>) => void
}) {
  const bounds = elementBounds(element)
  const hitStroke = Math.max(16, element.strokeWidth + 10)
  const text = element.text ?? 'Text'

  return (
    <g
      className={selected ? 'sketch-element is-selected' : 'sketch-element'}
      data-sketch-element-id={element.id}
      opacity={element.opacity}
      pointerEvents={interactive ? 'all' : 'none'}
      onPointerDown={onPointerDown}
    >
      {element.kind === 'rectangle' ? (
        <>
          <rect
            x={element.x}
            y={element.y}
            width={element.width}
            height={element.height}
            fill={element.fill}
            stroke={element.stroke}
            strokeWidth={element.strokeWidth}
          />
          {interactive ? (
            <rect
              x={element.x}
              y={element.y}
              width={element.width}
              height={element.height}
              fill="transparent"
              stroke="transparent"
              strokeWidth={hitStroke}
            />
          ) : null}
        </>
      ) : null}
      {element.kind === 'ellipse' ? (
        <>
          <ellipse
            cx={element.x + element.width / 2}
            cy={element.y + element.height / 2}
            rx={element.width / 2}
            ry={element.height / 2}
            fill={element.fill}
            stroke={element.stroke}
            strokeWidth={element.strokeWidth}
          />
          {interactive ? (
            <ellipse
              cx={element.x + element.width / 2}
              cy={element.y + element.height / 2}
              rx={Math.max(element.width / 2, hitStroke / 2)}
              ry={Math.max(element.height / 2, hitStroke / 2)}
              fill="transparent"
              stroke="transparent"
              strokeWidth={hitStroke}
            />
          ) : null}
        </>
      ) : null}
      {element.kind === 'arrow' ? (
        <>
          <defs>
            <marker
              id={`sketch-arrow-head-${element.id}`}
              markerWidth="10"
              markerHeight="8"
              refX="9"
              refY="4"
              orient="auto"
              markerUnits="strokeWidth"
            >
              <path d="M 0 0 L 10 4 L 0 8 z" fill={element.stroke} />
            </marker>
          </defs>
          <line
            x1={element.x}
            y1={element.y}
            x2={element.x + element.width}
            y2={element.y + element.height}
            fill="none"
            stroke={element.stroke}
            strokeWidth={element.strokeWidth}
            strokeLinecap="round"
            markerEnd={`url(#sketch-arrow-head-${element.id})`}
          />
          {interactive ? (
            <line
              x1={element.x}
              y1={element.y}
              x2={element.x + element.width}
              y2={element.y + element.height}
              fill="none"
              stroke="transparent"
              strokeWidth={hitStroke}
              strokeLinecap="round"
            />
          ) : null}
        </>
      ) : null}
      {element.kind === 'text' ? (
        <>
          <rect
            x={element.x}
            y={element.y}
            width={Math.max(element.width, 30)}
            height={Math.max(element.height, 24)}
            fill="transparent"
            stroke="transparent"
            pointerEvents={interactive ? 'all' : 'none'}
          />
          <text
            x={element.x}
            y={element.y}
            fill={element.stroke}
            fontSize={element.fontSize ?? 26}
            fontFamily="inherit"
            dominantBaseline="hanging"
            pointerEvents="none"
          >
            {text}
          </text>
        </>
      ) : null}
      {selected ? (
        <rect
          className="sketch-element__selection"
          x={bounds.x - 5}
          y={bounds.y - 5}
          width={Math.max(bounds.width + 10, 16)}
          height={Math.max(bounds.height + 10, 16)}
          fill="none"
          stroke="#26799b"
          strokeWidth={2}
          strokeDasharray="7 5"
          pointerEvents="none"
        />
      ) : null}
    </g>
  )
}

function Stroke({
  stroke,
  erase,
  onErase,
}: {
  stroke: SketchStroke
  erase: boolean
  onErase?: (event: ReactPointerEvent<SVGElement>) => void
}) {
  const points = stroke.points.map((point) => `${point.x},${point.y}`).join(' ')
  const pressureWidth = (pressure = 0.5) => (
    stroke.width * (0.35 + 1.3 * Math.min(Math.max(pressure, 0), 1))
  )
  const pressureVaries = stroke.points.some((point) => (
    point.pressure !== undefined && Math.abs(point.pressure - 0.5) > 0.03
  ))
  const firstPoint = stroke.points[0]

  return (
    <>
      {stroke.points.length === 1 && firstPoint ? (
        <circle
          cx={firstPoint.x}
          cy={firstPoint.y}
          r={pressureWidth(firstPoint.pressure) / 2}
          fill={stroke.color}
          fillOpacity={stroke.opacity}
          pointerEvents="none"
        />
      ) : pressureVaries ? (
        <g opacity={stroke.opacity} pointerEvents="none">
          {stroke.points.slice(1).map((point, index) => {
            const previous = stroke.points[index]
            return (
              <line
                key={`${stroke.id}-${index}`}
                x1={previous.x}
                y1={previous.y}
                x2={point.x}
                y2={point.y}
                stroke={stroke.color}
                strokeWidth={pressureWidth(((previous.pressure ?? 0.5) + (point.pressure ?? 0.5)) / 2)}
                strokeLinecap="round"
              />
            )
          })}
        </g>
      ) : (
        <polyline
          points={points}
          fill="none"
          stroke={stroke.color}
          strokeWidth={stroke.width}
          strokeOpacity={stroke.opacity}
          strokeLinecap="round"
          strokeLinejoin="round"
          pointerEvents="none"
        />
      )}
      {erase ? (
        stroke.points.length === 1 && firstPoint ? (
          <circle
            cx={firstPoint.x}
            cy={firstPoint.y}
            r={Math.max(7, stroke.width / 2 + 4)}
            fill="transparent"
            pointerEvents="all"
            onPointerDown={onErase}
          />
        ) : (
          <polyline
            points={points}
            fill="none"
            stroke="transparent"
            strokeWidth={Math.max(14, stroke.width + 8)}
            strokeLinecap="round"
            strokeLinejoin="round"
            pointerEvents="stroke"
            onPointerDown={onErase}
          />
        )
      ) : null}
    </>
  )
}

export function SketchPreview({
  document,
  height,
  backgroundImage,
  ariaLabel = 'Sketch preview',
  className,
}: {
  document: SketchDocument
  height?: number | string
  backgroundImage?: string
  ariaLabel?: string
  className?: string
}) {
  return (
    <svg
      className={className ? `sketch-preview ${className}` : 'sketch-preview'}
      viewBox={`0 0 ${document.width} ${document.height}`}
      aria-label={ariaLabel}
      style={height === undefined ? undefined : { height }}
    >
      <rect width={document.width} height={document.height} fill={document.background} />
      {backgroundImage ? (
        <image
          href={backgroundImage}
          x={0}
          y={0}
          width={document.width}
          height={document.height}
          preserveAspectRatio="xMidYMid meet"
        />
      ) : null}
      {visibleLayers(document).flatMap((layer) => [
        ...layer.elements.map((element) => (
          <SketchElementGraphic key={element.id} element={element} />
        )),
        ...layer.strokes.map((stroke) => (
          <Stroke key={stroke.id} stroke={stroke} erase={false} />
        )),
      ])}
    </svg>
  )
}

export function SketchPad({
  document,
  onChange,
  backgroundImage,
  ariaLabel = 'Drawing page',
  initialTool = 'pen',
}: SketchPadProps) {
  const [tool, setTool] = useState<SketchTool>(initialTool)
  const [color, setColor] = useState<string>(PEN_COLORS[0])
  const [brushWidth, setBrushWidth] = useState(4)
  const [opacity, setOpacity] = useState(1)
  const [zoom, setZoom] = useState(0.75)
  const [activeStroke, setActiveStroke] = useState<SketchStroke | null>(null)
  const [activeStrokeLayerId, setActiveStrokeLayerId] = useState<string | null>(null)
  const [activeElement, setActiveElement] = useState<ActiveElementInteraction | null>(null)
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null)
  const [activeLayerId, setActiveLayerId] = useState(document.layers.at(-1)?.id ?? '')
  const [historyState, setHistoryState] = useState({ undo: 0, redo: 0 })
  const undoStack = useRef<SketchDocument[]>([])
  const redoStack = useRef<SketchDocument[]>([])
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const surfaceRef = useRef<SVGSVGElement | null>(null)
  const panState = useRef<PanState>(null)
  const activeStrokeRef = useRef<SketchStroke | null>(null)
  const activeStrokePointerIdRef = useRef<number | null>(null)
  const activeStrokeLayerIdRef = useRef<string | null>(null)
  const activeElementRef = useRef<ActiveElementInteraction | null>(null)
  const activePenPointerIdRef = useRef<number | null>(null)
  const ignoreTouchUntilRef = useRef(0)
  const touchPointersRef = useRef(new Map<number, TouchPoint>())
  const pinchStateRef = useRef<PinchState | null>(null)
  const pinchFrameRef = useRef<number | null>(null)
  const zoomRef = useRef(zoom)
  const activeLayer = document.layers.find((layer) => layer.id === activeLayerId)
    ?? document.layers.at(-1)
  const selectedElement = document.layers
    .flatMap((layer) => (layer.elements ?? []).map((element) => ({ layer, element })))
    .find(({ element }) => element.id === selectedElementId)

  useEffect(() => {
    zoomRef.current = zoom
  }, [zoom])

  useEffect(() => () => {
    if (pinchFrameRef.current !== null) {
      cancelAnimationFrame(pinchFrameRef.current)
    }
  }, [])

  const commit = (nextDocument: SketchDocument) => {
    undoStack.current.push(cloneSketchDocument(document))
    redoStack.current = []
    onChange(cloneSketchDocument(nextDocument))
    setHistoryState({ undo: undoStack.current.length, redo: 0 })
  }

  const undo = () => {
    const previous = undoStack.current.pop()
    if (!previous) return
    redoStack.current.push(cloneSketchDocument(document))
    onChange(previous)
    setHistoryState({ undo: undoStack.current.length, redo: redoStack.current.length })
  }

  const redo = () => {
    const next = redoStack.current.pop()
    if (!next) return
    undoStack.current.push(cloneSketchDocument(document))
    onChange(next)
    setHistoryState({ undo: undoStack.current.length, redo: redoStack.current.length })
  }

  const pointFromPointer = (
    pointer: globalThis.PointerEvent,
    bounds: DOMRect,
  ): SketchPoint => {
    const pressure = pointer.pointerType === 'pen' && pointer.pressure > 0
      ? Math.min(Math.max(pointer.pressure, 0), 1)
      : 0.5
    return {
      x: (pointer.clientX - bounds.left) * document.width / bounds.width,
      y: (pointer.clientY - bounds.top) * document.height / bounds.height,
      pressure,
    }
  }

  const setPinchBaseline = () => {
    const viewport = viewportRef.current
    const points = [...touchPointersRef.current.entries()]
    if (!viewport || points.length < 2) {
      pinchStateRef.current = null
      return
    }

    const [[firstId, first], [secondId, second]] = points
    const midpointX = (first.x + second.x) / 2
    const midpointY = (first.y + second.y) / 2
    const viewportBounds = viewport.getBoundingClientRect()
    const startZoom = zoomRef.current
    pinchStateRef.current = {
      pointerIds: [firstId, secondId],
      startDistance: Math.max(1, Math.hypot(second.x - first.x, second.y - first.y)),
      startZoom,
      worldX: (viewport.scrollLeft + midpointX - viewportBounds.left) / startZoom,
      worldY: (viewport.scrollTop + midpointY - viewportBounds.top) / startZoom,
    }
  }

  const beginTouchNavigation = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (activePenPointerIdRef.current !== null || event.timeStamp < ignoreTouchUntilRef.current) {
      return
    }

    const viewport = viewportRef.current
    if (!viewport) return
    event.currentTarget.setPointerCapture(event.pointerId)
    touchPointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })

    if (touchPointersRef.current.size === 1) {
      pinchStateRef.current = null
      panState.current = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        scrollLeft: viewport.scrollLeft,
        scrollTop: viewport.scrollTop,
      }
      return
    }

    panState.current = null
    setPinchBaseline()
  }

  const continueTouchNavigation = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!touchPointersRef.current.has(event.pointerId)) return
    const viewport = viewportRef.current
    if (!viewport) return

    touchPointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (touchPointersRef.current.size === 1 && panState.current?.pointerId === event.pointerId) {
      viewport.scrollLeft = panState.current.scrollLeft - (event.clientX - panState.current.x)
      viewport.scrollTop = panState.current.scrollTop - (event.clientY - panState.current.y)
      return
    }

    const pinch = pinchStateRef.current
    if (!pinch) return
    const first = touchPointersRef.current.get(pinch.pointerIds[0])
    const second = touchPointersRef.current.get(pinch.pointerIds[1])
    if (!first || !second) {
      setPinchBaseline()
      return
    }

    const distance = Math.max(1, Math.hypot(second.x - first.x, second.y - first.y))
    const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, (
      pinch.startZoom * distance / pinch.startDistance
    )))
    const midpointX = (first.x + second.x) / 2
    const midpointY = (first.y + second.y) / 2
    const viewportBounds = viewport.getBoundingClientRect()
    zoomRef.current = nextZoom
    setZoom(nextZoom)

    if (pinchFrameRef.current !== null) cancelAnimationFrame(pinchFrameRef.current)
    pinchFrameRef.current = requestAnimationFrame(() => {
      viewport.scrollLeft = pinch.worldX * nextZoom - (midpointX - viewportBounds.left)
      viewport.scrollTop = pinch.worldY * nextZoom - (midpointY - viewportBounds.top)
      pinchFrameRef.current = null
    })
  }

  const finishTouchNavigation = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (pinchFrameRef.current !== null) {
      cancelAnimationFrame(pinchFrameRef.current)
      pinchFrameRef.current = null
    }
    touchPointersRef.current.delete(event.pointerId)
    const viewport = viewportRef.current

    if (touchPointersRef.current.size >= 2) {
      panState.current = null
      setPinchBaseline()
    } else if (touchPointersRef.current.size === 1 && viewport) {
      pinchStateRef.current = null
      const [pointerId, point] = [...touchPointersRef.current.entries()][0]
      panState.current = {
        pointerId,
        x: point.x,
        y: point.y,
        scrollLeft: viewport.scrollLeft,
        scrollTop: viewport.scrollTop,
      }
    } else {
      pinchStateRef.current = null
      panState.current = null
    }
  }

  const isObjectTool = (candidate: SketchTool) => (
    candidate === 'select'
    || candidate === 'rectangle'
    || candidate === 'ellipse'
    || candidate === 'arrow'
    || candidate === 'text'
  )

  const clearPenTouchConflict = (event: ReactPointerEvent<SVGElement>) => {
    if (event.pointerType !== 'pen') return
    activePenPointerIdRef.current = event.pointerId
    const surface = surfaceRef.current
    // Capture even a Select/Text click. Without this, lifting a Pencil just
    // outside the SVG could leave the touch-navigation guard active.
    if (surface && !surface.hasPointerCapture(event.pointerId)) {
      surface.setPointerCapture(event.pointerId)
    }
    for (const pointerId of touchPointersRef.current.keys()) {
      if (surface?.hasPointerCapture(pointerId)) surface.releasePointerCapture(pointerId)
    }
    touchPointersRef.current.clear()
    pinchStateRef.current = null
    panState.current = null
    if (pinchFrameRef.current !== null) {
      cancelAnimationFrame(pinchFrameRef.current)
      pinchFrameRef.current = null
    }
  }

  const updateActiveElement = (event: ReactPointerEvent<SVGSVGElement>) => {
    const interaction = activeElementRef.current
    if (!interaction || interaction.pointerId !== event.pointerId) return false
    const point = pointFromPointer(event.nativeEvent, event.currentTarget.getBoundingClientRect())
    const original = interaction.original
    let element = interaction.element

    if (interaction.mode === 'create') {
      element = createElement(
        interaction.element.kind as Exclude<SketchElement['kind'], 'text'>,
        interaction.startPoint,
        point,
        interaction.element.stroke,
        interaction.element.strokeWidth,
        interaction.element.opacity,
      )
      // Preserve the temporary ID while the person drags; it becomes durable
      // only on pointer-up.
      element.id = interaction.element.id
    } else if (original && interaction.mode === 'move') {
      const dx = point.x - interaction.startPoint.x
      const dy = point.y - interaction.startPoint.y
      element = { ...original, x: original.x + dx, y: original.y + dy }
    } else if (original && interaction.mode === 'resize') {
      if (original.kind === 'arrow') {
        element = {
          ...original,
          width: point.x - original.x,
          height: point.y - original.y,
        }
      } else {
        const box = normalizedBox({ x: original.x, y: original.y }, point)
        element = { ...original, ...box }
      }
    }

    const next = { ...interaction, element }
    activeElementRef.current = next
    setActiveElement(next)
    return true
  }

  const startElementInteraction = (
    event: ReactPointerEvent<SVGGElement>,
    layer: SketchLayer,
    element: SketchElement,
    mode: 'move' | 'resize',
  ) => {
    if (tool !== 'select' || layer.locked || !layer.visible) return
    event.stopPropagation()
    const surface = surfaceRef.current
    if (!surface) return
    clearPenTouchConflict(event)
    if (!surface.hasPointerCapture(event.pointerId)) surface.setPointerCapture(event.pointerId)
    const point = pointFromPointer(event.nativeEvent, surface.getBoundingClientRect())
    const interaction: ActiveElementInteraction = {
      pointerId: event.pointerId,
      layerId: layer.id,
      element: { ...element },
      original: { ...element },
      startPoint: point,
      mode,
    }
    activeElementRef.current = interaction
    setActiveElement(interaction)
    setSelectedElementId(element.id)
  }

  const beginInteraction = (event: ReactPointerEvent<SVGSVGElement>) => {
    event.stopPropagation()
    // Finger gestures remain navigation while drawing/erasing. When a person
    // deliberately picks a shape or Select, that same finger can manipulate
    // objects; Pan is always available for navigation.
    if (event.pointerType === 'touch' && !isObjectTool(tool)) {
      beginTouchNavigation(event)
      return
    }

    clearPenTouchConflict(event)

    if (tool === 'pan') {
      const viewport = viewportRef.current
      if (!viewport) return
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.setPointerCapture(event.pointerId)
      }
      panState.current = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        scrollLeft: viewport.scrollLeft,
        scrollTop: viewport.scrollTop,
      }
      return
    }

    if (tool === 'select') {
      setSelectedElementId(null)
      return
    }

    if (!activeLayer || !activeLayer.visible || activeLayer.locked) return
    const point = pointFromPointer(event.nativeEvent, event.currentTarget.getBoundingClientRect())

    if (tool === 'text') {
      const element: SketchElement = {
        id: crypto.randomUUID(),
        kind: 'text',
        x: point.x,
        y: point.y,
        width: 260,
        height: 40,
        stroke: color,
        fill: 'transparent',
        strokeWidth: brushWidth,
        opacity,
        text: 'Text',
        fontSize: 28,
      }
      commit(replaceLayer(document, activeLayer.id, (layer) => ({
        ...layer,
        elements: [...(layer.elements ?? []), element],
      })))
      setSelectedElementId(element.id)
      setTool('select')
      return
    }

    if (tool === 'rectangle' || tool === 'ellipse' || tool === 'arrow') {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.setPointerCapture(event.pointerId)
      }
      const element = createElement(tool, point, point, color, brushWidth, opacity)
      const interaction: ActiveElementInteraction = {
        pointerId: event.pointerId,
        layerId: activeLayer.id,
        element,
        original: null,
        startPoint: point,
        mode: 'create',
      }
      activeElementRef.current = interaction
      setActiveElement(interaction)
      setSelectedElementId(element.id)
      return
    }

    if (tool !== 'pen') return
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.setPointerCapture(event.pointerId)
    }
    const stroke: SketchStroke = {
      id: crypto.randomUUID(),
      color,
      width: brushWidth,
      opacity,
      coordinateSpace: 'pixels',
      points: [point],
    }
    activeStrokeRef.current = stroke
    activeStrokePointerIdRef.current = event.pointerId
    activeStrokeLayerIdRef.current = activeLayer.id
    setActiveStrokeLayerId(activeLayer.id)
    setActiveStroke(stroke)
  }

  const continueInteraction = (event: ReactPointerEvent<SVGSVGElement>) => {
    event.stopPropagation()
    if (event.pointerType === 'touch' && touchPointersRef.current.has(event.pointerId)) {
      continueTouchNavigation(event)
      return
    }

    if (updateActiveElement(event)) return

    if (panState.current?.pointerId === event.pointerId) {
      const viewport = viewportRef.current
      if (!viewport) return
      viewport.scrollLeft = panState.current.scrollLeft - (event.clientX - panState.current.x)
      viewport.scrollTop = panState.current.scrollTop - (event.clientY - panState.current.y)
      return
    }
    if (
      activeStrokePointerIdRef.current !== event.pointerId
      || !activeStrokeRef.current
      || !event.currentTarget.hasPointerCapture(event.pointerId)
    ) return

    const bounds = event.currentTarget.getBoundingClientRect()
    const nativeSamples = event.nativeEvent.getCoalescedEvents?.() ?? []
    const samples = nativeSamples.length > 0 ? nativeSamples : [event.nativeEvent]
    const points = [...activeStrokeRef.current.points]
    for (const sample of samples) {
      const point = pointFromPointer(sample, bounds)
      const previous = points.at(-1)
      if (previous && previous.x === point.x && previous.y === point.y) continue
      points.push(point)
    }
    const stroke = { ...activeStrokeRef.current, points }
    activeStrokeRef.current = stroke
    setActiveStroke(stroke)
  }

  const finishActiveElement = (
    event: ReactPointerEvent<SVGSVGElement>,
    cancelled: boolean,
  ) => {
    const interaction = activeElementRef.current
    if (!interaction || interaction.pointerId !== event.pointerId) return false
    activeElementRef.current = null
    setActiveElement(null)
    if (cancelled) return true

    const element = interaction.element
    const hasUsefulSize = element.kind === 'arrow'
      ? Math.hypot(element.width, element.height) >= 4
      : element.width >= 4 && element.height >= 4
    if (interaction.mode === 'create' && !hasUsefulSize) {
      setSelectedElementId(null)
      return true
    }
    commit(replaceLayer(document, interaction.layerId, (layer) => ({
      ...layer,
      elements: interaction.mode === 'create'
        ? [...(layer.elements ?? []), element]
        : (layer.elements ?? []).map((candidate) => candidate.id === element.id ? element : candidate),
    })))
    return true
  }

  const finishInteraction = (
    event: ReactPointerEvent<SVGSVGElement>,
    cancelled = false,
  ) => {
    event.stopPropagation()
    if (event.pointerType === 'touch' && touchPointersRef.current.has(event.pointerId)) {
      finishTouchNavigation(event)
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
      return
    }

    if (finishActiveElement(event, cancelled)) {
      if (activePenPointerIdRef.current === event.pointerId) {
        activePenPointerIdRef.current = null
        ignoreTouchUntilRef.current = event.timeStamp + 300
      }
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
      return
    }

    if (panState.current?.pointerId === event.pointerId) {
      panState.current = null
    }

    if (activeStrokePointerIdRef.current === event.pointerId) {
      const stroke = activeStrokeRef.current
      const layerId = activeStrokeLayerIdRef.current
      activeStrokeRef.current = null
      activeStrokePointerIdRef.current = null
      activeStrokeLayerIdRef.current = null
      setActiveStrokeLayerId(null)
      setActiveStroke(null)
      if (!cancelled && stroke && layerId && stroke.points.length > 0) {
        commit(replaceLayer(document, layerId, (layer) => ({
          ...layer,
          strokes: [...layer.strokes, stroke],
        })))
      }
    }

    if (activePenPointerIdRef.current === event.pointerId) {
      activePenPointerIdRef.current = null
      ignoreTouchUntilRef.current = event.timeStamp + 300
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const loseInteraction = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.pointerType === 'touch' && touchPointersRef.current.has(event.pointerId)) {
      finishTouchNavigation(event)
      return
    }
    if (finishActiveElement(event, true)) {
      if (activePenPointerIdRef.current === event.pointerId) {
        activePenPointerIdRef.current = null
        ignoreTouchUntilRef.current = event.timeStamp + 300
      }
      return
    }
    if (panState.current?.pointerId === event.pointerId) {
      panState.current = null
    }
    if (activeStrokePointerIdRef.current === event.pointerId) {
      activeStrokeRef.current = null
      activeStrokePointerIdRef.current = null
      activeStrokeLayerIdRef.current = null
      setActiveStrokeLayerId(null)
      setActiveStroke(null)
    }
    if (activePenPointerIdRef.current === event.pointerId) {
      activePenPointerIdRef.current = null
      ignoreTouchUntilRef.current = event.timeStamp + 300
    }
  }

  const eraseStroke = (layerId: string, strokeId: string) => {
    const layer = document.layers.find((candidate) => candidate.id === layerId)
    if (!layer || layer.locked) return
    commit(replaceLayer(document, layerId, (candidate) => ({
      ...candidate,
      strokes: candidate.strokes.filter((stroke) => stroke.id !== strokeId),
    })))
  }

  const updatePageSize = (dimension: 'width' | 'height', value: number) => {
    if (!Number.isFinite(value)) return
    const size = Math.max(MIN_PAGE_SIZE, Math.min(MAX_PAGE_SIZE, Math.round(value)))
    if (document[dimension] === size) return
    commit({ ...document, [dimension]: size })
  }

  const addLayer = () => {
    const layer: SketchLayer = {
      id: crypto.randomUUID(),
      name: `Layer ${document.layers.length + 1}`,
      visible: true,
      locked: false,
      elements: [],
      strokes: [],
    }
    commit({ ...document, layers: [...document.layers, layer] })
    setActiveLayerId(layer.id)
  }

  const updateLayer = (layerId: string, update: Partial<SketchLayer>) => {
    commit(replaceLayer(document, layerId, (layer) => ({ ...layer, ...update })))
  }

  const clearLayer = () => {
    if (
      !activeLayer
      || activeLayer.locked
      || (activeLayer.strokes.length === 0 && (activeLayer.elements ?? []).length === 0)
    ) return
    commit(replaceLayer(document, activeLayer.id, (layer) => ({
      ...layer,
      elements: [],
      strokes: [],
    })))
    setSelectedElementId(null)
  }

  const updateSelectedElement = (update: Partial<SketchElement>) => {
    if (!selectedElement || selectedElement.layer.locked) return
    const { layer, element } = selectedElement
    commit(replaceLayer(document, layer.id, (candidate) => ({
      ...candidate,
      elements: (candidate.elements ?? []).map((item) => (
        item.id === element.id ? { ...item, ...update } : item
      )),
    })))
  }

  const deleteSelectedElement = () => {
    if (!selectedElement || selectedElement.layer.locked) return
    commit(replaceLayer(document, selectedElement.layer.id, (layer) => ({
      ...layer,
      elements: (layer.elements ?? []).filter((element) => element.id !== selectedElement.element.id),
    })))
    setSelectedElementId(null)
  }

  const renderedLayers = document.layers.map((layer) => ({
    ...layer,
    elements: activeElement && layer.id === activeElement.layerId
      ? activeElement.mode === 'create'
        ? [...(layer.elements ?? []), activeElement.element]
        : (layer.elements ?? []).map((element) => (
          element.id === activeElement.element.id ? activeElement.element : element
        ))
      : (layer.elements ?? []),
    strokes: activeStroke && layer.id === activeStrokeLayerId
      ? [...layer.strokes, activeStroke]
      : layer.strokes,
  }))
  const selectedElementForRender = selectedElement && activeElement?.element.id === selectedElement.element.id
    ? { ...selectedElement, element: activeElement.element }
    : selectedElement
  const onSelectedElementResizePointerDown = (event: ReactPointerEvent<SVGGElement>) => {
    if (!selectedElementForRender) return
    startElementInteraction(
      event,
      selectedElementForRender.layer,
      selectedElementForRender.element,
      'resize',
    )
  }

  return (
    <div className="sketch-editor">
      <div className="sketch-editor__toolbar" aria-label="Sketch tools">
        <div className="sketch-editor__tool-group">
          {([
            ['select', 'select'],
            ['rectangle', 'box'],
            ['ellipse', 'oval'],
            ['arrow', 'arrow'],
            ['text', 'text'],
            ['pen', 'pen'],
            ['eraser', 'erase'],
            ['pan', 'pan'],
          ] as const).map(([candidate, label]) => (
            <button
              className={tool === candidate ? 'is-selected' : undefined}
              type="button"
              key={candidate}
              onClick={() => setTool(candidate)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="sketch-editor__tool-group">
          <button type="button" disabled={historyState.undo === 0} onClick={undo}>Undo</button>
          <button type="button" disabled={historyState.redo === 0} onClick={redo}>Redo</button>
        </div>
        <div className="sketch-editor__colors" aria-label="Pen colors">
          {PEN_COLORS.map((penColor) => (
            <button
              key={penColor}
              type="button"
              className={color === penColor ? 'is-selected' : undefined}
              aria-label={`Use ${penColor}`}
              style={{ color: penColor }}
              onClick={() => {
                setColor(penColor)
              }}
            />
          ))}
          <input
            type="color"
            aria-label="Custom pen color"
            value={color}
            onChange={(event) => {
              setColor(event.target.value)
            }}
          />
        </div>
        <label>
          <span>Size</span>
          <input
            type="range"
            min="1"
            max="40"
            value={brushWidth}
            onChange={(event) => setBrushWidth(Number(event.target.value))}
          />
          <output>{brushWidth}</output>
        </label>
        <label>
          <span>Opacity</span>
          <input
            type="range"
            min="0.05"
            max="1"
            step="0.05"
            value={opacity}
            onChange={(event) => setOpacity(Number(event.target.value))}
          />
          <output>{Math.round(opacity * 100)}%</output>
        </label>
      </div>

      <div className="sketch-editor__workspace">
        <div
          ref={viewportRef}
          className={`sketch-editor__viewport is-${tool}`}
        >
          <svg
            ref={surfaceRef}
            className="sketch-editor__surface"
            width={document.width * zoom}
            height={document.height * zoom}
            viewBox={`0 0 ${document.width} ${document.height}`}
            aria-label={ariaLabel}
            style={{ background: document.background }}
            onPointerDown={beginInteraction}
            onPointerMove={continueInteraction}
            onPointerUp={finishInteraction}
            onPointerCancel={(event) => finishInteraction(event, true)}
            onLostPointerCapture={loseInteraction}
          >
            <rect width={document.width} height={document.height} fill={document.background} />
            {backgroundImage ? (
              <image
                href={backgroundImage}
                x={0}
                y={0}
                width={document.width}
                height={document.height}
                preserveAspectRatio="xMidYMid meet"
                pointerEvents="none"
              />
            ) : null}
            {renderedLayers.filter((layer) => layer.visible).flatMap((layer) => [
              ...layer.elements.map((element) => (
                <SketchElementGraphic
                  key={element.id}
                  element={element}
                  interactive={tool === 'select' && !layer.locked}
                  selected={element.id === selectedElementId}
                  onPointerDown={(event) => startElementInteraction(event, layer, element, 'move')}
                />
              )),
              ...layer.strokes.map((stroke) => (
                <Stroke
                  key={stroke.id}
                  stroke={stroke}
                  erase={tool === 'eraser'}
                  onErase={(event) => {
                    if (event.pointerType === 'touch') return
                    eraseStroke(layer.id, stroke.id)
                  }}
                />
              )),
            ])}
            {tool === 'select' && selectedElementForRender && !selectedElementForRender.layer.locked ? (() => {
              const bounds = elementBounds(selectedElementForRender.element)
              return (
                <g
                  className="sketch-element__resize-handle"
                  onPointerDown={onSelectedElementResizePointerDown}
                >
                  <rect
                    x={bounds.x + bounds.width - 9}
                    y={bounds.y + bounds.height - 9}
                    width={18}
                    height={18}
                    fill="#eaf6fb"
                    stroke="#26799b"
                    strokeWidth={2}
                    rx={2}
                  />
                </g>
              )
            })() : null}
          </svg>
        </div>

        <aside className="sketch-editor__settings">
          <section>
            <h3>View</h3>
            <div className="sketch-editor__zoom">
              <button type="button" onClick={() => setZoom((value) => Math.max(MIN_ZOOM, value - 0.25))}>−</button>
              <button type="button" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
              <button type="button" onClick={() => setZoom((value) => Math.min(MAX_ZOOM, value + 0.25))}>+</button>
            </div>
          </section>
          {selectedElement ? (
            <section className="sketch-editor__selected-object">
              <div className="sketch-editor__section-heading">
                <h3>{selectedElement.element.kind}</h3>
                <button type="button" onClick={deleteSelectedElement}>delete</button>
              </div>
              {selectedElement.element.kind === 'text' ? (
                <label>
                  <span>Text</span>
                  <textarea
                    aria-label="Selected text"
                    value={selectedElement.element.text ?? ''}
                    onChange={(event) => updateSelectedElement({ text: event.target.value })}
                  />
                </label>
              ) : null}
              <label>
                <span>Stroke</span>
                <input
                  type="color"
                  aria-label="Selected object stroke color"
                  value={selectedElement.element.stroke}
                  onChange={(event) => updateSelectedElement({ stroke: event.target.value })}
                />
              </label>
              {selectedElement.element.kind !== 'arrow' && selectedElement.element.kind !== 'text' ? (
                <label>
                  <span>Fill</span>
                  <input
                    type="color"
                    aria-label="Selected object fill color"
                    value={selectedElement.element.fill === 'transparent' ? '#ffffff' : selectedElement.element.fill}
                    onChange={(event) => updateSelectedElement({ fill: event.target.value })}
                  />
                </label>
              ) : null}
              {selectedElement.element.kind === 'text' ? (
                <label>
                  <span>Font</span>
                  <input
                    type="number"
                    min="8"
                    max="240"
                    value={selectedElement.element.fontSize ?? 28}
                    onChange={(event) => updateSelectedElement({ fontSize: Number(event.target.value) || 28 })}
                  />
                </label>
              ) : null}
            </section>
          ) : null}
          <section>
            <h3>Page</h3>
            <label>
              <span>Width</span>
              <input
                key={`width-${document.width}`}
                type="number"
                min={MIN_PAGE_SIZE}
                max={MAX_PAGE_SIZE}
                defaultValue={document.width}
                onBlur={(event) => updatePageSize('width', Number(event.target.value))}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur()
                }}
              />
            </label>
            <label>
              <span>Height</span>
              <input
                key={`height-${document.height}`}
                type="number"
                min={MIN_PAGE_SIZE}
                max={MAX_PAGE_SIZE}
                defaultValue={document.height}
                onBlur={(event) => updatePageSize('height', Number(event.target.value))}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur()
                }}
              />
            </label>
            <label>
              <span>Paper</span>
              <input
                type="color"
                value={document.background}
                onChange={(event) => commit({ ...document, background: event.target.value })}
              />
            </label>
          </section>
          <section>
            <div className="sketch-editor__section-heading">
              <h3>Layers</h3>
              <button type="button" onClick={addLayer}>+</button>
            </div>
            <div className="sketch-editor__layers">
              {[...document.layers].reverse().map((layer) => (
                <div
                  className={layer.id === activeLayer?.id ? 'is-active' : undefined}
                  key={layer.id}
                >
                  <button type="button" onClick={() => setActiveLayerId(layer.id)}>{layer.name}</button>
                  <button
                    type="button"
                    aria-label={layer.visible ? `Hide ${layer.name}` : `Show ${layer.name}`}
                    onClick={() => updateLayer(layer.id, { visible: !layer.visible })}
                  >
                    {layer.visible ? '◉' : '○'}
                  </button>
                  <button
                    type="button"
                    aria-label={layer.locked ? `Unlock ${layer.name}` : `Lock ${layer.name}`}
                    onClick={() => updateLayer(layer.id, { locked: !layer.locked })}
                  >
                    {layer.locked ? 'Locked' : 'Open'}
                  </button>
                </div>
              ))}
            </div>
            <button type="button" disabled={!activeLayer || activeLayer.locked} onClick={clearLayer}>
              Clear active layer
            </button>
          </section>
        </aside>
      </div>
    </div>
  )
}
