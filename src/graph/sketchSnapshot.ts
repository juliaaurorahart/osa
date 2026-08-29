import {
  createSketchDocument,
  type SketchCompoundPart,
  type SketchDocument,
  type SketchElement,
  type SketchLayer,
  type SketchSemanticColorBindings,
  type SketchSemanticColorReference,
  type SketchStroke,
  type SketchTextAnnotation,
} from './textNode'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseSketchStrokes(
  value: unknown,
  options: { legacy: boolean; width: number; height: number },
): SketchStroke[] | null {
  if (!Array.isArray(value)) return null

  const strokes: SketchStroke[] = []
  for (const stroke of value) {
    if (
      !isRecord(stroke)
      || typeof stroke.id !== 'string'
      || typeof stroke.color !== 'string'
      || typeof stroke.width !== 'number'
      || !Number.isFinite(stroke.width)
      || stroke.width <= 0
      || (!options.legacy && stroke.coordinateSpace !== 'pixels')
      || (options.legacy && stroke.coordinateSpace !== undefined && stroke.coordinateSpace !== 'pixels')
      || (!options.legacy && typeof stroke.opacity !== 'number')
      || (stroke.opacity !== undefined && (
        typeof stroke.opacity !== 'number'
        || !Number.isFinite(stroke.opacity)
        || stroke.opacity < 0
        || stroke.opacity > 1
      ))
      || !Array.isArray(stroke.points)
    ) return null

    const points: SketchStroke['points'] = []
    for (const point of stroke.points) {
      if (
        !isRecord(point)
        || typeof point.x !== 'number'
        || typeof point.y !== 'number'
        || !Number.isFinite(point.x)
        || !Number.isFinite(point.y)
        || (point.pressure !== undefined && (
          typeof point.pressure !== 'number'
          || !Number.isFinite(point.pressure)
          || point.pressure < 0
          || point.pressure > 1
        ))
      ) {
        return null
      }
      const isNormalized = options.legacy && stroke.coordinateSpace !== 'pixels'
      points.push({
        x: isNormalized ? point.x * options.width : point.x,
        y: isNormalized ? point.y * options.height : point.y,
        ...(typeof point.pressure === 'number' ? { pressure: point.pressure } : {}),
      })
    }

    strokes.push({
      id: stroke.id,
      color: stroke.color,
      width: stroke.width,
      opacity: typeof stroke.opacity === 'number' ? stroke.opacity : 1,
      coordinateSpace: 'pixels',
      points,
    })
  }
  return strokes
}

/** Parses the relative primitive geometry inside a true compound shape. */
function parseSketchCompoundParts(value: unknown): SketchCompoundPart[] | null {
  if (!Array.isArray(value) || value.length < 2) return null
  const parts: SketchCompoundPart[] = []
  for (const part of value) {
    if (
      !isRecord(part)
      || typeof part.id !== 'string'
      || !['rectangle', 'rounded-rectangle', 'ellipse', 'diamond', 'triangle'].includes(String(part.kind))
      || typeof part.x !== 'number'
      || typeof part.y !== 'number'
      || typeof part.width !== 'number'
      || typeof part.height !== 'number'
      || !Number.isFinite(part.x)
      || !Number.isFinite(part.y)
      || !Number.isFinite(part.width)
      || !Number.isFinite(part.height)
      || part.width < 0
      || part.height < 0
      || (part.cornerRadius !== undefined && (
        part.kind !== 'rounded-rectangle'
        || typeof part.cornerRadius !== 'number'
        || !Number.isFinite(part.cornerRadius)
        || part.cornerRadius < 0
      ))
    ) return null
    parts.push({
      id: part.id,
      kind: part.kind as SketchCompoundPart['kind'],
      x: part.x,
      y: part.y,
      width: part.width,
      height: part.height,
      ...(typeof part.cornerRadius === 'number' ? { cornerRadius: part.cornerRadius } : {}),
    })
  }
  return parts
}

