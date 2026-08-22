import { useRef, useState, type PointerEvent } from 'react'
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
const MIN_ZOOM = 0.25
const MAX_ZOOM = 3

type SketchTool = 'pen' | 'eraser' | 'pan'

type SketchPadProps = {
  document: SketchDocument
  onChange: (document: SketchDocument) => void
}

type PanState = {
  x: number
  y: number
  scrollLeft: number
  scrollTop: number
} | null

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
  onErase?: () => void
}) {
  const points = stroke.points.map((point) => `${point.x},${point.y}`).join(' ')
  return (
    <>
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
      {erase ? (
        <polyline
          points={points}
          fill="none"
          stroke="transparent"
          strokeWidth={Math.max(14, stroke.width + 8)}
          strokeLinecap="round"
          strokeLinejoin="round"
          pointerEvents="stroke"
          onPointerDown={(event) => {
            event.stopPropagation()
            onErase?.()
          }}
        />
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
  const [activeLayerId, setActiveLayerId] = useState(document.layers.at(-1)?.id ?? '')
  const [historyState, setHistoryState] = useState({ undo: 0, redo: 0 })
  const undoStack = useRef<SketchDocument[]>([])
  const redoStack = useRef<SketchDocument[]>([])
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const panState = useRef<PanState>(null)
  const activeLayer = document.layers.find((layer) => layer.id === activeLayerId)
    ?? document.layers.at(-1)

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

  const pointFromEvent = (event: PointerEvent<SVGSVGElement>): SketchPoint => {
    const bounds = event.currentTarget.getBoundingClientRect()
    return {
      x: (event.clientX - bounds.left) * document.width / bounds.width,
      y: (event.clientY - bounds.top) * document.height / bounds.height,
      pressure: event.pressure || 0.5,
    }
  }

  const beginInteraction = (event: PointerEvent<SVGSVGElement>) => {
    event.stopPropagation()
    if (tool === 'pan') {
      const viewport = viewportRef.current
      if (!viewport) return
      event.currentTarget.setPointerCapture(event.pointerId)
      panState.current = {
        x: event.clientX,
        y: event.clientY,
        scrollLeft: viewport.scrollLeft,
        scrollTop: viewport.scrollTop,
      }
      return
    }
    if (tool !== 'pen' || !activeLayer || !activeLayer.visible || activeLayer.locked) return
    event.currentTarget.setPointerCapture(event.pointerId)
    setActiveStroke({
      id: crypto.randomUUID(),
      color,
      width: brushWidth,
      opacity,
      coordinateSpace: 'pixels',
      points: [pointFromEvent(event)],
    })
  }

  const continueInteraction = (event: PointerEvent<SVGSVGElement>) => {
    if (panState.current) {
      const viewport = viewportRef.current
      if (!viewport) return
      viewport.scrollLeft = panState.current.scrollLeft - (event.clientX - panState.current.x)
      viewport.scrollTop = panState.current.scrollTop - (event.clientY - panState.current.y)
      return
    }
    if (!activeStroke || !event.currentTarget.hasPointerCapture(event.pointerId)) return
    const point = pointFromEvent(event)
    setActiveStroke((stroke) => stroke ? { ...stroke, points: [...stroke.points, point] } : null)
  }

  const finishInteraction = (event: PointerEvent<SVGSVGElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    if (panState.current) {
      panState.current = null
      return
    }
    if (!activeStroke || !activeLayer) return
    if (activeStroke.points.length > 1) {
      commit(replaceLayer(document, activeLayer.id, (layer) => ({
        ...layer,
        strokes: [...layer.strokes, activeStroke],
      })))
    }
    setActiveStroke(null)
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
    strokes: activeStroke && layer.id === activeLayer?.id
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
            onPointerCancel={finishInteraction}
          >
            <rect width={document.width} height={document.height} fill={document.background} />
            {renderedLayers.filter((layer) => layer.visible).flatMap((layer) => (
              layer.strokes.map((stroke) => (
                <Stroke
                  key={stroke.id}
                  stroke={stroke}
                  erase={tool === 'eraser'}
                  onErase={() => eraseStroke(layer.id, stroke.id)}
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
