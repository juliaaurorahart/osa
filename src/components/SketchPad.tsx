import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  cloneSketchDocument,
  type SketchCompoundPart,
  type SketchDocument,
  type SketchElement,
  type SketchLayer,
  type SketchPoint,
  type SketchSemanticColorBindings,
  type SketchStroke,
  type SketchAnnotationTarget,
  type SketchTextAnnotation,
} from '../graph/textNode'
import {
  annotationFieldsForTarget,
  annotationTargetLabel,
  resolveSketchAnnotationColor,
  resolveSketchSemanticColor,
  resolveSketchTextAnnotation,
  resolvedSketchText,
} from '../graph/sketchAnnotation'
import {
  isImmutableVisual,
  OSA_PROPERTY,
  visualIdentity,
  type VisualEmbedPlacement,
} from '../graph/osaData'
import type { VisualEmbedInstance } from '../graph/visualEmbed'

const PEN_COLORS = ['#222222', '#f5a9b8', '#5bcefa', '#9b59d0', '#ff8c00'] as const
const MIN_PAGE_SIZE = 100
const MAX_PAGE_SIZE = 20_000
const MIN_ZOOM = 0.1
const MAX_ZOOM = 8
/** Keep a group usable even when its resize handle is dragged almost closed. */
const MIN_GROUP_DIMENSION = 1

/**
 * The canvas uses a deliberately small set of portable SVG primitives. They
 * are real, saved objects rather than a visual effect tied to this editor.
 */
const SHAPE_TOOLS = [
  'rectangle',
  'rounded-rectangle',
  'ellipse',
  'diamond',
  'triangle',
  'line',
  'arrow',
] as const

type ShapeTool = typeof SHAPE_TOOLS[number]
type SketchTool = 'select' | 'pen' | ShapeTool | 'text' | 'eraser' | 'pan'

function isShapeTool(tool: SketchTool): tool is ShapeTool {
  return SHAPE_TOOLS.some((shapeTool) => shapeTool === tool)
}

type SketchPadProps = {
  document: SketchDocument
  onChange: (document: SketchDocument) => void
  /** Optional source photo, slide, or render underneath the editable marks. */
  backgroundImage?: string
  /** Lets an embedded editor name the same canvas more precisely. */
  ariaLabel?: string
  /** Notebook sketches begin with a pen; Visual canvases begin in selection. */
  initialTool?: SketchTool
  /**
   * Canonical child Visuals placed on this canvas. The child content stays on
   * the child Visual; this list only supplies the parent-side placement.
   */
  embeddedVisuals?: VisualEmbedInstance[]
  /** Current project values that text annotations can show live. */
  annotationTargets?: readonly SketchAnnotationTarget[]
  /** Updates one parent -> child placement while the canvas is being edited. */
  onEmbeddedVisualPlacementChange?: (id: string, placement: VisualEmbedPlacement) => void
  /** Moves several selected parent-side placements in one durable update. */
  onEmbeddedVisualPlacementsChange?: (updates: ReadonlyMap<string, VisualEmbedPlacement>) => void
  /** Removes only the placement edge, never the child Visual itself. */
  onEmbeddedVisualRemove?: (id: string) => void
  /**
   * Replaces one placed OSA drawing with a new independent Visual canvas.
   * Image/photo assets deliberately remain shared reusable source material.
   */
  onEmbeddedVisualMakeIndependent?: (id: string) => void
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
  /** Original members of a same-layer group, captured before a drag begins. */
  groupMembers?: SketchElement[]
  /** Temporary moved members shown during the current drag only. */
  groupElements?: SketchElement[]
  startPoint: SketchPoint
  mode: 'create' | 'move' | 'resize'
}

/** A temporary selection box; it is UI state and is never saved to the canvas. */
type ActiveRegionSelection = {
  pointerId: number
  startPoint: SketchPoint
  endPoint: SketchPoint
  /** Cmd/Ctrl keeps the existing selection and toggles this region's shapes. */
  toggleSelection: boolean
}

/** The Select toolbar lets a person choose precise or forgiving marquee picks. */
type MarqueeSelectionMode = 'inside' | 'touching'

/** A canvas-local copy buffer remembers each selected shape and its layer. */
type ShapeClipboardItem = {
  layerId: string
  element: SketchElement
}

/** A parent canvas can move/resize an embed without changing its child Visual. */
type ActiveEmbedInteraction = {
  pointerId: number
  embedId: string
  original: VisualEmbedPlacement
  placement: VisualEmbedPlacement
  startPoint: SketchPoint
  mode: 'move' | 'resize'
}

/** A marquee-selected mix of drawing objects and placed Visuals moving together. */
type ActiveSelectionMove = {
  pointerId: number
  startPoint: SketchPoint
  elements: Array<{
    layerId: string
    original: SketchElement
    element: SketchElement
  }>
  embeds: Array<{
    id: string
    original: VisualEmbedPlacement
    placement: VisualEmbedPlacement
  }>
}

type ElementBounds = { x: number; y: number; width: number; height: number }

function isLineElement(kind: SketchElement['kind']): kind is 'line' | 'arrow' {
  return kind === 'line' || kind === 'arrow'
}

function isFillableElement(kind: SketchElement['kind']) {
  return kind !== 'line' && kind !== 'arrow' && kind !== 'text'
}

/** Shapes with a rectangular drawing box can be sized exactly in the inspector. */
function isResizableShape(kind: SketchElement['kind']) {
  return kind !== 'line' && kind !== 'arrow' && kind !== 'text'
}

/**
 * Preserve an object's current proportions while resizing from its lower-right
 * handle. The pointer dimension that moved farther, relative to the original
 * shape, determines the shared scale.
 */
function proportionalDimensions(
  original: Pick<ElementBounds, 'width' | 'height'>,
  requestedWidth: number,
  requestedHeight: number,
  minimum = 1,
) {
  const width = Math.max(minimum, requestedWidth)
  const height = Math.max(minimum, requestedHeight)
  if (original.width <= 0 || original.height <= 0) return { width, height }

  const widthScale = width / original.width
  const heightScale = height / original.height
  const scale = Math.abs(widthScale - 1) >= Math.abs(heightScale - 1)
    ? widthScale
    : heightScale
  const minimumScale = Math.max(minimum / original.width, minimum / original.height)
  const safeScale = Math.max(minimumScale, scale)

  return {
    width: original.width * safeScale,
    height: original.height * safeScale,
  }
}

/** Use one dimension field to update both dimensions when an object is locked. */
function sizedElementUpdate(
  element: SketchElement,
  dimension: 'width' | 'height',
  requestedValue: number,
): Pick<SketchElement, 'width' | 'height'> {
  const value = Math.max(1, requestedValue)
  if (!element.aspectRatioLocked || element.width <= 0 || element.height <= 0) {
    return dimension === 'width' ? { width: value, height: element.height } : { width: element.width, height: value }
  }

  const ratio = element.width / element.height
  return dimension === 'width'
    ? { width: value, height: Math.max(1, value / ratio) }
    : { width: Math.max(1, value * ratio), height: value }
}

/** Use one placed Visual dimension to update both values when its link is locked. */
function sizedEmbedPlacementUpdate(
  placement: VisualEmbedPlacement,
  dimension: 'width' | 'height',
  requestedValue: number,
): Pick<VisualEmbedPlacement, 'width' | 'height'> {
  const value = Math.max(24, requestedValue)
  if (placement.aspectRatioLocked === false || placement.width <= 0 || placement.height <= 0) {
    return dimension === 'width'
      ? { width: value, height: placement.height }
      : { width: placement.width, height: value }
  }

  const ratio = placement.width / placement.height
  if (dimension === 'width') {
    // Keep both dimensions above the image-box minimum without breaking ratio.
    const width = Math.max(value, 24 * ratio)
    return { width, height: width / ratio }
  }

  // Keep both dimensions above the image-box minimum without breaking ratio.
  const height = Math.max(value, 24 / ratio)
  return { width: height * ratio, height }
}

function isCompoundPartKind(kind: SketchElement['kind']): kind is SketchCompoundPart['kind'] {
  return ['rectangle', 'rounded-rectangle', 'ellipse', 'diamond', 'triangle'].includes(kind)
}

function cloneSketchElement(element: SketchElement): SketchElement {
  return {
    ...element,
    ...(element.compoundParts
      ? { compoundParts: element.compoundParts.map((part) => ({ ...part })) }
      : {}),
  }
}

/** Resize a compound's local geometry so its exterior remains a true shape. */
function resizeCompoundElement(element: SketchElement, update: Partial<SketchElement>): SketchElement {
  const nextElement = { ...element, ...update }
  if (element.kind !== 'compound' || !element.compoundParts) return nextElement
  // Imported zero-size shapes are legal data. Avoid letting a later resize
  // turn their saved component geometry into NaN.
  const scaleX = element.width === 0 ? 1 : nextElement.width / element.width
  const scaleY = element.height === 0 ? 1 : nextElement.height / element.height
  const radiusScale = Math.min(Math.abs(scaleX), Math.abs(scaleY))
  return {
    ...nextElement,
    compoundParts: element.compoundParts.map((part) => ({
      ...part,
      x: part.x * scaleX,
      y: part.y * scaleY,
      width: part.width * scaleX,
      height: part.height * scaleY,
      ...(typeof part.cornerRadius === 'number' ? { cornerRadius: part.cornerRadius * radiusScale } : {}),
    })),
  }
}

/** The maximum SVG corner radius that still fits inside this shape's bounds. */
function maximumCornerRadius(element: SketchElement) {
  return Math.max(0, Math.min(Math.abs(element.width), Math.abs(element.height)) / 2)
}

/**
 * Older boards did not store corner radii. Preserve their original appearance
 * until someone intentionally adjusts the selected rounded rectangle.
 */