/** Parses one live project-value reference used by an OSA draw text object. */
function parseSketchTextAnnotation(value: unknown): SketchTextAnnotation | null {
  if (!isRecord(value)) return null
  if (
    value.kind !== 'project-value'
    || typeof value.targetId !== 'string'
    || value.targetId.length === 0
    || !['name', 'kind', 'text', 'property'].includes(String(value.field))
    || typeof value.fallback !== 'string'
  ) return null

  const field = value.field as SketchTextAnnotation['field']
  if (field === 'property') {
    if (typeof value.propertyKey !== 'string' || value.propertyKey.length === 0) return null
    return {
      kind: 'project-value',
      targetId: value.targetId,
      field,
      propertyKey: value.propertyKey,
      fallback: value.fallback,
    }
  }
  if (value.propertyKey !== undefined) return null
  return {
    kind: 'project-value',
    targetId: value.targetId,
    field,
    fallback: value.fallback,
  }
}

/** Parses one canonical semantic-color reference used by an OSA draw element. */
function parseSketchSemanticColorReference(value: unknown): SketchSemanticColorReference | null {
  if (
    !isRecord(value)
    || value.kind !== 'project-semantic-color'
    || typeof value.targetId !== 'string'
    || value.targetId.trim().length === 0
    || Object.keys(value).some((key) => key !== 'kind' && key !== 'targetId')
  ) return null
  return { kind: 'project-semantic-color', targetId: value.targetId }
}

/** Parses independent optional stroke/fill semantic-color bindings. */
function parseSketchSemanticColorBindings(value: unknown): SketchSemanticColorBindings | null {
  if (!isRecord(value)) return null
  const hasStroke = Object.prototype.hasOwnProperty.call(value, 'stroke')
  const hasFill = Object.prototype.hasOwnProperty.call(value, 'fill')
  if (Object.keys(value).some((key) => key !== 'stroke' && key !== 'fill')) return null

  const stroke = hasStroke ? parseSketchSemanticColorReference(value.stroke) : undefined
  const fill = hasFill ? parseSketchSemanticColorReference(value.fill) : undefined
  if ((hasStroke && stroke === null) || (hasFill && fill === null)) return null

  return {
    ...(stroke ? { stroke } : {}),
    ...(fill ? { fill } : {}),
  }
}

/** Parses the portable shape and text objects on a canvas layer. */
function parseSketchElements(value: unknown): SketchElement[] | null {
  if (value === undefined) return []
  if (!Array.isArray(value)) return null

  const elements: SketchElement[] = []
  for (const element of value) {
    const compoundParts = isRecord(element) && element.kind === 'compound'
      ? parseSketchCompoundParts(element.compoundParts)
      : undefined
    const annotation = isRecord(element) && element.annotation !== undefined
      ? parseSketchTextAnnotation(element.annotation)
      : undefined
    const semanticColors = isRecord(element) && element.semanticColors !== undefined
      ? parseSketchSemanticColorBindings(element.semanticColors)
      : undefined
    if (
      !isRecord(element)
      || typeof element.id !== 'string'
      || ![
        'rectangle',
        'rounded-rectangle',
        'ellipse',
        'diamond',
        'triangle',
        'line',
        'arrow',
        'text',
        'compound',
      ].includes(String(element.kind))
      || typeof element.x !== 'number'
      || typeof element.y !== 'number'
      || typeof element.width !== 'number'
      || typeof element.height !== 'number'
      || typeof element.stroke !== 'string'
      || typeof element.fill !== 'string'
      || typeof element.strokeWidth !== 'number'
      || typeof element.opacity !== 'number'
      || !Number.isFinite(element.x)
      || !Number.isFinite(element.y)
      || !Number.isFinite(element.width)
      || !Number.isFinite(element.height)
      || !Number.isFinite(element.strokeWidth)
      || !Number.isFinite(element.opacity)
      // Enclosed shapes and text use a top-left corner plus a positive size.
      // Lines and arrows deliberately keep signed width/height: that is their
      // direction from x/y to x + width/y + height, so they can point in any
      // direction without inventing a second coordinate model.
      || (!['line', 'arrow'].includes(String(element.kind)) && (element.width < 0 || element.height < 0))
      || element.strokeWidth <= 0
      || element.opacity < 0
      || element.opacity > 1
      || (element.strokeStyle !== undefined && !['solid', 'dashed', 'dotted'].includes(String(element.strokeStyle)))
      || (element.aspectRatioLocked !== undefined && typeof element.aspectRatioLocked !== 'boolean')
      || (element.cornerRadius !== undefined && (
        element.kind !== 'rounded-rectangle'
        || typeof element.cornerRadius !== 'number'
        || !Number.isFinite(element.cornerRadius)
        || element.cornerRadius < 0
      ))
      || (element.groupId !== undefined && (
        typeof element.groupId !== 'string'
        || element.groupId.length === 0
      ))
      || (element.kind === 'compound' && (
        compoundParts === null
        || element.cornerRadius !== undefined
        || element.annotation !== undefined
        || element.semanticColors !== undefined
        || element.text !== undefined
        || element.fontSize !== undefined
      ))
      || (element.kind !== 'compound' && element.compoundParts !== undefined)
      || (element.kind === 'text' && typeof element.text !== 'string')
      || (element.annotation !== undefined && (
        element.kind !== 'text'
        || annotation === null
      ))
      || (element.semanticColors !== undefined && semanticColors === null)
      || (element.text !== undefined && typeof element.text !== 'string')
      || (element.fontSize !== undefined && (
        typeof element.fontSize !== 'number'
        || !Number.isFinite(element.fontSize)
        || element.fontSize <= 0
      ))
    ) return null

    elements.push({
      id: element.id,
      kind: element.kind as SketchElement['kind'],
      x: element.x,
      y: element.y,
      width: element.width,
      height: element.height,
      stroke: element.stroke,
      fill: element.fill,
      strokeWidth: element.strokeWidth,
      ...(element.strokeStyle === 'solid' || element.strokeStyle === 'dashed' || element.strokeStyle === 'dotted'
        ? { strokeStyle: element.strokeStyle }
        : {}),
      opacity: element.opacity,
      ...(typeof element.aspectRatioLocked === 'boolean'
        ? { aspectRatioLocked: element.aspectRatioLocked }
        : {}),
      ...(typeof element.cornerRadius === 'number' ? { cornerRadius: element.cornerRadius } : {}),
      ...(typeof element.groupId === 'string' ? { groupId: element.groupId } : {}),
      ...(compoundParts ? { compoundParts } : {}),
      ...(annotation ? { annotation } : {}),
      ...(semanticColors ? { semanticColors } : {}),
      ...(typeof element.text === 'string' ? { text: element.text } : {}),
      ...(typeof element.fontSize === 'number' ? { fontSize: element.fontSize } : {}),
    })
  }
  return elements
}

