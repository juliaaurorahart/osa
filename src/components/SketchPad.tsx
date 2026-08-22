import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import {
  cloneSketchDocument,
  type SketchDocument,
  type SketchLayer,
  type SketchPoint,
  type SketchStroke,
} from '../graph/textNode'

const PEN_COLORS = ['#222222', '#f5a9b8', '#5bcefa', '#9b59d0', '#ff8c00'] as const
const MIN_PAGE_SIZE = 100
const MAX_PAGE_SIZE = 20_000
const MIN_ZOOM = 0.1
const MAX_ZOOM = 8

type SketchTool = 'pen' | 'eraser' | 'pan'

type SketchPadProps = {
  document: SketchDocument
  onChange: (document: SketchDocument) => void
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
}: {
  document: SketchDocument
  height: number
}) {
  return (
    <svg
      className="sketch-preview"
      viewBox={`0 0 ${document.width} ${document.height}`}
      aria-label="Sketch preview"
      style={{ height }}
    >
      <rect width={document.width} height={document.height} fill={document.background} />
      {visibleLayers(document).flatMap((layer) => layer.strokes.map((stroke) => (
        <Stroke key={stroke.id} stroke={stroke} erase={false} />
      )))}
    </svg>
  )
}

export function SketchPad({ document, onChange }: SketchPadProps) {
  const [tool, setTool] = useState<SketchTool>('pen')
  const [color, setColor] = useState<string>(PEN_COLORS[0])
  const [brushWidth, setBrushWidth] = useState(4)
  const [opacity, setOpacity] = useState(1)
  const [zoom, setZoom] = useState(0.75)
  const [activeStroke, setActiveStroke] = useState<SketchStroke | null>(null)
  const [activeStrokeLayerId, setActiveStrokeLayerId] = useState<string | null>(null)
  const [activeLayerId, setActiveLayerId] = useState(document.layers.at(-1)?.id ?? '')
  const [historyState, setHistoryState] = useState({ undo: 0, redo: 0 })
  const undoStack = useRef<SketchDocument[]>([])
  const redoStack = useRef<SketchDocument[]>([])
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const panState = useRef<PanState>(null)
  const activeStrokeRef = useRef<SketchStroke | null>(null)
  const activeStrokePointerIdRef = useRef<number | null>(null)
  const activeStrokeLayerIdRef = useRef<string | null>(null)
  const activePenPointerIdRef = useRef<number | null>(null)
  const ignoreTouchUntilRef = useRef(0)
  const touchPointersRef = useRef(new Map<number, TouchPoint>())
  const pinchStateRef = useRef<PinchState | null>(null)
  const pinchFrameRef = useRef<number | null>(null)
  const zoomRef = useRef(zoom)
  const activeLayer = document.layers.find((layer) => layer.id === activeLayerId)
    ?? document.layers.at(-1)

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

  const beginInteraction = (event: ReactPointerEvent<SVGSVGElement>) => {
    event.stopPropagation()
    if (event.pointerType === 'touch') {
      beginTouchNavigation(event)
      return
    }

    if (event.pointerType === 'pen') {
      activePenPointerIdRef.current = event.pointerId
      for (const pointerId of touchPointersRef.current.keys()) {
        if (event.currentTarget.hasPointerCapture(pointerId)) {
          event.currentTarget.releasePointerCapture(pointerId)
        }
      }
      touchPointersRef.current.clear()
      pinchStateRef.current = null
      panState.current = null
      if (pinchFrameRef.current !== null) {
        cancelAnimationFrame(pinchFrameRef.current)
        pinchFrameRef.current = null
      }
      event.currentTarget.setPointerCapture(event.pointerId)
    }

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
    if (tool !== 'pen' || !activeLayer || !activeLayer.visible || activeLayer.locked) return
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.setPointerCapture(event.pointerId)
    }
    const stroke: SketchStroke = {
      id: crypto.randomUUID(),
      color,
      width: brushWidth,
      opacity,
      coordinateSpace: 'pixels',
      points: [pointFromPointer(event.nativeEvent, event.currentTarget.getBoundingClientRect())],
    }
    activeStrokeRef.current = stroke
    activeStrokePointerIdRef.current = event.pointerId
    activeStrokeLayerIdRef.current = activeLayer.id
    setActiveStrokeLayerId(activeLayer.id)
    setActiveStroke(stroke)
  }

  const continueInteraction = (event: ReactPointerEvent<SVGSVGElement>) => {
    event.stopPropagation()
    if (event.pointerType === 'touch') {
      continueTouchNavigation(event)
      return
    }

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

  const finishInteraction = (
    event: ReactPointerEvent<SVGSVGElement>,
    cancelled = false,
  ) => {
    event.stopPropagation()
    if (event.pointerType === 'touch') {
      finishTouchNavigation(event)
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
    if (event.pointerType === 'touch') {
      finishTouchNavigation(event)
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
      strokes: [],
    }
    commit({ ...document, layers: [...document.layers, layer] })
    setActiveLayerId(layer.id)
  }

  const updateLayer = (layerId: string, update: Partial<SketchLayer>) => {
    commit(replaceLayer(document, layerId, (layer) => ({ ...layer, ...update })))
  }

  const clearLayer = () => {
    if (!activeLayer || activeLayer.locked || activeLayer.strokes.length === 0) return
    commit(replaceLayer(document, activeLayer.id, (layer) => ({ ...layer, strokes: [] })))
  }

  const renderedLayers = document.layers.map((layer) => ({
    ...layer,
    strokes: activeStroke && layer.id === activeStrokeLayerId
      ? [...layer.strokes, activeStroke]
      : layer.strokes,
  }))

  return (
    <div className="sketch-editor">
      <div className="sketch-editor__toolbar" aria-label="Sketch tools">
        <div className="sketch-editor__tool-group">
          {(['pen', 'eraser', 'pan'] as const).map((candidate) => (
            <button
              className={tool === candidate ? 'is-selected' : undefined}
              type="button"
              key={candidate}
              onClick={() => setTool(candidate)}
            >
              {candidate[0].toUpperCase() + candidate.slice(1)}
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
                setTool('pen')
              }}
            />
          ))}
          <input
            type="color"
            aria-label="Custom pen color"
            value={color}
            onChange={(event) => {
              setColor(event.target.value)
              setTool('pen')
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
            className="sketch-editor__surface"
            width={document.width * zoom}
            height={document.height * zoom}
            viewBox={`0 0 ${document.width} ${document.height}`}
            aria-label="Drawing page"
            style={{ background: document.background }}
            onPointerDown={beginInteraction}
            onPointerMove={continueInteraction}
            onPointerUp={finishInteraction}
            onPointerCancel={(event) => finishInteraction(event, true)}
            onLostPointerCapture={loseInteraction}
          >
            <rect width={document.width} height={document.height} fill={document.background} />
            {renderedLayers.filter((layer) => layer.visible).flatMap((layer) => (
              layer.strokes.map((stroke) => (
                <Stroke
                  key={stroke.id}
                  stroke={stroke}
                  erase={tool === 'eraser'}
                  onErase={(event) => {
                    if (event.pointerType === 'touch') return
                    eraseStroke(layer.id, stroke.id)
                  }}
                />
              ))
            ))}
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
