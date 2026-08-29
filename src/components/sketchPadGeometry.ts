import type {
  SketchCompoundPart,
  SketchDocument,
  SketchElement,
  SketchLayer,
  SketchPoint,
  SketchStrokeStyle,
} from '../graph/textNode'
import type {
  VisualEmbedCrop,
  VisualEmbedPlacement,
} from '../graph/osaData'
import type { VisualEmbedInstance } from '../graph/visualEmbed'

/**
 * Pure geometry and immutable update helpers shared by the OSA Draw editor
 * and its SVG renderer. This module deliberately has no React state or DOM.
 */
export type MarqueeSelectionMode = 'inside' | 'touching'

export const MIN_PAGE_SIZE = 100
export const MAX_PAGE_SIZE = 20_000
/** A placed Visual may be genuinely tiny; only a zero-size placement is invalid. */
export const MIN_VISUAL_EMBED_SIZE = 1
/** Tiny Visuals retain this invisible target so they remain easy to select. */
export const MIN_VISUAL_EMBED_HIT_SIZE = 24
export function formatCanvasDimension(value: number) {
  return String(Math.round(value * 1000) / 1000)
}

/** A blank or partial field is not geometry yet, so leave the canvas alone. */
export function parseVisualEmbedDimension(value: string) {
  if (!value.trim()) return null
  const numeric = Number(value)
  if (
    !Number.isFinite(numeric)
    || numeric < MIN_VISUAL_EMBED_SIZE
    || numeric > MAX_PAGE_SIZE
  ) return null
  return numeric
}

/** Selection is forgiving even when a placed Visual itself is only a few pixels. */
export function visualEmbedHitBounds(placement: Pick<VisualEmbedPlacement, 'x' | 'y' | 'width' | 'height'>) {
  const width = Math.max(placement.width, MIN_VISUAL_EMBED_HIT_SIZE)
  const height = Math.max(placement.height, MIN_VISUAL_EMBED_HIT_SIZE)
  return {
    x: placement.x - (width - placement.width) / 2,
    y: placement.y - (height - placement.height) / 2,
    width,
    height,
  }
}

export type ElementBounds = { x: number; y: number; width: number; height: number }

export function isLineElement(kind: SketchElement['kind']): kind is 'line' | 'arrow' {
  return kind === 'line' || kind === 'arrow'
}

export function isFillableElement(kind: SketchElement['kind']) {
  return kind !== 'line' && kind !== 'arrow' && kind !== 'text'
}

/** Shapes with a rectangular drawing box can be sized exactly in the inspector. */
export function isResizableShape(kind: SketchElement['kind']) {
  return kind !== 'line' && kind !== 'arrow' && kind !== 'text'
}

/**
 * Preserve an object's current proportions while resizing from its lower-right
 * handle. The pointer dimension that moved farther, relative to the original
 * shape, determines the shared scale.
 */