function displayedCornerRadius(element: SketchElement) {
  const legacyDefault = Math.min(24, Math.abs(element.width) / 5, Math.abs(element.height) / 5)
  const requested = typeof element.cornerRadius === 'number' && Number.isFinite(element.cornerRadius)
    ? element.cornerRadius
    : legacyDefault
  return Math.min(Math.max(0, requested), maximumCornerRadius(element))
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

function elementBounds(element: SketchElement): ElementBounds {
  if (isLineElement(element.kind)) {
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

/** The smallest canvas box that contains every supplied shape. */
function combinedElementBounds(elements: readonly SketchElement[]): ElementBounds {
  const bounds = elements.map(elementBounds)
  const left = Math.min(...bounds.map((box) => box.x))
  const top = Math.min(...bounds.map((box) => box.y))
  const right = Math.max(...bounds.map((box) => box.x + box.width))
  const bottom = Math.max(...bounds.map((box) => box.y + box.height))
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  }
}

/**
 * Scale one member from a group's original bounding box. Lines retain their
 * signed vectors, so an arrow that pointed up-left continues to do so after
 * its group is resized. Compound elements resize their saved local geometry
 * through the same path as an individually resized compound.
 */
function scaleElementFromGroupBounds(
  element: SketchElement,
  groupBounds: ElementBounds,
  scaleX: number,
  scaleY: number,
): SketchElement {
  const x = groupBounds.x + (element.x - groupBounds.x) * scaleX
  const y = groupBounds.y + (element.y - groupBounds.y) * scaleY

  if (isLineElement(element.kind)) {
    return {
      ...element,
      x,
      y,
      width: element.width * scaleX,
      height: element.height * scaleY,
    }
  }

  const radiusScale = Math.min(Math.abs(scaleX), Math.abs(scaleY))
  const resized = resizeCompoundElement(element, {
    x,
    y,
    width: element.width * scaleX,
    height: element.height * scaleY,
  })
  return {
    ...resized,
    ...(element.kind === 'rounded-rectangle' && typeof element.cornerRadius === 'number'
      ? { cornerRadius: Math.max(0, element.cornerRadius * radiusScale) }
      : {}),
    // Text has a drawing box too, but its visible glyphs are controlled by
    // fontSize. Scale it with the smallest axis so it remains readable rather
    // than becoming artificially stretched on a non-uniform group resize.
    ...(element.kind === 'text' && typeof element.fontSize === 'number'
      ? { fontSize: Math.max(1, element.fontSize * radiusScale) }
      : {}),
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

/**
 * Decide whether a drawing or placed Visual belongs in the current marquee.
 * `inside` is deliberately the default: an item must fit completely inside
 * the rectangle. `touching` includes every item whose drawing box overlaps
 * or touches the marquee boundary.
 */
function marqueeMatchesBounds(
  marquee: ElementBounds,
  item: ElementBounds,
  mode: MarqueeSelectionMode,
) {
  if (mode === 'inside') {
    return (
      item.x >= marquee.x
      && item.y >= marquee.y
      && item.x + item.width <= marquee.x + marquee.width
      && item.y + item.height <= marquee.y + marquee.height
    )
  }

  return (
    item.x <= marquee.x + marquee.width
    && item.x + item.width >= marquee.x
    && item.y <= marquee.y + marquee.height
    && item.y + item.height >= marquee.y
  )
}

/** Keep a line or move on the dominant horizontal/vertical axis while Shift is held. */
function axisLockedPoint(start: SketchPoint, end: SketchPoint): SketchPoint {
  const dx = end.x - start.x
  const dy = end.y - start.y
  return Math.abs(dx) >= Math.abs(dy)
    ? { ...end, y: start.y }
    : { ...end, x: start.x }
}

/**
 * A group is a canvas-local relationship, so it is intentionally scoped to
 * its layer. That keeps a locked/hidden layer from being silently moved by a
 * group drag on another layer.
 */
function selectedIdsIncludingLayerGroups(document: SketchDocument, selectedIds: readonly string[]) {
  const selectedIdSet = new Set(selectedIds)
  const selectedGroupKeys = new Set<string>()
  for (const layer of document.layers) {
    for (const element of layer.elements ?? []) {
      if (selectedIdSet.has(element.id) && element.groupId) {
        selectedGroupKeys.add(`${layer.id}:${element.groupId}`)
      }
    }
  }
  return document.layers.flatMap((layer) => (
    (layer.elements ?? []).flatMap((element) => (
      selectedIdSet.has(element.id) || (element.groupId && selectedGroupKeys.has(`${layer.id}:${element.groupId}`))
        ? [element.id]
        : []
    ))
  ))
}

function createElement(
  kind: Exclude<SketchElement['kind'], 'text'>,
  start: SketchPoint,
  end: SketchPoint,
  color: string,
  fill: string,
  strokeWidth: number,
  opacity: number,
): SketchElement {
  const box = normalizedBox(start, end)
  return {
    id: crypto.randomUUID(),
    kind,
    // Lines and arrows retain their signed vectors so they can point in any
    // direction. Enclosed shapes use a normalized drawing box.
    x: isLineElement(kind) ? start.x : box.x,
    y: isLineElement(kind) ? start.y : box.y,
    width: isLineElement(kind) ? end.x - start.x : box.width,
    height: isLineElement(kind) ? end.y - start.y : box.height,
    stroke: color,
    fill,
    strokeWidth,
    opacity,
    ...(kind === 'rounded-rectangle'
      ? { cornerRadius: Math.min(24, box.width / 5, box.height / 5) }
      : {}),
  }
}

function SketchElementGraphic({
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
function SketchLayerElementGraphics({
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
function EmbeddedVisualGraphic({
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
  const accentColor = embed.accentColor
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

  return (
    <g
      className={selected ? 'sketch-visual-embed is-selected' : 'sketch-visual-embed'}
      data-visual-embed-id={embed.id}
      pointerEvents={interactive ? 'all' : 'none'}
      onPointerDown={onPointerDown}
    >
      {image ? (
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
          viewBox={`0 0 ${childDocument.width} ${childDocument.height}`}
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
      {accentColor ? (
        // Shade the placed rendering without changing its canonical source.
        // Light areas take on the owner's semantic color while the actual
        // drawing or photo remains visible underneath.
        <rect
          className="sketch-visual-embed__accent"
          x={placement.x}
          y={placement.y}
          width={placement.width}
          height={placement.height}
          fill={accentColor}
          fillOpacity={0.22}
          pointerEvents="none"
        />
      ) : null}
      {interactive ? (
        // This is an invisible hit target until the item is selected. A photo
        // therefore looks like just a photo in the canvas, while still being
        // selectable and resizable from the ordinary Select tool.
        <rect
          x={placement.x}
          y={placement.y}
          width={placement.width}
          height={placement.height}
          fill="transparent"
          stroke={selected ? '#26799b' : 'none'}
          strokeWidth={selected ? 3 : 0}
          strokeDasharray={selected ? '7 5' : undefined}
          pointerEvents="all"
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
          annotationTargets={annotationTargets}
        />,
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
  embeddedVisuals = [],
  annotationTargets = [],
  onEmbeddedVisualPlacementChange,
  onEmbeddedVisualPlacementsChange,
  onEmbeddedVisualRemove,
  onEmbeddedVisualMakeIndependent,
}: SketchPadProps) {
  const [tool, setTool] = useState<SketchTool>(initialTool)
  const [color, setColor] = useState<string>(PEN_COLORS[0])
  /** New enclosed shapes use this fill; lines, arrows, text, and pen ignore it. */
  const [fillColor, setFillColor] = useState<string>('transparent')
  const [brushWidth, setBrushWidth] = useState(4)
  const [opacity, setOpacity] = useState(1)
  const [zoom, setZoom] = useState(0.75)
  const [activeStroke, setActiveStroke] = useState<SketchStroke | null>(null)
  const [activeStrokeLayerId, setActiveStrokeLayerId] = useState<string | null>(null)
  const [activeElement, setActiveElement] = useState<ActiveElementInteraction | null>(null)
  const [activeRegionSelection, setActiveRegionSelection] = useState<ActiveRegionSelection | null>(null)
  const [marqueeSelectionMode, setMarqueeSelectionMode] = useState<MarqueeSelectionMode>('inside')
  const [selectedElementIds, setSelectedElementIds] = useState<string[]>([])
  const [clipboardCount, setClipboardCount] = useState(0)
  const [activeEmbed, setActiveEmbed] = useState<ActiveEmbedInteraction | null>(null)
  const [activeSelectionMove, setActiveSelectionMove] = useState<ActiveSelectionMove | null>(null)
  /** A marquee can highlight more than one placed Visual at a time. */
  const [selectedEmbedIds, setSelectedEmbedIds] = useState<string[]>([])
  const [activeLayerId, setActiveLayerId] = useState(document.layers.at(-1)?.id ?? '')
  const [annotationTargetId, setAnnotationTargetId] = useState('')
  const [annotationField, setAnnotationField] = useState<SketchTextAnnotation['field']>('name')
  const [annotationPropertyKey, setAnnotationPropertyKey] = useState('')
  /** The last text box whose picker the user explicitly changed. */
  const [annotationPickerElementId, setAnnotationPickerElementId] = useState<string | null>(null)
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
  const activeRegionSelectionRef = useRef<ActiveRegionSelection | null>(null)
  const shapeClipboardRef = useRef<ShapeClipboardItem[]>([])
  const pasteOffsetRef = useRef(0)
  const activeEmbedRef = useRef<ActiveEmbedInteraction | null>(null)
  const activeSelectionMoveRef = useRef<ActiveSelectionMove | null>(null)
  const activePenPointerIdRef = useRef<number | null>(null)
  const ignoreTouchUntilRef = useRef(0)
  const touchPointersRef = useRef(new Map<number, TouchPoint>())
  const pinchStateRef = useRef<PinchState | null>(null)
  const pinchFrameRef = useRef<number | null>(null)
  const zoomRef = useRef(zoom)
  const activeLayer = document.layers.find((layer) => layer.id === activeLayerId)
    ?? document.layers.at(-1)
  const selectedElements = document.layers
    .flatMap((layer) => (layer.elements ?? []).map((element) => ({ layer, element })))
    .filter(({ element }) => selectedElementIds.includes(element.id))
  const selectedElement = selectedElements[0]
  const selectedElementCount = selectedElements.length
  const selectedGroupIds = [...new Set(
    selectedElements.flatMap(({ element }) => element.groupId ? [element.groupId] : []),
  )]
  const selectedElementsShareEditableLayer = selectedElements.length > 0
    && selectedElements.every(({ layer }) => (
      !layer.locked && layer.id === selectedElements[0]?.layer.id
    ))
  const selectedElementsAreOneGroup = selectedElementCount > 1
    && selectedGroupIds.length === 1
    && selectedElements.every(({ element }) => element.groupId === selectedGroupIds[0])
  const canGroupSelectedElements = selectedElementCount > 1
    && selectedElementsShareEditableLayer
    && !selectedElementsAreOneGroup
  const canUngroupSelectedElements = selectedGroupIds.length > 0 && selectedElementsShareEditableLayer
  /** A durable group is selected as one object, including every member. */
  const selectedGroup = selectedElementsAreOneGroup && selectedElementsShareEditableLayer && selectedElement
    ? {
      layer: selectedElement.layer,
      id: selectedGroupIds[0],
      members: (selectedElement.layer.elements ?? []).filter((element) => (
        element.groupId === selectedGroupIds[0]
      )),
    }
    : null
  const selectedGroupBounds = selectedGroup && selectedGroup.members.length > 0
    ? combinedElementBounds(selectedGroup.members)
    : null
  /**
   * Combine makes one new geometric object. It intentionally accepts only
   * filled, enclosed SVG primitives: lines and text have no filled silhouette
   * to union, and compounds should be broken apart before being recombined.
   */
  const canCombineSelectedElements = selectedElementCount > 1
    && selectedElementsShareEditableLayer
    && selectedElements.every(({ element }) => (
      isCompoundPartKind(element.kind) && element.fill !== 'transparent'
    ))
  const canBreakApartSelectedElement = Boolean(
    selectedElementCount === 1
    && selectedElement
    && !selectedElement.layer.locked
    && selectedElement.element.kind === 'compound'
    && selectedElement.element.compoundParts?.length,
  )
  /** The detailed editor remains intentionally one-Visual-at-a-time. */
  const selectedEmbed = selectedEmbedIds.length === 1
    ? embeddedVisuals.find((embed) => embed.id === selectedEmbedIds[0])
    : undefined
  const selectedTextAnnotation = selectedElementCount === 1 && selectedElement?.element.kind === 'text'
    ? selectedElement.element.annotation
    : undefined
  const selectedTextElementId = selectedElement?.element.kind === 'text'
    ? selectedElement.element.id
    : undefined
  // A saved binding supplies the picker defaults. Once the user changes either
  // picker, its local choice wins for this one text box without needing an
  // effect that mirrors props into state.
  const annotationPickerHasLocalValue = annotationPickerElementId === selectedTextElementId
  const effectiveAnnotationTargetId = annotationPickerHasLocalValue
    ? annotationTargetId
    : selectedTextAnnotation?.targetId ?? ''
  const effectiveAnnotationField = annotationPickerHasLocalValue
    ? annotationField
    : selectedTextAnnotation?.field ?? 'name'
  const effectiveAnnotationPropertyKey = annotationPickerHasLocalValue
    ? annotationPropertyKey
    : selectedTextAnnotation?.propertyKey ?? ''
  const annotationTargetOptions = [...annotationTargets]
    .sort((left, right) => annotationTargetLabel(left).localeCompare(annotationTargetLabel(right)))
  const selectedAnnotationTarget = annotationTargetOptions.find((target) => target.id === effectiveAnnotationTargetId)
  const selectedAnnotationFields = annotationFieldsForTarget(selectedAnnotationTarget)

  useEffect(() => {
    zoomRef.current = zoom
  }, [zoom])

  useEffect(() => () => {
    if (pinchFrameRef.current !== null) {
      cancelAnimationFrame(pinchFrameRef.current)
    }
  }, [])

  const commit = useCallback((nextDocument: SketchDocument) => {
    undoStack.current.push(cloneSketchDocument(document))
    redoStack.current = []
    onChange(cloneSketchDocument(nextDocument))
    setHistoryState({ undo: undoStack.current.length, redo: 0 })
  }, [document, onChange])

  const undo = useCallback(() => {
    const previous = undoStack.current.pop()
    if (!previous) return
    redoStack.current.push(cloneSketchDocument(document))
    onChange(previous)
    setHistoryState({ undo: undoStack.current.length, redo: redoStack.current.length })
  }, [document, onChange])

  const redo = useCallback(() => {
    const next = redoStack.current.pop()
    if (!next) return
    undoStack.current.push(cloneSketchDocument(document))
    onChange(next)
    setHistoryState({ undo: undoStack.current.length, redo: redoStack.current.length })
  }, [document, onChange])

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
    || isShapeTool(candidate)
    || candidate === 'text'
    || candidate === 'eraser'
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

  const updateActiveRegionSelection = (event: ReactPointerEvent<SVGSVGElement>) => {
    const selection = activeRegionSelectionRef.current
    if (!selection || selection.pointerId !== event.pointerId) return false
    const next = {
      ...selection,
      endPoint: pointFromPointer(event.nativeEvent, event.currentTarget.getBoundingClientRect()),
    }
    activeRegionSelectionRef.current = next
    setActiveRegionSelection(next)
    return true
  }

  const finishActiveRegionSelection = (
    event: ReactPointerEvent<SVGSVGElement>,
    cancelled: boolean,
  ) => {
    const selection = activeRegionSelectionRef.current
    if (!selection || selection.pointerId !== event.pointerId) return false
    activeRegionSelectionRef.current = null
    setActiveRegionSelection(null)
    if (cancelled) return true

    const bounds = normalizedBox(selection.startPoint, selection.endPoint)
    // A normal click on empty canvas keeps the familiar behavior: no object is
    // selected. A real drag uses the selected marquee mode for both drawing
    // shapes and placed Visual boxes.
    if (bounds.width < 4 || bounds.height < 4) return true
    const selectedIds = document.layers.flatMap((layer) => (
      !layer.visible || layer.locked
        ? []
        : (() => {
          const elements = layer.elements ?? []
          // A group is selected as one thing. In Inside mode, every member
          // must fit; in Touching mode, any overlap of its full group bounds
          // is enough to select the complete group.
          const groupBounds = new Map<string, ElementBounds>()
          for (const element of elements) {
            if (!element.groupId || groupBounds.has(element.groupId)) continue
            const members = elements.filter((candidate) => candidate.groupId === element.groupId)
            groupBounds.set(element.groupId, combinedElementBounds(members))
          }
          return elements.flatMap((element) => {
            const itemBounds = element.groupId
              ? groupBounds.get(element.groupId) ?? elementBounds(element)
              : elementBounds(element)
            return marqueeMatchesBounds(bounds, itemBounds, marqueeSelectionMode)
              ? [element.id]
              : []
          })
        })()
    ))
    const regionIds = selectedIds
    const regionEmbedIds = embeddedVisuals.flatMap((embed) => (
      marqueeMatchesBounds(bounds, embed.placement, marqueeSelectionMode) ? [embed.id] : []
    ))
    if (selection.toggleSelection) {
      setSelectedElementIds((currentIds) => {
        const currentIdSet = new Set(currentIds)
        const regionAlreadySelected = regionIds.length > 0 && regionIds.every((id) => currentIdSet.has(id))
        for (const id of regionIds) {
          if (regionAlreadySelected) currentIdSet.delete(id)
          else currentIdSet.add(id)
        }
        // Keep a stable document order for predictable inspector behavior.
        return document.layers.flatMap((layer) => (
          (layer.elements ?? []).flatMap((element) => currentIdSet.has(element.id) ? [element.id] : [])
        ))
      })
      setSelectedEmbedIds((currentIds) => {
        const currentIdSet = new Set(currentIds)
        const regionAlreadySelected = regionEmbedIds.length > 0
          && regionEmbedIds.every((id) => currentIdSet.has(id))
        for (const id of regionEmbedIds) {
          if (regionAlreadySelected) currentIdSet.delete(id)
          else currentIdSet.add(id)
        }
        return embeddedVisuals.flatMap((embed) => currentIdSet.has(embed.id) ? [embed.id] : [])
      })
    } else {
      setSelectedElementIds(regionIds)
      setSelectedEmbedIds(regionEmbedIds)
    }
    return true
  }

  /**
   * Start moving the exact mixed selection made by a marquee. Its source
   * content is never copied or changed: only drawing coordinates and the
   * parent-side placement of each Visual move together.
   */
  const startSelectedItemsMove = (event: ReactPointerEvent<SVGGElement>) => {
    const surface = surfaceRef.current
    if (!surface) return false

    const selectedElementIdSet = new Set(selectedElementIds)
    const elements = document.layers.flatMap((layer) => (
      !layer.visible || layer.locked
        ? []
        : (layer.elements ?? []).flatMap((element) => (
          selectedElementIdSet.has(element.id)
            ? [{
              layerId: layer.id,
              original: cloneSketchElement(element),
              element: cloneSketchElement(element),
            }]
            : []
        ))
    ))
    const selectedEmbedIdSet = new Set(selectedEmbedIds)
    const embeds = embeddedVisuals.flatMap((embed) => (
      selectedEmbedIdSet.has(embed.id)
        ? [{
          id: embed.id,
          original: { ...embed.placement },
          placement: { ...embed.placement },
        }]
        : []
    ))
    if (elements.length + embeds.length < 2) return false

    event.stopPropagation()
    clearPenTouchConflict(event)
    if (!surface.hasPointerCapture(event.pointerId)) surface.setPointerCapture(event.pointerId)
    const interaction: ActiveSelectionMove = {
      pointerId: event.pointerId,
      startPoint: pointFromPointer(event.nativeEvent, surface.getBoundingClientRect()),
      elements,
      embeds,
    }
    activeSelectionMoveRef.current = interaction
    setActiveSelectionMove(interaction)
    return true
  }

  const updateActiveSelectionMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const interaction = activeSelectionMoveRef.current
    if (!interaction || interaction.pointerId !== event.pointerId) return false

    const point = pointFromPointer(event.nativeEvent, event.currentTarget.getBoundingClientRect())
    const rawDx = point.x - interaction.startPoint.x
    const rawDy = point.y - interaction.startPoint.y
    const moveHorizontally = Math.abs(rawDx) >= Math.abs(rawDy)
    const dx = event.shiftKey && !moveHorizontally ? 0 : rawDx
    const dy = event.shiftKey && moveHorizontally ? 0 : rawDy
    const next: ActiveSelectionMove = {
      ...interaction,
      elements: interaction.elements.map((member) => ({
        ...member,
        element: {
          ...member.original,
          x: member.original.x + dx,
          y: member.original.y + dy,
        },
      })),
      embeds: interaction.embeds.map((embed) => ({
        ...embed,
        placement: {
          ...embed.original,
          x: embed.original.x + dx,
          y: embed.original.y + dy,
        },
      })),
    }
    activeSelectionMoveRef.current = next
    setActiveSelectionMove(next)

    if (next.embeds.length > 0) {
      const placements = new Map(next.embeds.map((embed) => [embed.id, embed.placement]))
      if (onEmbeddedVisualPlacementsChange) {
        onEmbeddedVisualPlacementsChange(placements)
      } else {
        for (const [id, placement] of placements) {
          onEmbeddedVisualPlacementChange?.(id, placement)
        }
      }
    }
    return true
  }

  const updateActiveEmbed = (event: ReactPointerEvent<SVGSVGElement>) => {
    const interaction = activeEmbedRef.current
    if (!interaction || interaction.pointerId !== event.pointerId) return false

    const point = pointFromPointer(event.nativeEvent, event.currentTarget.getBoundingClientRect())
    const dx = point.x - interaction.startPoint.x
    const dy = point.y - interaction.startPoint.y
    const placement: VisualEmbedPlacement = interaction.mode === 'move'
      ? {
        ...interaction.original,
        x: interaction.original.x + dx,
        y: interaction.original.y + dy,
      }
      : {
        ...interaction.original,
        ...((interaction.original.aspectRatioLocked !== false || event.shiftKey)
          ? proportionalDimensions(
            interaction.original,
            interaction.original.width + dx,
            interaction.original.height + dy,
            24,
          )
          : {
            width: Math.max(24, interaction.original.width + dx),
            height: Math.max(24, interaction.original.height + dy),
          }),
      }

    const next = { ...interaction, placement }
    activeEmbedRef.current = next
    setActiveEmbed(next)
    onEmbeddedVisualPlacementChange?.(interaction.embedId, placement)
    return true
  }

  const startEmbedInteraction = (
    event: ReactPointerEvent<SVGGElement>,
    embed: VisualEmbedInstance,
    mode: 'move' | 'resize',
  ) => {
    if (tool !== 'select' || !onEmbeddedVisualPlacementChange) return
    event.stopPropagation()
    const surface = surfaceRef.current
    if (!surface) return

    clearPenTouchConflict(event)
    // Clicking one already-selected Visual moves the entire marquee set;
    // clicking an unselected Visual retains the familiar single-selection.
    if (mode === 'move' && selectedEmbedIds.includes(embed.id) && startSelectedItemsMove(event)) return
    if (!surface.hasPointerCapture(event.pointerId)) surface.setPointerCapture(event.pointerId)
    const point = pointFromPointer(event.nativeEvent, surface.getBoundingClientRect())
    const interaction: ActiveEmbedInteraction = {
      pointerId: event.pointerId,
      embedId: embed.id,
      original: { ...embed.placement },
      placement: { ...embed.placement },
      startPoint: point,
      mode,
    }
    activeEmbedRef.current = interaction
    setActiveEmbed(interaction)
    setSelectedEmbedIds([embed.id])
    setSelectedElementIds([])
  }

  const updateActiveElement = (event: ReactPointerEvent<SVGSVGElement>) => {
    const interaction = activeElementRef.current
    if (!interaction || interaction.pointerId !== event.pointerId) return false
    const rawPoint = pointFromPointer(event.nativeEvent, event.currentTarget.getBoundingClientRect())
    const original = interaction.original
    let element = interaction.element
    let groupElements = interaction.groupElements

    if (interaction.mode === 'create') {
      const point = event.shiftKey && isLineElement(interaction.element.kind)
        ? axisLockedPoint(interaction.startPoint, rawPoint)
        : rawPoint
      element = createElement(
        interaction.element.kind as Exclude<SketchElement['kind'], 'text'>,
        interaction.startPoint,
        point,
        interaction.element.stroke,
        interaction.element.fill,
        interaction.element.strokeWidth,
        interaction.element.opacity,
      )
      // Preserve the temporary ID while the person drags; it becomes durable
      // only on pointer-up.
      element.id = interaction.element.id
    } else if (original && interaction.mode === 'move') {
      const rawDx = rawPoint.x - interaction.startPoint.x
      const rawDy = rawPoint.y - interaction.startPoint.y
      const moveHorizontally = Math.abs(rawDx) >= Math.abs(rawDy)
      const dx = event.shiftKey && !moveHorizontally ? 0 : rawDx
      const dy = event.shiftKey && moveHorizontally ? 0 : rawDy
      groupElements = interaction.groupMembers?.map((member) => ({
        ...member,
        x: member.x + dx,
        y: member.y + dy,
      }))
      element = groupElements?.find((member) => member.id === original.id)
        ?? { ...original, x: original.x + dx, y: original.y + dy }
    } else if (original && interaction.mode === 'resize') {
      if (interaction.groupMembers && interaction.groupMembers.length > 1) {
        const groupBounds = combinedElementBounds(interaction.groupMembers)
        const requestedWidth = Math.max(MIN_GROUP_DIMENSION, rawPoint.x - groupBounds.x)
        const requestedHeight = Math.max(MIN_GROUP_DIMENSION, rawPoint.y - groupBounds.y)
        // A multi-selection has no durable object of its own to store a lock
        // on, but holding Shift keeps the group proportional for this resize.
        const lockedSize = event.shiftKey
          ? proportionalDimensions(groupBounds, requestedWidth, requestedHeight)
          : { width: requestedWidth, height: requestedHeight }
        const width = Math.max(MIN_GROUP_DIMENSION, lockedSize.width)
        const height = Math.max(MIN_GROUP_DIMENSION, lockedSize.height)
        const scaleX = groupBounds.width === 0 ? 1 : width / groupBounds.width
        const scaleY = groupBounds.height === 0 ? 1 : height / groupBounds.height
        groupElements = interaction.groupMembers.map((member) => (
          scaleElementFromGroupBounds(member, groupBounds, scaleX, scaleY)
        ))
        element = groupElements.find((member) => member.id === original.id) ?? original
      } else if (isLineElement(original.kind)) {
        const point = event.shiftKey
          ? axisLockedPoint({ x: original.x, y: original.y }, rawPoint)
          : rawPoint
        element = {
          ...original,
          width: point.x - original.x,
          height: point.y - original.y,
        }
      } else {
        const keepAspectRatio = Boolean(original.aspectRatioLocked || event.shiftKey)
        // The resize handle is at lower-right, so a locked resize keeps the
        // opposite (top-left) corner stable instead of flipping the object.
        const box = keepAspectRatio
          ? {
            x: original.x,
            y: original.y,
            ...proportionalDimensions(
              original,
              rawPoint.x - original.x,
              rawPoint.y - original.y,
            ),
          }
          : normalizedBox({ x: original.x, y: original.y }, rawPoint)
        element = resizeCompoundElement(original, box)
      }
    }

    const next = { ...interaction, element, ...(groupElements ? { groupElements } : {}) }
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
    const isAlreadySelected = selectedElementIds.includes(element.id)
    // Shift-click adds a new item to a selection. Once an item is already in
    // the selection, Shift remains available for the promised axis-locked
    // drag. Cmd/Ctrl-click remains the explicit toggle/remove gesture.
    const selectionModifier = event.metaKey || event.ctrlKey || (event.shiftKey && !isAlreadySelected)
    if (selectionModifier) {
      const groupIds = selectedIdsIncludingLayerGroups(document, [element.id])
      setSelectedElementIds((currentIds) => {
        const currentIdSet = new Set(currentIds)
        const groupAlreadySelected = groupIds.every((id) => currentIdSet.has(id))
        for (const id of groupIds) {
          if (groupAlreadySelected) currentIdSet.delete(id)
          else currentIdSet.add(id)
        }
        return document.layers.flatMap((candidateLayer) => (
          (candidateLayer.elements ?? []).flatMap((candidate) => (
            currentIdSet.has(candidate.id) ? [candidate.id] : []
          ))
        ))
      })
      setSelectedEmbedIds([])
      return
    }
    // A selected drawing object can be the drag handle for a mixed marquee
    // selection. This includes shapes in other editable layers and placed
    // photo/canvas Visuals.
    if (mode === 'move' && isAlreadySelected && startSelectedItemsMove(event)) return
    if (!surface.hasPointerCapture(event.pointerId)) surface.setPointerCapture(event.pointerId)
    const point = pointFromPointer(event.nativeEvent, surface.getBoundingClientRect())
    const selectedMembers = isAlreadySelected
      ? (layer.elements ?? []).filter((candidate) => selectedElementIds.includes(candidate.id))
      : []
    // A temporary multi-selection moves together even before the person
    // decides it deserves a durable `groupId`. A saved group uses the same
    // movement path, but remains a relationship after selection changes.
    const groupMembers = selectedMembers.length > 1
      ? selectedMembers.map(cloneSketchElement)
      : element.groupId
      ? (layer.elements ?? [])
        .filter((candidate) => candidate.groupId === element.groupId)
        .map(cloneSketchElement)
      : []
    const interaction: ActiveElementInteraction = {
      pointerId: event.pointerId,
      layerId: layer.id,
      element: cloneSketchElement(element),
      original: cloneSketchElement(element),
      ...(groupMembers.length > 1 ? { groupMembers } : {}),
      startPoint: point,
      mode,
    }
    activeElementRef.current = interaction
    setActiveElement(interaction)
    setSelectedElementIds(
      groupMembers.length > 1
        ? selectedIdsIncludingLayerGroups(document, groupMembers.map((member) => member.id))
        : selectedIdsIncludingLayerGroups(document, [element.id]),
    )
    setSelectedEmbedIds([])
  }

  const beginInteraction = (event: ReactPointerEvent<SVGSVGElement>) => {
    event.stopPropagation()
    // Finger gestures remain navigation while drawing. When a person
    // deliberately picks, creates, or erases an object, that same finger
    // operates on the canvas; Pan is always available for navigation.
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
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.setPointerCapture(event.pointerId)
      }
      const point = pointFromPointer(event.nativeEvent, event.currentTarget.getBoundingClientRect())
      const selection: ActiveRegionSelection = {
        pointerId: event.pointerId,
        startPoint: point,
        endPoint: point,
        toggleSelection: event.metaKey || event.ctrlKey,
      }
      activeRegionSelectionRef.current = selection
      setActiveRegionSelection(selection)
      if (!selection.toggleSelection) {
        setSelectedElementIds([])
        setSelectedEmbedIds([])
      }
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
      setSelectedElementIds([element.id])
      setSelectedEmbedIds([])
      setTool('select')
      return
    }

    if (isShapeTool(tool)) {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.setPointerCapture(event.pointerId)
      }
      const element = createElement(tool, point, point, color, fillColor, brushWidth, opacity)
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
      setSelectedElementIds([element.id])
      setSelectedEmbedIds([])
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

    if (updateActiveRegionSelection(event)) return
    if (updateActiveSelectionMove(event)) return
    if (updateActiveEmbed(event)) return
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
    const hasUsefulSize = isLineElement(element.kind)
      ? Math.hypot(element.width, element.height) >= 4
      : element.width >= 4 && element.height >= 4
    if (interaction.mode === 'create' && !hasUsefulSize) {
      setSelectedElementIds([])
      return true
    }
    if (
      (interaction.mode === 'move' || interaction.mode === 'resize')
      && interaction.groupElements
      && interaction.groupElements.length > 1
    ) {
      const groupElementsById = new Map(interaction.groupElements.map((member) => [member.id, member]))
      commit(replaceLayer(document, interaction.layerId, (layer) => ({
        ...layer,
        elements: (layer.elements ?? []).map((candidate) => (
          groupElementsById.get(candidate.id) ?? candidate
        )),
      })))
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

  const finishActiveSelectionMove = (
    event: ReactPointerEvent<SVGSVGElement>,
    cancelled: boolean,
  ) => {
    const interaction = activeSelectionMoveRef.current
    if (!interaction || interaction.pointerId !== event.pointerId) return false
    activeSelectionMoveRef.current = null
    setActiveSelectionMove(null)
    if (cancelled) return true

    // All selected drawing objects commit as one document change, so Undo
    // restores the whole marquee move rather than one object at a time.
    if (interaction.elements.length > 0) {
      const movedByLayer = new Map<string, Map<string, SketchElement>>()
      for (const member of interaction.elements) {
        const elements = movedByLayer.get(member.layerId) ?? new Map<string, SketchElement>()
        elements.set(member.element.id, member.element)
        movedByLayer.set(member.layerId, elements)
      }
      commit({
        ...document,
        layers: document.layers.map((layer) => {
          const movedElements = movedByLayer.get(layer.id)
          if (!movedElements) return layer
          return {
            ...layer,
            elements: (layer.elements ?? []).map((element) => movedElements.get(element.id) ?? element),
          }
        }),
      })
    }

    if (interaction.embeds.length > 0) {
      const placements = new Map(interaction.embeds.map((embed) => [embed.id, embed.placement]))
      if (onEmbeddedVisualPlacementsChange) {
        onEmbeddedVisualPlacementsChange(placements)
      } else {
        for (const [id, placement] of placements) {
          onEmbeddedVisualPlacementChange?.(id, placement)
        }
      }
    }
    return true
  }

  const finishActiveEmbed = (
    event: ReactPointerEvent<SVGSVGElement>,
    cancelled: boolean,
  ) => {
    const interaction = activeEmbedRef.current
    if (!interaction || interaction.pointerId !== event.pointerId) return false
    activeEmbedRef.current = null
    setActiveEmbed(null)
    if (cancelled) return true

    // Most moves have already streamed their draft placement through the
    // callback. Send the final value as well so a click/release sequence is
    // always deterministic for the parent canvas draft.
    onEmbeddedVisualPlacementChange?.(interaction.embedId, interaction.placement)
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

    if (finishActiveRegionSelection(event, cancelled)) {
      if (activePenPointerIdRef.current === event.pointerId) {
        activePenPointerIdRef.current = null
        ignoreTouchUntilRef.current = event.timeStamp + 300
      }
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
      return
    }

    if (finishActiveSelectionMove(event, cancelled)) {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
      return
    }

    if (finishActiveEmbed(event, cancelled)) {
      if (activePenPointerIdRef.current === event.pointerId) {
        activePenPointerIdRef.current = null
        ignoreTouchUntilRef.current = event.timeStamp + 300
      }
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
    if (finishActiveRegionSelection(event, true)) {
      if (activePenPointerIdRef.current === event.pointerId) {
        activePenPointerIdRef.current = null
        ignoreTouchUntilRef.current = event.timeStamp + 300
      }
      return
    }
    if (finishActiveSelectionMove(event, true)) return
    if (finishActiveEmbed(event, true)) {
      if (activePenPointerIdRef.current === event.pointerId) {
        activePenPointerIdRef.current = null
        ignoreTouchUntilRef.current = event.timeStamp + 300
      }
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

  /** The erase tool removes durable shapes/text as well as freehand strokes. */
  const eraseElement = useCallback((layerId: string, elementId: string) => {
    const layer = document.layers.find((candidate) => candidate.id === layerId)
    if (!layer || layer.locked) return
    commit(replaceLayer(document, layerId, (candidate) => ({
      ...candidate,
      elements: (candidate.elements ?? []).filter((element) => element.id !== elementId),
    })))
    setSelectedElementIds((ids) => ids.filter((id) => id !== elementId))
  }, [commit, document])

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
    setSelectedElementIds([])
  }

  const updateSelectedElement = (update: Partial<SketchElement>) => {
    if (!selectedElement || selectedElementCount !== 1 || selectedElement.layer.locked) return
    const { layer, element } = selectedElement
    commit(replaceLayer(document, layer.id, (candidate) => ({
      ...candidate,
      elements: (candidate.elements ?? []).map((item) => (
        item.id === element.id ? resizeCompoundElement(item, update) : item
      )),
    })))
  }

  /** Bind the selected text box to one current project value. */
  const bindSelectedTextToProjectValue = () => {
    if (
      !selectedElement
      || selectedElementCount !== 1
      || selectedElement.element.kind !== 'text'
      || !selectedAnnotationTarget
    ) return

    const field = selectedAnnotationFields.find((candidate) => (
      candidate.field === effectiveAnnotationField
      && candidate.propertyKey === (
        effectiveAnnotationField === 'property' ? effectiveAnnotationPropertyKey : undefined
      )
    ))
    if (!field) return

    const annotation: SketchTextAnnotation = {
      kind: 'project-value',
      targetId: selectedAnnotationTarget.id,
      field: field.field,
      ...(field.field === 'property' ? { propertyKey: field.propertyKey } : {}),
      // The fallback makes a missing/deleted project object readable instead
      // of turning a finished drawing into a blank annotation.
      fallback: selectedElement.element.text || annotationTargetLabel(selectedAnnotationTarget),
    }
    const currentValue = resolveSketchTextAnnotation(annotation, annotationTargetOptions)
    updateSelectedElement({
      annotation,
      text: currentValue ?? annotation.fallback,
    })
  }

  /** Turns a live annotation into ordinary text at its currently shown value. */
  const makeSelectedTextLiteral = () => {
    if (!selectedElement || selectedElementCount !== 1 || selectedElement.element.kind !== 'text') return
    updateSelectedElement({
      text: resolvedSketchText(selectedElement.element, annotationTargetOptions),
      annotation: undefined,
    })
  }

  /**
   * Binds one visual channel to an item's live semantic color. Clearing the
   * picker leaves the ordinary saved color untouched and returns to it.
   */
  const setSelectedSemanticColorBinding = (
    channel: keyof SketchSemanticColorBindings,
    targetId: string,
  ) => {
    if (
      !selectedElement
      || selectedElementCount !== 1
      || selectedElement.layer.locked
      || selectedElement.element.kind === 'compound'
    ) return

    const semanticColors: SketchSemanticColorBindings = {
      ...selectedElement.element.semanticColors,
    }
    if (targetId) {
      semanticColors[channel] = { kind: 'project-semantic-color', targetId }
    } else {
      delete semanticColors[channel]
    }
    updateSelectedElement({
      semanticColors: Object.keys(semanticColors).length > 0 ? semanticColors : undefined,
    })
  }

  /** A locked shape updates both numeric size fields as one durable edit. */
  const updateSelectedShapeDimension = (dimension: 'width' | 'height', value: number) => {
    if (!selectedElement || selectedElementCount !== 1 || !isResizableShape(selectedElement.element.kind)) return
    updateSelectedElement(sizedElementUpdate(selectedElement.element, dimension, value))
  }

  /** Resize the selected durable group from its top-left group boundary. */
  const updateSelectedGroupSize = (dimension: 'width' | 'height', value: number) => {
    if (!selectedGroup || !selectedGroupBounds || !Number.isFinite(value)) return
    const nextDimension = Math.max(MIN_GROUP_DIMENSION, value)
    const scaleX = dimension === 'width'
      ? (selectedGroupBounds.width === 0 ? 1 : nextDimension / selectedGroupBounds.width)
      : 1
    const scaleY = dimension === 'height'
      ? (selectedGroupBounds.height === 0 ? 1 : nextDimension / selectedGroupBounds.height)
      : 1
    const membersById = new Map(selectedGroup.members.map((member) => [member.id, member]))

    commit(replaceLayer(document, selectedGroup.layer.id, (layer) => ({
      ...layer,
      elements: (layer.elements ?? []).map((element) => {
        const member = membersById.get(element.id)
        return member
          ? scaleElementFromGroupBounds(member, selectedGroupBounds, scaleX, scaleY)
          : element
      }),
    })))
  }

  /** Move the selected durable group without changing any member's geometry. */
  const updateSelectedGroupPosition = (dimension: 'x' | 'y', value: number) => {
    if (!selectedGroup || !selectedGroupBounds || !Number.isFinite(value)) return
    const deltaX = dimension === 'x' ? value - selectedGroupBounds.x : 0
    const deltaY = dimension === 'y' ? value - selectedGroupBounds.y : 0
    if (deltaX === 0 && deltaY === 0) return
    const memberIds = new Set(selectedGroup.members.map((member) => member.id))

    commit(replaceLayer(document, selectedGroup.layer.id, (layer) => ({
      ...layer,
      elements: (layer.elements ?? []).map((element) => (
        memberIds.has(element.id)
          ? { ...element, x: element.x + deltaX, y: element.y + deltaY }
          : element
      )),
    })))
  }

  /** Give the selected same-layer shapes one durable canvas-local group ID. */
  const groupSelectedElements = () => {
    if (!canGroupSelectedElements || !selectedElement) return
    const groupId = crypto.randomUUID()
    const selectedIds = new Set(selectedElementIds)
    commit(replaceLayer(document, selectedElement.layer.id, (layer) => ({
      ...layer,
      elements: (layer.elements ?? []).map((element) => (
        selectedIds.has(element.id) ? { ...element, groupId } : element
      )),
    })))
  }

  /** Remove the grouping relationship without changing any underlying shape. */
  const ungroupSelectedElements = () => {
    if (!canUngroupSelectedElements || !selectedElement) return
    const groupIds = new Set(selectedGroupIds)
    commit(replaceLayer(document, selectedElement.layer.id, (layer) => ({
      ...layer,
      elements: (layer.elements ?? []).map((element) => {
        if (!element.groupId || !groupIds.has(element.groupId)) return element
        const ungroupedElement = { ...element }
        delete ungroupedElement.groupId
        return ungroupedElement
      }),
    })))
  }

  /**
   * Replace overlapping filled primitives with one compound object. The parts
   * remain inside that object so "break apart" can restore editable pieces,
   * but the canvas now renders a single shared exterior outline.
   */
  const combineSelectedElements = () => {
    if (!canCombineSelectedElements || !selectedElement) return
    const selectedIds = new Set(selectedElementIds)
    const layer = selectedElement.layer
    const members = (layer.elements ?? []).filter((element) => selectedIds.has(element.id))
    if (members.length < 2) return

    const bounds = combinedElementBounds(members)
    const firstMember = members[0]
    const compound: SketchElement = {
      id: crypto.randomUUID(),
      kind: 'compound',
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      stroke: firstMember.stroke,
      fill: firstMember.fill,
      strokeWidth: firstMember.strokeWidth,
      opacity: firstMember.opacity,
      compoundParts: members.map((member) => ({
        id: crypto.randomUUID(),
        // `canCombineSelectedElements` ensures only enclosed primitive kinds
        // reach this conversion.
        kind: member.kind as SketchCompoundPart['kind'],
        x: member.x - bounds.x,
        y: member.y - bounds.y,
        width: member.width,
        height: member.height,
        ...(member.kind === 'rounded-rectangle' && typeof member.cornerRadius === 'number'
          ? { cornerRadius: member.cornerRadius }
          : {}),
      })),
    }
    const firstMemberId = members[0].id

    commit(replaceLayer(document, layer.id, (candidate) => ({
      ...candidate,
      elements: (candidate.elements ?? []).flatMap((element) => {
        if (element.id === firstMemberId) return [compound]
        return selectedIds.has(element.id) ? [] : [element]
      }),
    })))
    setSelectedElementIds([compound.id])
    setSelectedEmbedIds([])
  }

  /** Restore a compound shape's saved primitive parts as independent shapes. */
  const breakApartSelectedElement = () => {
    if (!canBreakApartSelectedElement || !selectedElement) return
    const { layer, element } = selectedElement
    const parts = element.compoundParts ?? []
    const restoredParts: SketchElement[] = parts.map((part) => ({
      id: crypto.randomUUID(),
      kind: part.kind,
      x: element.x + part.x,
      y: element.y + part.y,
      width: part.width,
      height: part.height,
      stroke: element.stroke,
      fill: element.fill,
      strokeWidth: element.strokeWidth,
      opacity: element.opacity,
      ...(part.kind === 'rounded-rectangle' && typeof part.cornerRadius === 'number'
        ? { cornerRadius: part.cornerRadius }
        : {}),
    }))
    if (restoredParts.length === 0) return

    commit(replaceLayer(document, layer.id, (candidate) => ({
      ...candidate,
      elements: (candidate.elements ?? []).flatMap((candidateElement) => (
        candidateElement.id === element.id ? restoredParts : [candidateElement]
      )),
    })))
    setSelectedElementIds(restoredParts.map((part) => part.id))
  }

  /** Apply one shared appearance value across the current multi-selection. */
  const updateSelectedElements = useCallback((
    update: Partial<SketchElement>,
    { fillableOnly = false }: { fillableOnly?: boolean } = {},
  ) => {
    if (selectedElementIds.length === 0) return
    const selectedIds = new Set(selectedElementIds)
    const canUpdate = document.layers.some((layer) => (
      !layer.locked && (layer.elements ?? []).some((element) => (
        selectedIds.has(element.id) && (!fillableOnly || isFillableElement(element.kind))
      ))
    ))
    if (!canUpdate) return
    commit({
      ...document,
      layers: document.layers.map((layer) => (
        layer.locked
          ? layer
          : {
            ...layer,
            elements: (layer.elements ?? []).map((element) => (
              selectedIds.has(element.id) && (!fillableOnly || isFillableElement(element.kind))
                ? { ...element, ...update }
                : element
            )),
          }
      )),
    })
  }, [commit, document, selectedElementIds])

  /** Nudge every selected shape without changing its dimensions or direction. */
  const nudgeSelectedElements = useCallback((dx: number, dy: number) => {
    if (selectedElementIds.length === 0) return
    const selectedIds = new Set(selectedElementIds)
    const canMove = document.layers.some((layer) => (
      !layer.locked && (layer.elements ?? []).some((element) => selectedIds.has(element.id))
    ))
    if (!canMove) return
    commit({
      ...document,
      layers: document.layers.map((layer) => (
        layer.locked
          ? layer
          : {
            ...layer,
            elements: (layer.elements ?? []).map((element) => (
              selectedIds.has(element.id)
                ? { ...element, x: element.x + dx, y: element.y + dy }
                : element
            )),
          }
      )),
    })
  }, [commit, document, selectedElementIds])

  const deleteSelectedElements = useCallback(() => {
    if (selectedElementIds.length === 0) return
    const ids = new Set(selectedElementIds)
    const canDelete = document.layers.some((layer) => (
      !layer.locked && (layer.elements ?? []).some((element) => ids.has(element.id))
    ))
    if (!canDelete) return
    commit({
      ...document,
      layers: document.layers.map((layer) => (
        layer.locked
          ? layer
          : { ...layer, elements: (layer.elements ?? []).filter((element) => !ids.has(element.id)) }
      )),
    })
    setSelectedElementIds([])
  }, [commit, document, selectedElementIds])

  /** Copy selected shapes into this canvas's local clipboard without changing the drawing. */
  const copySelectedElements = useCallback(() => {
    if (selectedElementIds.length === 0) return
    const ids = new Set(selectedElementIds)
    const copiedShapes = document.layers.flatMap((layer) => (
      layer.locked
        ? []
        : (layer.elements ?? [])
          .filter((element) => ids.has(element.id))
          .map((element) => ({ layerId: layer.id, element: cloneSketchElement(element) }))
    ))
    shapeClipboardRef.current = copiedShapes
    pasteOffsetRef.current = 0
    setClipboardCount(copiedShapes.length)
  }, [document, selectedElementIds])

  /**
   * Paste a new copy each time. The increasing offset makes repeated pastes
   * visible instead of placing identical shapes directly on top of each other.
   */
  const pasteCopiedElements = useCallback(() => {
    const copiedShapes = shapeClipboardRef.current
    if (copiedShapes.length === 0) return
    const offset = 24 * (pasteOffsetRef.current + 1)
    const pastedIds: string[] = []
    // A copied group remains grouped internally, but becomes a distinct group
    // so moving the pasted version never moves its source shapes.
    const copiedGroupIds = new Map<string, string>()
    const nextDocument: SketchDocument = {
      ...document,
      layers: document.layers.map((layer) => {
        if (layer.locked) return layer
        const pastedShapes = copiedShapes
          .filter((item) => item.layerId === layer.id)
          .map(({ element }) => {
            const id = crypto.randomUUID()
            pastedIds.push(id)
            const groupId = element.groupId
              ? (copiedGroupIds.get(element.groupId) ?? (() => {
                const nextGroupId = crypto.randomUUID()
                copiedGroupIds.set(element.groupId as string, nextGroupId)
                return nextGroupId
              })())
              : undefined
            return {
              ...cloneSketchElement(element),
              id,
              x: element.x + offset,
              y: element.y + offset,
              ...(groupId ? { groupId } : {}),
            }
          })
        return pastedShapes.length === 0
          ? layer
          : { ...layer, elements: [...(layer.elements ?? []), ...pastedShapes] }
      }),
    }
    if (pastedIds.length === 0) return
    pasteOffsetRef.current += 1
    commit(nextDocument)
    setSelectedElementIds(pastedIds)
    setSelectedEmbedIds([])
  }, [commit, document])

  /**
   * `elements` are rendered in array order. Moving one object here changes
   * its local z-order without changing the rest of the canvas or any asset.
   */
  const moveSelectedElement = (direction: 'forward' | 'back') => {
    if (!selectedElement || selectedElementCount !== 1 || selectedElement.layer.locked) return
    const { layer, element } = selectedElement
    const currentIndex = (layer.elements ?? []).findIndex((item) => item.id === element.id)
    const nextIndex = direction === 'forward' ? currentIndex + 1 : currentIndex - 1
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= (layer.elements ?? []).length) return
    commit(replaceLayer(document, layer.id, (candidate) => {
      const elements = [...(candidate.elements ?? [])]
      const [moved] = elements.splice(currentIndex, 1)
      elements.splice(nextIndex, 0, moved)
      return { ...candidate, elements }
    }))
  }

  /** Removes only this canvas's placement edge; the child Visual survives. */
  const removeEmbed = useCallback((embedId: string) => {
    onEmbeddedVisualRemove?.(embedId)
    setSelectedEmbedIds((currentIds) => currentIds.filter((id) => id !== embedId))
  }, [onEmbeddedVisualRemove])

  useEffect(() => {
    const handleCanvasShortcut = (event: KeyboardEvent) => {
      // Do not repurpose normal editing keys while a person is typing a label,
      // text object, page size, or other control in the editor.
      const target = event.target
      const typingIntoControl = target instanceof HTMLInputElement
        || target instanceof HTMLTextAreaElement
        || target instanceof HTMLSelectElement
        || (target instanceof HTMLElement && target.isContentEditable)
      if (typingIntoControl) return

      const commandOrControl = event.metaKey || event.ctrlKey
      if (commandOrControl && event.key.toLowerCase() === 'z') {
        // This follows the standard canvas convention on both macOS and
        // Windows: Cmd/Ctrl+Z reverses a change; Shift re-applies it.
        const redoRequested = event.shiftKey
        const historyAvailable = redoRequested
          ? redoStack.current.length > 0
          : undoStack.current.length > 0
        if (!historyAvailable) return
        event.preventDefault()
        if (redoRequested) {
          redo()
        } else {
          undo()
        }
        return
      }
      if (commandOrControl && event.key.toLowerCase() === 'c') {
        if (selectedElementCount === 0) return
        event.preventDefault()
        copySelectedElements()
        return
      }
      if (commandOrControl && event.key.toLowerCase() === 'v') {
        if (clipboardCount === 0) return
        event.preventDefault()
        pasteCopiedElements()
        return
      }
      const nudgeDirections: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      }
      const nudgeDirection = nudgeDirections[event.key]
      if (nudgeDirection) {
        if (selectedElementCount === 0) return
        event.preventDefault()
        const distance = event.shiftKey ? 10 : 1
        nudgeSelectedElements(nudgeDirection[0] * distance, nudgeDirection[1] * distance)
        return
      }
      if (event.key !== 'Backspace' && event.key !== 'Delete') return
      if (selectedEmbedIds.length === 0 && selectedElementCount === 0) return
      event.preventDefault()
      // Embedded Visuals are placements, so Delete only removes their parent
      // placement—not the child Visual that can be used elsewhere.
      for (const embedId of selectedEmbedIds) removeEmbed(embedId)
      if (selectedElementCount > 0) deleteSelectedElements()
    }

    window.addEventListener('keydown', handleCanvasShortcut)
    return () => window.removeEventListener('keydown', handleCanvasShortcut)
  }, [clipboardCount, copySelectedElements, deleteSelectedElements, nudgeSelectedElements, pasteCopiedElements, redo, removeEmbed, selectedElementCount, selectedEmbedIds, undo])

  const activeElementsById = new Map(
    activeElement?.groupElements?.map((element) => [element.id, element])
      ?? (activeElement && activeElement.mode !== 'create' ? [[activeElement.element.id, activeElement.element]] : []),
  )
  const activeSelectionElementsById = new Map(
    activeSelectionMove?.elements.map((member) => [member.element.id, member.element]) ?? [],
  )
  const renderedLayers = document.layers.map((layer) => ({
    ...layer,
    elements: activeElement?.mode === 'create' && layer.id === activeElement.layerId
      ? [...(layer.elements ?? []), activeElement.element]
      : (layer.elements ?? []).map((element) => (
        activeSelectionElementsById.get(element.id) ?? activeElementsById.get(element.id) ?? element
      )),
    strokes: activeStroke && layer.id === activeStrokeLayerId
      ? [...layer.strokes, activeStroke]
      : layer.strokes,
  }))
  const selectedGroupForRender = selectedGroup
    ? renderedLayers.find((layer) => layer.id === selectedGroup.layer.id)
    : undefined
  const selectedGroupMembersForRender = selectedGroupForRender && selectedGroup
    ? (selectedGroupForRender.elements ?? []).filter((element) => element.groupId === selectedGroup.id)
    : []
  const selectedGroupBoundsForRender = selectedGroupMembersForRender.length > 0
    ? combinedElementBounds(selectedGroupMembersForRender)
    : null
  // A durable group gets one tight frame rather than a dashed rectangle around
  // every member. Individual and temporary multi-selections keep their normal
  // per-shape feedback.
  const selectedElementIdsForRender = selectedGroup ? [] : selectedElementIds
  const selectedElementForRender = selectedElement && selectedElementCount === 1 && activeElement?.element.id === selectedElement.element.id
    ? { ...selectedElement, element: activeElement.element }
    : selectedElementCount === 1 ? selectedElement : undefined
  const activeSelectionEmbedsById = new Map(
    activeSelectionMove?.embeds.map((embed) => [embed.id, embed.placement]) ?? [],
  )
  const renderedEmbeds = embeddedVisuals.map((embed) => {
    const movedPlacement = activeSelectionEmbedsById.get(embed.id)
    if (movedPlacement) return { ...embed, placement: { ...movedPlacement } }
    return activeEmbed?.embedId === embed.id
      ? { ...embed, placement: { ...activeEmbed.placement } }
      : embed
  })
  const selectedEmbedForRender = selectedEmbedIds.length === 1
    ? renderedEmbeds.find((embed) => embed.id === selectedEmbedIds[0])
    : undefined
  const selectedEmbedPlacement = selectedEmbedForRender?.placement ?? selectedEmbed?.placement
  /** Update the parent-side image box only; the referenced Visual is unchanged. */
  const updateSelectedEmbedPlacement = (update: Partial<VisualEmbedPlacement>) => {
    if (!selectedEmbedForRender || !onEmbeddedVisualPlacementChange) return
    onEmbeddedVisualPlacementChange(selectedEmbedForRender.id, {
      ...selectedEmbedForRender.placement,
      ...update,
    })
  }
  /** A locked photo/Visual box updates both dimensions as one placement edit. */
  const updateSelectedEmbedDimension = (dimension: 'width' | 'height', value: number) => {
    if (!selectedEmbedPlacement) return
    updateSelectedEmbedPlacement(sizedEmbedPlacementUpdate(selectedEmbedPlacement, dimension, value))
  }
  const onSelectedElementResizePointerDown = (event: ReactPointerEvent<SVGGElement>) => {
    if (!selectedElementForRender) return
    startElementInteraction(
      event,
      selectedElementForRender.layer,
      selectedElementForRender.element,
      'resize',
    )
  }
  const onSelectedGroupResizePointerDown = (event: ReactPointerEvent<SVGGElement>) => {
    if (!selectedGroup || selectedGroup.members.length === 0) return
    startElementInteraction(
      event,
      selectedGroup.layer,
      selectedGroup.members[0],
      'resize',
    )
  }
  const onSelectedEmbedResizePointerDown = (event: ReactPointerEvent<SVGGElement>) => {
    if (!selectedEmbedForRender) return
    startEmbedInteraction(event, selectedEmbedForRender, 'resize')
  }

  return (
    <div className="sketch-editor">
      <div className="sketch-editor__toolbar" aria-label="Sketch tools">
        <div className="sketch-editor__tool-group" aria-label="Navigate canvas">
          {([
            ['select', 'select'],
            ['pan', 'hand'],
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
        {tool === 'select' ? (
          <div className="sketch-editor__tool-group" aria-label="Marquee selection mode">
            <button
              type="button"
              className={marqueeSelectionMode === 'inside' ? 'is-selected' : undefined}
              aria-pressed={marqueeSelectionMode === 'inside'}
              title="Select items fully inside the marquee"
              onClick={() => setMarqueeSelectionMode('inside')}
            >
              inside
            </button>
            <button
              type="button"
              className={marqueeSelectionMode === 'touching' ? 'is-selected' : undefined}
              aria-pressed={marqueeSelectionMode === 'touching'}
              title="Select items the marquee touches"
              onClick={() => setMarqueeSelectionMode('touching')}
            >
              touching
            </button>
          </div>
        ) : null}
        <div className="sketch-editor__tool-group" aria-label="Add shapes">
          {([
            ['rectangle', 'box'],
            ['rounded-rectangle', 'round'],
            ['ellipse', 'oval'],
            ['diamond', 'diamond'],
            ['triangle', 'triangle'],
            ['line', 'line'],
            ['arrow', 'arrow'],
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
        <div className="sketch-editor__tool-group" aria-label="Draw and edit">
          {([
            ['text', 'text'],
            ['pen', 'pen'],
            ['eraser', 'erase'],
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
        <div className="sketch-editor__fill" aria-label="New shape fill">
          <button
            type="button"
            className={fillColor === 'transparent' ? 'is-selected' : undefined}
            aria-label="Use no fill for new shapes"
            title="No fill"
            onClick={() => setFillColor('transparent')}
          >
            no fill
          </button>
          <input
            type="color"
            aria-label="New shape fill color"
            value={fillColor === 'transparent' ? '#ffffff' : fillColor}
            onChange={(event) => setFillColor(event.target.value)}
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
            {renderedEmbeds.map((embed) => (
              <EmbeddedVisualGraphic
                key={embed.id}
                embed={embed}
                annotationTargets={annotationTargets}
                interactive={(
                  (tool === 'select' && Boolean(onEmbeddedVisualPlacementChange))
                  || (tool === 'eraser' && Boolean(onEmbeddedVisualRemove))
                )}
                selected={tool === 'select' && selectedEmbedIds.includes(embed.id)}
                onPointerDown={(event) => {
                  if (tool === 'eraser') {
                    event.stopPropagation()
                    clearPenTouchConflict(event)
                    removeEmbed(embed.id)
                    return
                  }
                  startEmbedInteraction(event, embed, 'move')
                }}
              />
            ))}
            {renderedLayers.filter((layer) => layer.visible).flatMap((layer) => [
              <SketchLayerElementGraphics
                key={`${layer.id}-elements`}
                layer={layer}
                interactive={(tool === 'select' || tool === 'eraser') && !layer.locked}
                selectedElementIds={selectedElementIdsForRender}
                annotationTargets={annotationTargets}
                onElementPointerDown={(event, element) => {
                  if (tool === 'eraser') {
                    event.stopPropagation()
                    clearPenTouchConflict(event)
                    eraseElement(layer.id, element.id)
                    return
                  }
                  startElementInteraction(event, layer, element, 'move')
                }}
              />,
              ...layer.strokes.map((stroke) => (
                <Stroke
                  key={stroke.id}
                  stroke={stroke}
                  erase={tool === 'eraser'}
                  onErase={(event) => {
                    event.stopPropagation()
                    clearPenTouchConflict(event)
                    eraseStroke(layer.id, stroke.id)
                  }}
                />
              )),
            ])}
            {tool === 'select' && activeRegionSelection ? (() => {
              const bounds = normalizedBox(
                activeRegionSelection.startPoint,
                activeRegionSelection.endPoint,
              )
              return (
                <rect
                  className="sketch-selection-marquee"
                  x={bounds.x}
                  y={bounds.y}
                  width={bounds.width}
                  height={bounds.height}
                  pointerEvents="none"
                />
              )
            })() : null}
            {tool === 'select' && selectedGroup && selectedGroupBoundsForRender ? (() => {
              const bounds = selectedGroupBoundsForRender
              return (
                <>
                  <rect
                    x={bounds.x - 3}
                    y={bounds.y - 3}
                    width={Math.max(bounds.width + 6, 10)}
                    height={Math.max(bounds.height + 6, 10)}
                    fill="none"
                    stroke="#26799b"
                    strokeWidth={2}
                    strokeDasharray="7 5"
                    pointerEvents="none"
                  />
                  <g
                    className="sketch-element__resize-handle"
                    onPointerDown={onSelectedGroupResizePointerDown}
                  >
                    <rect
                      x={bounds.x + bounds.width - 7}
                      y={bounds.y + bounds.height - 7}
                      width={14}
                      height={14}
                      fill="#eaf6fb"
                      stroke="#26799b"
                      strokeWidth={2}
                      rx={2}
                    />
                  </g>
                </>
              )
            })() : null}
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
            {tool === 'select' && selectedEmbedForRender && onEmbeddedVisualPlacementChange ? (
              <g
                className="sketch-visual-embed__resize-handle"
                onPointerDown={onSelectedEmbedResizePointerDown}
              >
                <rect
                  x={selectedEmbedForRender.placement.x + selectedEmbedForRender.placement.width - 9}
                  y={selectedEmbedForRender.placement.y + selectedEmbedForRender.placement.height - 9}
                  width={18}
                  height={18}
                  fill="#eaf6fb"
                  stroke="#26799b"
                  strokeWidth={2}
                  rx={2}
                />
              </g>
            ) : null}
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
                <h3>{selectedElementCount === 1 ? selectedElement.element.kind : `${selectedElementCount} shapes`}</h3>
                <div className="sketch-editor__object-actions">
                  <button type="button" onClick={copySelectedElements}>copy</button>
                  <button
                    type="button"
                    disabled={clipboardCount === 0}
                    onClick={pasteCopiedElements}
                  >
                    paste
                  </button>
                  {canCombineSelectedElements ? (
                    <button type="button" onClick={combineSelectedElements}>combine</button>
                  ) : null}
                  {canGroupSelectedElements ? (
                    <button type="button" onClick={groupSelectedElements}>group</button>
                  ) : null}
                  {canUngroupSelectedElements ? (
                    <button type="button" onClick={ungroupSelectedElements}>ungroup</button>
                  ) : null}
                  {canBreakApartSelectedElement ? (
                    <button type="button" onClick={breakApartSelectedElement}>break apart</button>
                  ) : null}
                  {selectedElementCount === 1 ? (
                    <>
                      <button type="button" onClick={() => moveSelectedElement('back')}>back</button>
                      <button type="button" onClick={() => moveSelectedElement('forward')}>forward</button>
                    </>
                  ) : null}
                  <button type="button" onClick={deleteSelectedElements}>delete</button>
                </div>
              </div>
              {selectedElementCount > 1 ? (
                <>
                  {selectedGroupBounds ? (
                    <>
                      <label>
                        <span>Group X</span>
                        <input
                          type="number"
                          aria-label="Selected group horizontal position"
                          min="-20000"
                          max="20000"
                          step="1"
                          value={Math.round(selectedGroupBounds.x)}
                          onChange={(event) => {
                            const x = Number(event.target.value)
                            if (Number.isFinite(x)) updateSelectedGroupPosition('x', x)
                          }}
                        />
                      </label>
                      <label>
                        <span>Group Y</span>
                        <input
                          type="number"
                          aria-label="Selected group vertical position"
                          min="-20000"
                          max="20000"
                          step="1"
                          value={Math.round(selectedGroupBounds.y)}
                          onChange={(event) => {
                            const y = Number(event.target.value)
                            if (Number.isFinite(y)) updateSelectedGroupPosition('y', y)
                          }}
                        />
                      </label>
                      <label>
                        <span>Group width</span>
                        <input
                          type="number"
                          aria-label="Selected group width"
                          min={MIN_GROUP_DIMENSION}
                          max="20000"
                          step="1"
                          value={Math.round(selectedGroupBounds.width)}
                          onChange={(event) => {
                            const width = Number(event.target.value)
                            if (Number.isFinite(width) && width >= MIN_GROUP_DIMENSION) {
                              updateSelectedGroupSize('width', width)
                            }
                          }}
                        />
                      </label>
                      <label>
                        <span>Group height</span>
                        <input
                          type="number"
                          aria-label="Selected group height"
                          min={MIN_GROUP_DIMENSION}
                          max="20000"
                          step="1"
                          value={Math.round(selectedGroupBounds.height)}
                          onChange={(event) => {
                            const height = Number(event.target.value)
                            if (Number.isFinite(height) && height >= MIN_GROUP_DIMENSION) {
                              updateSelectedGroupSize('height', height)
                            }
                          }}
                        />
                      </label>
                    </>
                  ) : null}
                  <label>
                    <span>Color</span>
                    <input
                      type="color"
                      aria-label="Selected shapes shared stroke color"
                      value={selectedElement.element.stroke}
                      onChange={(event) => {
                        const stroke = event.target.value
                        updateSelectedElements({ stroke })
                        // Keep this exact color ready for the next shape too.
                        setColor(stroke)
                      }}
                    />
                  </label>
                  <label>
                    <span>Fill</span>
                    <span className="sketch-editor__fill-control">
                      <button
                        type="button"
                        onClick={() => {
                          updateSelectedElements({ fill: 'transparent' }, { fillableOnly: true })
                          setFillColor('transparent')
                        }}
                      >
                        none
                      </button>
                      <input
                        type="color"
                        aria-label="Selected shapes shared fill color"
                        value={selectedElement.element.fill === 'transparent' ? '#ffffff' : selectedElement.element.fill}
                        onChange={(event) => {
                          const fill = event.target.value
                          updateSelectedElements({ fill }, { fillableOnly: true })
                          setFillColor(fill)
                        }}
                      />
                    </span>
                  </label>
                </>
              ) : null}
              {selectedElementCount === 1 ? (
                <>
              {selectedElement.element.kind === 'text' ? (
                <>
                  <label>
                    <span>Text</span>
                    <textarea
                      aria-label="Selected text"
                      readOnly={Boolean(selectedTextAnnotation)}
                      value={selectedTextAnnotation
                        ? resolvedSketchText(selectedElement.element, annotationTargetOptions)
                        : selectedElement.element.text ?? ''}
                      onChange={(event) => updateSelectedElement({ text: event.target.value })}
                    />
                  </label>
                  {annotationTargetOptions.length ? (
                    <section className="sketch-editor__annotation" aria-label="Text annotation">
                      <h3>project value</h3>
                      <label>
                        <span>Item</span>
                        <select
                          aria-label="Annotation project item"
                          value={effectiveAnnotationTargetId}
                          onChange={(event) => {
                            const targetId = event.target.value
                            const target = annotationTargetOptions.find((candidate) => candidate.id === targetId)
                            const firstField = annotationFieldsForTarget(target)[0]
                            setAnnotationPickerElementId(selectedTextElementId ?? null)
                            setAnnotationTargetId(targetId)
                            setAnnotationField(firstField?.field ?? 'name')
                            setAnnotationPropertyKey(firstField?.propertyKey ?? '')
                          }}
                        >
                          <option value="">choose item</option>
                          {annotationTargetOptions.map((target) => (
                            <option key={target.id} value={target.id}>{annotationTargetLabel(target)}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>Value</span>
                        <select
                          aria-label="Annotation project value"
                          disabled={!selectedAnnotationTarget}
                          value={effectiveAnnotationField === 'property'
                            ? `property:${effectiveAnnotationPropertyKey}`
                            : effectiveAnnotationField}
                          onChange={(event) => {
                            const value = event.target.value
                            setAnnotationPickerElementId(selectedTextElementId ?? null)
                            setAnnotationTargetId(effectiveAnnotationTargetId)
                            if (value.startsWith('property:')) {
                              setAnnotationField('property')
                              setAnnotationPropertyKey(value.slice('property:'.length))
                              return
                            }
                            setAnnotationField(value as SketchTextAnnotation['field'])
                            setAnnotationPropertyKey('')
                          }}
                        >
                          {selectedAnnotationFields.map((field) => {
                            const value = field.field === 'property'
                              ? `property:${field.propertyKey}`
                              : field.field
                            return <option key={value} value={value}>{field.label}</option>
                          })}
                        </select>
                      </label>
                      <div className="sketch-editor__annotation-actions">
                        <button
                          type="button"
                          disabled={!selectedAnnotationTarget || selectedAnnotationFields.length === 0}
                          onClick={bindSelectedTextToProjectValue}
                        >
                          use value
                        </button>
                        {selectedTextAnnotation ? (
                          <button type="button" onClick={makeSelectedTextLiteral}>make literal</button>
                        ) : null}
                      </div>
                    </section>
                  ) : null}
                </>
              ) : null}
              <label>
                <span>Color</span>
                <input
                  type="color"
                  aria-label="Selected object stroke color"
                  value={selectedElement.element.stroke}
                  onChange={(event) => {
                    const stroke = event.target.value
                    updateSelectedElement({ stroke })
                    setColor(stroke)
                  }}
                />
              </label>
              {annotationTargetOptions.length > 0 && selectedElement.element.kind !== 'compound' ? (
                <section className="sketch-editor__annotation" aria-label="Semantic color">
                  <h3>semantic color</h3>
                  <label>
                    <span>Line</span>
                    <select
                      aria-label="Semantic line color item"
                      value={selectedElement.element.semanticColors?.stroke?.targetId ?? ''}
                      onChange={(event) => setSelectedSemanticColorBinding('stroke', event.target.value)}
                    >
                      <option value="">manual</option>
                      {annotationTargetOptions.map((target) => (
                        <option key={target.id} value={target.id}>{annotationTargetLabel(target)}</option>
                      ))}
                    </select>
                  </label>
                  {isFillableElement(selectedElement.element.kind) ? (
                    <label>
                      <span>Background</span>
                      <select
                        aria-label="Semantic background color item"
                        value={selectedElement.element.semanticColors?.fill?.targetId ?? ''}
                        onChange={(event) => setSelectedSemanticColorBinding('fill', event.target.value)}
                      >
                        <option value="">manual</option>
                        {annotationTargetOptions.map((target) => (
                          <option key={target.id} value={target.id}>{annotationTargetLabel(target)}</option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                </section>
              ) : null}
              <label>
                <span>{`Stroke ${Math.round(selectedElement.element.strokeWidth)}`}</span>
                <input
                  type="range"
                  aria-label="Selected object stroke width"
                  min="1"
                  max="40"
                  value={selectedElement.element.strokeWidth}
                  onChange={(event) => updateSelectedElement({ strokeWidth: Number(event.target.value) })}
                />
              </label>
              <label>
                <span>X</span>
                <input
                  type="number"
                  aria-label="Selected object horizontal position"
                  min="-20000"
                  max="20000"
                  step="1"
                  value={Math.round(selectedElement.element.x)}
                  onChange={(event) => {
                    const x = Number(event.target.value)
                    if (Number.isFinite(x)) {
                      // For a line or arrow, x is its start point; keeping its
                      // width unchanged moves the entire line without changing
                      // its direction or length.
                      updateSelectedElement({ x })
                    }
                  }}
                />
              </label>
              <label>
                <span>Y</span>
                <input
                  type="number"
                  aria-label="Selected object vertical position"
                  min="-20000"
                  max="20000"
                  step="1"
                  value={Math.round(selectedElement.element.y)}
                  onChange={(event) => {
                    const y = Number(event.target.value)
                    if (Number.isFinite(y)) {
                      updateSelectedElement({ y })
                    }
                  }}
                />
              </label>
              {isResizableShape(selectedElement.element.kind) ? (
                <>
                  <label>
                    <span>Width</span>
                    <input
                      type="number"
                      aria-label="Selected shape width"
                      min="1"
                      max="20000"
                      step="1"
                      value={Math.round(selectedElement.element.width)}
                      onChange={(event) => {
                        const width = Number(event.target.value)
                        if (Number.isFinite(width) && width >= 1) {
                          updateSelectedShapeDimension('width', width)
                        }
                      }}
                    />
                  </label>
                  <label>
                    <span>Height</span>
                    <input
                      type="number"
                      aria-label="Selected shape height"
                      min="1"
                      max="20000"
                      step="1"
                      value={Math.round(selectedElement.element.height)}
                      onChange={(event) => {
                        const height = Number(event.target.value)
                        if (Number.isFinite(height) && height >= 1) {
                          updateSelectedShapeDimension('height', height)
                        }
                      }}
                    />
                  </label>
                  <label>
                    <span>Lock ratio</span>
                    <input
                      type="checkbox"
                      aria-label="Lock selected shape aspect ratio"
                      checked={Boolean(selectedElement.element.aspectRatioLocked)}
                      onChange={(event) => updateSelectedElement({ aspectRatioLocked: event.target.checked })}
                    />
                  </label>
                </>
              ) : null}
              {selectedElement.element.kind === 'rounded-rectangle' ? (
                <label>
                  <span>{`Corners ${Math.round(displayedCornerRadius(selectedElement.element))}`}</span>
                  <input
                    type="range"
                    aria-label="Selected rounded rectangle corner radius"
                    min="0"
                    max={Math.floor(maximumCornerRadius(selectedElement.element))}
                    step="1"
                    value={Math.round(displayedCornerRadius(selectedElement.element))}
                    onChange={(event) => updateSelectedElement({ cornerRadius: Number(event.target.value) })}
                  />
                </label>
              ) : null}
              <label>
                <span>Opacity</span>
                <input
                  type="range"
                  aria-label="Selected object opacity"
                  min="0.05"
                  max="1"
                  step="0.05"
                  value={selectedElement.element.opacity}
                  onChange={(event) => updateSelectedElement({ opacity: Number(event.target.value) })}
                />
              </label>
              {isFillableElement(selectedElement.element.kind) ? (
                <label>
                  <span>Fill</span>
                  <span className="sketch-editor__fill-control">
                    <button
                      type="button"
                      className={selectedElement.element.fill === 'transparent' ? 'is-selected' : undefined}
                      onClick={() => {
                        updateSelectedElement({ fill: 'transparent' })
                        setFillColor('transparent')
                      }}
                    >
                      none
                    </button>
                    <input
                      type="color"
                      aria-label="Selected object fill color"
                      value={selectedElement.element.fill === 'transparent' ? '#ffffff' : selectedElement.element.fill}
                      onChange={(event) => {
                        const fill = event.target.value
                        updateSelectedElement({ fill })
                        setFillColor(fill)
                      }}
                    />
                  </span>
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
                </>
              ) : null}
            </section>
          ) : null}
          {selectedEmbed && selectedEmbedPlacement ? (
            <section className="sketch-editor__selected-object">
              <div className="sketch-editor__section-heading">
                <h3>{selectedEmbed.visual.data.name || 'visual'}</h3>
                {onEmbeddedVisualMakeIndependent
                  && !isImmutableVisual(selectedEmbed.visual)
                  && visualIdentity(selectedEmbed.visual) === 'osa-draw' ? (
                    <button
                      type="button"
                      onClick={() => onEmbeddedVisualMakeIndependent(selectedEmbed.id)}
                    >
                      make independent
                    </button>
                  ) : null}
                <button type="button" onClick={() => removeEmbed(selectedEmbed.id)}>delete</button>
              </div>
              <label>
                <span>X</span>
                <input
                  type="number"
                  aria-label="Selected visual horizontal position"
                  min="-20000"
                  max="20000"
                  step="1"
                  value={Math.round(selectedEmbedPlacement.x)}
                  onChange={(event) => {
                    const x = Number(event.target.value)
                    if (Number.isFinite(x)) updateSelectedEmbedPlacement({ x })
                  }}
                />
              </label>
              <label>
                <span>Y</span>
                <input
                  type="number"
                  aria-label="Selected visual vertical position"
                  min="-20000"
                  max="20000"
                  step="1"
                  value={Math.round(selectedEmbedPlacement.y)}
                  onChange={(event) => {
                    const y = Number(event.target.value)
                    if (Number.isFinite(y)) updateSelectedEmbedPlacement({ y })
                  }}
                />
              </label>
              <label>
                <span>Width</span>
                <input
                  type="number"
                  aria-label="Selected visual width"
                  min="24"
                  max="20000"
                  step="1"
                  value={Math.round(selectedEmbedPlacement.width)}
                  onChange={(event) => {
                    const width = Number(event.target.value)
                    if (Number.isFinite(width) && width >= 24) {
                      updateSelectedEmbedDimension('width', width)
                    }
                  }}
                />
              </label>
              <label>
                <span>Height</span>
                <input
                  type="number"
                  aria-label="Selected visual height"
                  min="24"
                  max="20000"
                  step="1"
                  value={Math.round(selectedEmbedPlacement.height)}
                  onChange={(event) => {
                    const height = Number(event.target.value)
                    if (Number.isFinite(height) && height >= 24) {
                      updateSelectedEmbedDimension('height', height)
                    }
                  }}
                />
              </label>
              <label>
                <span>Ratio</span>
                <button
                  type="button"
                  aria-label={selectedEmbedPlacement.aspectRatioLocked === false
                    ? 'Lock selected visual aspect ratio'
                    : 'Unlock selected visual aspect ratio'}
                  onClick={() => updateSelectedEmbedPlacement({
                    aspectRatioLocked: selectedEmbedPlacement.aspectRatioLocked === false,
                  })}
                >
                  {selectedEmbedPlacement.aspectRatioLocked === false ? 'lock' : 'unlock'}
                </button>
              </label>
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
