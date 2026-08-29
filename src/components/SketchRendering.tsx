import {
  useId,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import type {
  SketchAnnotationTarget,
  SketchDocument,
  SketchElement,
  SketchLayer,
  SketchStroke,
} from '../graph/textNode'
import {
  resolveSketchAnnotationColor,
  resolveSketchSemanticColor,
  resolvedSketchText,
} from '../graph/sketchAnnotation'
import {
  isImmutableVisual,
  OSA_PROPERTY,
} from '../graph/osaData'
import type { VisualEmbedInstance } from '../graph/visualEmbed'
import {
  displayedCornerRadius,
  elementBounds,
  strokeDasharray,
  visibleLayers,
  visualEmbedHitBounds,
} from './sketchPadGeometry'

/**
 * Shared SVG rendering for both the read-only Visual preview and OSA Draw.
 * Interaction callbacks are optional; this module owns no editor state.
 */
export function SketchElementGraphic({
  element,
  interactive = false,
  selected = false,
  onPointerDown,
  markerNamespace,
  strokeVisible = true,
  fillVisible = true,
  annotationTargets = [],
}: {
  element: SketchElement
  interactive?: boolean
  selected?: boolean
  onPointerDown?: (event: ReactPointerEvent<SVGGElement>) => void
  /** Prevent arrow marker IDs from colliding when a Visual is reused twice. */
  markerNamespace?: string
  /** Compound shapes render their shared outer stroke separately. */
  strokeVisible?: boolean
  /** An interactive compound overlay needs hit targets, not a second fill. */
  fillVisible?: boolean
  /** Project data is supplied by the containing view, never copied here. */
  annotationTargets?: readonly SketchAnnotationTarget[]
}) {
  const bounds = elementBounds(element)
  const hitStroke = Math.max(16, element.strokeWidth + 10)
  const text = resolvedSketchText(element, annotationTargets) || 'Text'
  // A bound label coordinates with its Part or Tool automatically. Literal
  // text keeps the drawing's manually selected stroke color.
  const annotationColor = resolveSketchAnnotationColor(element.annotation, annotationTargets)
  const semanticStroke = resolveSketchSemanticColor(element.semanticColors?.stroke, annotationTargets)
  const semanticFill = resolveSketchSemanticColor(element.semanticColors?.fill, annotationTargets)
  // The saved stroke/fill remain the durable manual fallback if a selected
  // project item is removed or has no semantic color yet.
  const stroke = strokeVisible ? semanticStroke ?? element.stroke : 'transparent'
  const fill = fillVisible ? semanticFill ?? element.fill : 'transparent'
  const arrowMarkerId = `sketch-arrow-head-${markerNamespace ? `${markerNamespace}-` : ''}${element.id}`
    .replace(/[^a-zA-Z0-9_-]/g, '-')
  const compoundFilterId = `sketch-compound-outline-${markerNamespace ? `${markerNamespace}-` : ''}${element.id}`
    .replace(/[^a-zA-Z0-9_-]/g, '-')

  return (
    <g
      className={selected ? 'sketch-element is-selected' : 'sketch-element'}
      data-sketch-element-id={element.id}
      opacity={element.opacity}
      strokeDasharray={strokeDasharray(element.strokeStyle)}
      strokeLinecap={element.strokeStyle === 'dotted' ? 'round' : undefined}
      pointerEvents={interactive ? 'all' : 'none'}
      onPointerDown={onPointerDown}
    >
      {(element.kind === 'rectangle' || element.kind === 'rounded-rectangle') ? (
        <>
          <rect
            x={element.x}
            y={element.y}
            width={element.width}
            height={element.height}
            rx={element.kind === 'rounded-rectangle' ? displayedCornerRadius(element) : undefined}
            ry={element.kind === 'rounded-rectangle' ? displayedCornerRadius(element) : undefined}
            fill={fill}
            stroke={stroke}
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
      {element.kind === 'diamond' ? (
        <>
          <polygon
            points={`${element.x + element.width / 2},${element.y} ${element.x + element.width},${element.y + element.height / 2} ${element.x + element.width / 2},${element.y + element.height} ${element.x},${element.y + element.height / 2}`}
            fill={fill}
            stroke={stroke}
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
      {element.kind === 'triangle' ? (
        <>
          <polygon
            points={`${element.x + element.width / 2},${element.y} ${element.x + element.width},${element.y + element.height} ${element.x},${element.y + element.height}`}
            fill={fill}
            stroke={stroke}
            strokeWidth={element.strokeWidth}
            strokeLinejoin="round"
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
            fill={fill}
            stroke={stroke}
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
      {element.kind === 'line' ? (
        <>
          <line
            x1={element.x}
            y1={element.y}
            x2={element.x + element.width}
            y2={element.y + element.height}
            fill="none"
            stroke={stroke}
            strokeWidth={element.strokeWidth}
            strokeLinecap="round"
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
      {element.kind === 'arrow' ? (
        <>
          <defs>
            <marker
              id={arrowMarkerId}
              markerWidth="10"
              markerHeight="8"
              refX="9"
              refY="4"
              orient="auto"
              markerUnits="strokeWidth"
            >
              <path d="M 0 0 L 10 4 L 0 8 z" fill={stroke} />
            </marker>
          </defs>
          <line
            x1={element.x}
            y1={element.y}
            x2={element.x + element.width}
            y2={element.y + element.height}
            fill="none"
            stroke={stroke}
            strokeWidth={element.strokeWidth}
            strokeLinecap="round"
            markerEnd={`url(#${arrowMarkerId})`}
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
      {element.kind === 'compound' && element.compoundParts ? (
        <>
          <defs>
            <filter id={compoundFilterId} x="-20%" y="-20%" width="140%" height="140%" colorInterpolationFilters="sRGB">
              <feMorphology
                in="SourceAlpha"
                operator="dilate"
                radius={Math.max(1, element.strokeWidth / 2)}
                result="expanded"
              />
              <feComposite in="expanded" in2="SourceAlpha" operator="out" result="outside" />
              <feFlood floodColor={stroke} result="outlineColor" />
              <feComposite in="outlineColor" in2="outside" operator="in" result="outerOutline" />
              <feMerge>
                <feMergeNode in="outerOutline" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <g transform={`translate(${element.x} ${element.y})`} filter={`url(#${compoundFilterId})`} pointerEvents="none">
            {element.compoundParts.map((part) => (
              <SketchElementGraphic
                key={`${element.id}-${part.id}`}
                element={{
                  id: `${element.id}-${part.id}`,
                  kind: part.kind,
                  x: part.x,
                  y: part.y,
                  width: part.width,
                  height: part.height,
                  stroke,
                  fill,
                  strokeWidth: element.strokeWidth,
                  opacity: 1,
                  ...(typeof part.cornerRadius === 'number' ? { cornerRadius: part.cornerRadius } : {}),
                }}
                markerNamespace={markerNamespace}
                strokeVisible={false}
              />
            ))}
          </g>
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
            fill={semanticStroke ?? annotationColor ?? stroke}
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

/** Preserves ordinary elements and their durable compound-shape records. */
export function SketchLayerElementGraphics({
  layer,
  interactive = false,
  selectedElementIds = [],
  onElementPointerDown,
  markerNamespace,
  annotationTargets = [],
}: {
  layer: SketchLayer
  interactive?: boolean
  selectedElementIds?: readonly string[]
  onElementPointerDown?: (event: ReactPointerEvent<SVGGElement>, element: SketchElement) => void
  markerNamespace?: string
  annotationTargets?: readonly SketchAnnotationTarget[]
}) {
  const elements = layer.elements ?? []

  return (
    <>
      {elements.map((element) => (
          <SketchElementGraphic
            key={element.id}
            element={element}
            interactive={interactive}
            selected={selectedElementIds.includes(element.id)}
            markerNamespace={markerNamespace}
            annotationTargets={annotationTargets}
            onPointerDown={(event) => onElementPointerDown?.(event, element)}
          />
      ))}
    </>
  )
}

/**
 * A placed Visual is rendered directly from its canonical node. Nothing is
 * copied into the parent sketch document: the parent owns only `placement`.
 */
export function EmbeddedVisualGraphic({
  embed,
  interactive = false,
  selected = false,
  onPointerDown,
  annotationTargets = [],
}: {
  embed: VisualEmbedInstance
  interactive?: boolean
  selected?: boolean
  onPointerDown?: (event: ReactPointerEvent<SVGGElement>) => void
  annotationTargets?: readonly SketchAnnotationTarget[]
}) {
  const { placement, visual } = embed
  const hitBounds = interactive ? visualEmbedHitBounds(placement) : null
  // A semantic shade is a parent-side presentation choice. The canonical
  // drawing/photo and its owner color remain unchanged for every other use.
  const semanticShadeColor = placement.semanticShade ? embed.accentColor : undefined
  const childDocument = visual.data.sketch
  const directImage = visual.data.properties[OSA_PROPERTY.assetImage]?.trim() ?? ''
  // Pre-Visual boards can keep an image directly on an otherwise editable
  // canvas. Preserve it in nested previews while the normal migration runs.
  const hasLegacyBackground = !visual.data.properties[OSA_PROPERTY.visualContent]
    && Boolean(directImage)
  const image = isImmutableVisual(visual) || hasLegacyBackground
    ? directImage
    : ''
  // The placement is the Visual itself, not a separate container. A locked
  // placement keeps its source proportions; unlocking deliberately lets the
  // photo/drawing fill the independently chosen width and height.
  const preserveAspectRatio = placement.aspectRatioLocked === false
    ? 'none'
    : 'xMidYMid meet'
  const crop = placement.crop
  const childViewBox = crop
    ? `${crop.x * childDocument.width} ${crop.y * childDocument.height} ${crop.width * childDocument.width} ${crop.height * childDocument.height}`
    : `0 0 ${childDocument.width} ${childDocument.height}`

  return (
    <g
      className={selected ? 'sketch-visual-embed is-selected' : 'sketch-visual-embed'}
      data-visual-embed-id={embed.id}
      pointerEvents={interactive ? 'all' : 'none'}
      onPointerDown={onPointerDown}
    >
      {image && crop ? (
        // The crop window is resolved in source fractions, then scaled into
        // this one parent-side placement. The original photo stays unchanged.
        <svg
          x={placement.x}
          y={placement.y}
          width={placement.width}
          height={placement.height}
          viewBox={`${crop.x} ${crop.y} ${crop.width} ${crop.height}`}
          preserveAspectRatio={preserveAspectRatio}
          overflow="hidden"
          pointerEvents="none"
        >
          <image href={image} x={0} y={0} width={1} height={1} preserveAspectRatio="none" />
        </svg>
      ) : image ? (
        // A photo is an image asset, not a 1000 × 700 OSA drawing page. Draw
        // it directly in this parent-side placement so no blank paper or
        // permanent frame travels with the photo.
        <image
          href={image}
          x={placement.x}
          y={placement.y}
          width={placement.width}
          height={placement.height}
          preserveAspectRatio={preserveAspectRatio}
          pointerEvents="none"
        />
      ) : (
        <svg
          x={placement.x}
          y={placement.y}
          width={placement.width}
          height={placement.height}
          viewBox={childViewBox}
          preserveAspectRatio={preserveAspectRatio}
          overflow="hidden"
          pointerEvents="none"
        >
          <rect width={childDocument.width} height={childDocument.height} fill={childDocument.background} />
          {(embed.embeddedVisuals ?? []).map((childEmbed) => (
            <EmbeddedVisualGraphic
              key={childEmbed.id}
              embed={childEmbed}
              annotationTargets={annotationTargets}
            />
          ))}
          {visibleLayers(childDocument).flatMap((layer) => [
            <SketchLayerElementGraphics
              key={`${embed.id}-${layer.id}-elements`}
              layer={layer}
              markerNamespace={embed.id}
              annotationTargets={annotationTargets}
            />,
            ...layer.strokes.map((stroke) => (
              <Stroke key={`${embed.id}-${stroke.id}`} stroke={stroke} erase={false} />
            )),
          ])}
        </svg>
      )}
      {semanticShadeColor ? (
        // An opted-in shade tints this one placement without changing its
        // canonical source. Light areas take on the owner's semantic color
        // while the actual drawing or photo remains visible underneath.
        <rect
          className="sketch-visual-embed__accent"
          x={placement.x}
          y={placement.y}
          width={placement.width}
          height={placement.height}
          fill={semanticShadeColor}
          fillOpacity={0.22}
          pointerEvents="none"
        />
      ) : null}
      {interactive ? (
        // A Visual can be smaller than a comfortable mouse target. Keep the
        // selection target roomy without making its visible selection frame
        // larger than the actual placed Visual.
        <>
          <rect
            x={hitBounds?.x}
            y={hitBounds?.y}
            width={hitBounds?.width}
            height={hitBounds?.height}
            fill="transparent"
            pointerEvents="all"
          />
          {selected ? (
            <rect
              x={placement.x}
              y={placement.y}
              width={placement.width}
              height={placement.height}
              fill="none"
              stroke="#26799b"
              strokeWidth={3}
              strokeDasharray="7 5"
              pointerEvents="none"
            />
          ) : null}
        </>
      ) : null}
    </g>
  )
}

export function Stroke({
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
  embeddedVisuals = [],
  annotationTargets = [],
  ariaLabel = 'Sketch preview',
  className,
}: {
  document: SketchDocument
  height?: number | string
  backgroundImage?: string
  /** Direct child Visuals placed in this preview's parent canvas. */
  embeddedVisuals?: VisualEmbedInstance[]
  /** Live project data used by any bound text annotations in this preview. */
  annotationTargets?: readonly SketchAnnotationTarget[]
  ariaLabel?: string
  className?: string
}) {
  // Arrowheads use SVG marker IDs. Give every rendered canvas its own prefix
  // so an editor cannot accidentally reuse a stale marker from its preview
  // behind the dialog (which made a newly semantic arrowhead stay black).
  const markerNamespace = useId()

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
      {embeddedVisuals.map((embed) => (
        <EmbeddedVisualGraphic key={embed.id} embed={embed} annotationTargets={annotationTargets} />
      ))}
      {visibleLayers(document).flatMap((layer) => [
        <SketchLayerElementGraphics
          key={`${layer.id}-elements`}
          layer={layer}
          markerNamespace={markerNamespace}
          annotationTargets={annotationTargets}
        />,
        ...layer.strokes.map((stroke) => (
          <Stroke key={stroke.id} stroke={stroke} erase={false} />
        )),
      ])}
    </svg>
  )
}

