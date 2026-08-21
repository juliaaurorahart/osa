import { useRef, useState, type PointerEvent } from 'react'
import type { SketchPoint, SketchStroke } from '../graph/textNode'

const PEN_COLORS = ['#222222', '#f5a9b8', '#5bcefa', '#9b59d0', '#ff8c00'] as const

type SketchPadProps = {
  strokes: SketchStroke[]
  onChange: (strokes: SketchStroke[]) => void
  onInteractionStart?: () => void
}

export function SketchPad({ strokes, onChange, onInteractionStart }: SketchPadProps) {
  const [color, setColor] = useState<string>(PEN_COLORS[0])
  const [erasing, setErasing] = useState(false)
  const [activeStroke, setActiveStroke] = useState<SketchStroke | null>(null)
  const surfaceRef = useRef<SVGSVGElement | null>(null)

  const pointFromEvent = (event: PointerEvent<SVGSVGElement>): SketchPoint => {
    const bounds = event.currentTarget.getBoundingClientRect()
    return {
      x: (event.clientX - bounds.left) / bounds.width,
      y: (event.clientY - bounds.top) / bounds.height,
    }
  }

  const beginStroke = (event: PointerEvent<SVGSVGElement>) => {
    event.stopPropagation()
    onInteractionStart?.()
    if (erasing) return
    event.currentTarget.setPointerCapture(event.pointerId)
    setActiveStroke({
      id: crypto.randomUUID(),
      color,
      width: 4,
      points: [pointFromEvent(event)],
    })
  }

  const continueStroke = (event: PointerEvent<SVGSVGElement>) => {
    if (!activeStroke || !event.currentTarget.hasPointerCapture(event.pointerId)) return
    const point = pointFromEvent(event)
    setActiveStroke((stroke) => stroke ? { ...stroke, points: [...stroke.points, point] } : null)
  }

  const finishStroke = (event: PointerEvent<SVGSVGElement>) => {
    if (!activeStroke) return
    event.stopPropagation()
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    if (activeStroke.points.length > 1) onChange([...strokes, activeStroke])
    setActiveStroke(null)
  }

  const visibleStrokes = activeStroke ? [...strokes, activeStroke] : strokes

  return (
    <div className="sketch-pad nodrag nopan" onClick={(event) => event.stopPropagation()}>
      <div className="sketch-pad__tools" aria-label="Sketch tools">
        {PEN_COLORS.map((penColor) => (
          <button
            key={penColor}
            type="button"
            className={color === penColor && !erasing ? 'is-selected' : ''}
            aria-label={`Draw with ${penColor}`}
            style={{ color: penColor }}
            onClick={() => {
              setColor(penColor)
              setErasing(false)
            }}
          />
        ))}
        <button
          type="button"
          className={`sketch-pad__eraser${erasing ? ' is-selected' : ''}`}
          onClick={() => setErasing((isErasing) => !isErasing)}
        >
          Erase
        </button>
        <button type="button" onClick={() => onChange([])} disabled={strokes.length === 0}>
          Clear
        </button>
      </div>
      <svg
        ref={surfaceRef}
        className={`sketch-pad__surface${erasing ? ' is-erasing' : ''}`}
        viewBox="0 0 1000 600"
        preserveAspectRatio="none"
        aria-label="Sketch surface"
        onPointerDown={beginStroke}
        onPointerMove={continueStroke}
        onPointerUp={finishStroke}
        onPointerCancel={finishStroke}
      >
        {visibleStrokes.map((stroke) => (
          <polyline
            key={stroke.id}
            points={stroke.points.map((point) => `${point.x * 1000},${point.y * 600}`).join(' ')}
            fill="none"
            stroke={stroke.color}
            strokeWidth={stroke.width}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            onPointerDown={erasing ? (event) => {
              event.stopPropagation()
              onInteractionStart?.()
              onChange(strokes.filter((candidate) => candidate.id !== stroke.id))
            } : undefined}
          />
        ))}
      </svg>
    </div>
  )
}