/** Validates and normalizes one current OSA draw document. */
export function parseSketchDocument(value: unknown): SketchDocument | null {
  if (
    !isRecord(value)
    || value.version !== 1
    || typeof value.width !== 'number'
    || typeof value.height !== 'number'
    || !Number.isFinite(value.width)
    || !Number.isFinite(value.height)
    || value.width < 100
    || value.height < 100
    || value.width > 20_000
    || value.height > 20_000
    || typeof value.background !== 'string'
    || !Array.isArray(value.layers)
    || value.layers.length === 0
  ) return null

  const layers: SketchLayer[] = []
  for (const layer of value.layers) {
    if (
      !isRecord(layer)
      || typeof layer.id !== 'string'
      || typeof layer.name !== 'string'
      || typeof layer.visible !== 'boolean'
      || typeof layer.locked !== 'boolean'
    ) return null
    const elements = parseSketchElements(layer.elements)
    const strokes = parseSketchStrokes(layer.strokes, {
      legacy: false,
      width: value.width,
      height: value.height,
    })
    if (!elements || !strokes) return null
    layers.push({
      id: layer.id,
      name: layer.name,
      visible: layer.visible,
      locked: layer.locked,
      elements,
      strokes,
    })
  }

  if (new Set(layers.map((layer) => layer.id)).size !== layers.length) return null
  const elementIds = layers.flatMap((layer) => layer.elements.map((element) => element.id))
  if (new Set(elementIds).size !== elementIds.length) return null
  const strokeIds = layers.flatMap((layer) => layer.strokes.map((stroke) => stroke.id))
  if (new Set(strokeIds).size !== strokeIds.length) return null

  return {
    version: 1,
    width: value.width,
    height: value.height,
    background: value.background,
    layers,
  }
}

/** Migrates normalized or pixel-based legacy stroke arrays into a v1 document. */
export function migrateLegacySketch(value: unknown): SketchDocument | null {
  const sketch = createSketchDocument()
  const strokes = value === undefined
    ? []
    : parseSketchStrokes(value, {
        legacy: true,
        width: sketch.width,
        height: sketch.height,
      })
  if (!strokes) return null
  sketch.layers[0].strokes = strokes
  return sketch
}