export function proportionalDimensions(
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
export function sizedElementUpdate(
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
export function sizedEmbedPlacementUpdate(
  placement: VisualEmbedPlacement,
  dimension: 'width' | 'height',
  requestedValue: number,
): Pick<VisualEmbedPlacement, 'width' | 'height'> {
  const value = Math.max(MIN_VISUAL_EMBED_SIZE, requestedValue)
  if (placement.aspectRatioLocked === false || placement.width <= 0 || placement.height <= 0) {
    return dimension === 'width'
      ? { width: value, height: placement.height }
      : { width: placement.width, height: value }
  }

  const ratio = placement.width / placement.height
  if (dimension === 'width') {
    // Keep both dimensions above the real Visual minimum without breaking ratio.
    const width = Math.max(value, MIN_VISUAL_EMBED_SIZE * ratio)
    return { width, height: width / ratio }
  }

  // Keep both dimensions above the real Visual minimum without breaking ratio.
  const height = Math.max(value, MIN_VISUAL_EMBED_SIZE / ratio)
  return { width: height * ratio, height }
}

/** Recover the full-source frame from a cropped parent-side placement. */
export function uncroppedEmbedFrame(
  placement: VisualEmbedPlacement,
): Pick<VisualEmbedPlacement, 'x' | 'y' | 'width' | 'height'> {
  const crop = placement.crop
  if (!crop) {
    return {
      x: placement.x,
      y: placement.y,
      width: placement.width,
      height: placement.height,
    }
  }

  const width = placement.width / crop.width
  const height = placement.height / crop.height
  return {
    x: placement.x - crop.x * width,
    y: placement.y - crop.y * height,
    width,
    height,
  }
}

export function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

/** Resolve one normalized crop into the visible parent-canvas placement. */
export function placementForEmbedCrop(
  original: VisualEmbedPlacement,
  sourceFrame: Pick<VisualEmbedPlacement, 'x' | 'y' | 'width' | 'height'>,
  crop: VisualEmbedCrop | undefined,
): VisualEmbedPlacement {
  if (!crop) {
    const placement = { ...original, ...sourceFrame }
    delete placement.crop
    return placement
  }
  return {
    ...original,
    x: sourceFrame.x + crop.x * sourceFrame.width,
    y: sourceFrame.y + crop.y * sourceFrame.height,
    width: sourceFrame.width * crop.width,
    height: sourceFrame.height * crop.height,
    crop,
  }
}

export function isCompoundPartKind(kind: SketchElement['kind']): kind is SketchCompoundPart['kind'] {
  return ['rectangle', 'rounded-rectangle', 'ellipse', 'diamond', 'triangle'].includes(kind)
}

export function cloneSketchElement(element: SketchElement): SketchElement {
  return {
    ...element,
    ...(element.compoundParts
      ? { compoundParts: element.compoundParts.map((part) => ({ ...part })) }
      : {}),
  }
}

/** A history record copies only mutable placement data; source Visuals stay canonical. */
export function cloneVisualEmbed(embed: VisualEmbedInstance): VisualEmbedInstance {
  return {
    ...embed,
    placement: { ...embed.placement },
    ...(embed.embeddedVisuals?.length
      ? { embeddedVisuals: embed.embeddedVisuals.map(cloneVisualEmbed) }
      : {}),
  }
}

export function withEmbedPlacement(
  embeds: readonly VisualEmbedInstance[],
  id: string,
  placement: VisualEmbedPlacement,
) {
  return embeds.map((embed) => (
    embed.id === id
      ? { ...cloneVisualEmbed(embed), placement: { ...placement } }
      : cloneVisualEmbed(embed)
  ))
}

export function withEmbedPlacements(
  embeds: readonly VisualEmbedInstance[],
  placements: ReadonlyMap<string, VisualEmbedPlacement>,
) {
  return embeds.map((embed) => {
    const placement = placements.get(embed.id)
    return placement
      ? { ...cloneVisualEmbed(embed), placement: { ...placement } }
      : cloneVisualEmbed(embed)
  })
}

/** Resize a compound's local geometry so its exterior remains a true shape. */
export function resizeCompoundElement(element: SketchElement, update: Partial<SketchElement>): SketchElement {
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
export function maximumCornerRadius(element: SketchElement) {
  return Math.max(0, Math.min(Math.abs(element.width), Math.abs(element.height)) / 2)
}

/**
 * Older boards did not store corner radii. Preserve their original appearance
 * until someone intentionally adjusts the selected rounded rectangle.
 */
export function displayedCornerRadius(element: SketchElement) {
  const legacyDefault = Math.min(24, Math.abs(element.width) / 5, Math.abs(element.height) / 5)
  const requested = typeof element.cornerRadius === 'number' && Number.isFinite(element.cornerRadius)
    ? element.cornerRadius
    : legacyDefault
  return Math.min(Math.max(0, requested), maximumCornerRadius(element))
}

export function replaceLayer(
  document: SketchDocument,
  layerId: string,
  update: (layer: SketchLayer) => SketchLayer,
): SketchDocument {
  return {
    ...document,
    layers: document.layers.map((layer) => layer.id === layerId ? update(layer) : layer),
  }
}

export function visibleLayers(document: SketchDocument) {
  return document.layers.filter((layer) => layer.visible)
}

export function elementBounds(element: SketchElement): ElementBounds {
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
export function combinedElementBounds(elements: readonly SketchElement[]): ElementBounds {
  return combinedBounds(elements.map(elementBounds))
}

/** Tight bounding box for any mixture of shapes and placed Visuals. */
export function combinedBounds(bounds: readonly ElementBounds[]): ElementBounds {
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

export function normalizedBox(start: SketchPoint, end: SketchPoint): ElementBounds {
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
export function marqueeMatchesBounds(
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
export function axisLockedPoint(start: SketchPoint, end: SketchPoint): SketchPoint {
  const dx = end.x - start.x
  const dy = end.y - start.y
  return Math.abs(dx) >= Math.abs(dy)
    ? { ...end, y: start.y }
    : { ...end, x: start.x }
}

export function createElement(
  kind: Exclude<SketchElement['kind'], 'text'>,
  start: SketchPoint,
  end: SketchPoint,
  color: string,
  fill: string,
  strokeWidth: number,
  opacity: number,
  strokeStyle: SketchStrokeStyle = 'solid',
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
    ...(strokeStyle !== 'solid' ? { strokeStyle } : {}),
    opacity,
    ...(kind === 'rounded-rectangle'
      ? { cornerRadius: Math.min(24, box.width / 5, box.height / 5) }
      : {}),
  }
}

export function strokeDasharray(style: SketchStrokeStyle | undefined) {
  if (style === 'dashed') return '12 8'
  if (style === 'dotted') return '2 7'
  return undefined
}
