import { Position } from '@xyflow/react'
import {
  RELATION_KINDS,
  type ConnectionAnchor,
  type GraphEdge,
} from './graphEdge'
import { NODE_KINDS } from './nodeKinds'
import {
  DEFAULT_CONNECTOR_POSITIONS,
  cloneSketchDocument,
  createSketchDocument,
  type NotebookPageData,
  type NodeLayout,
  type SketchCompoundPart,
  type SketchDocument,
  type SketchElement,
  type SketchLayer,
  type SketchSemanticColorBindings,
  type SketchSemanticColorReference,
  type SketchStroke,
  type SketchTextAnnotation,
  type TaskData,
  type TextFlowNode,
  type TextNodeData,
} from './textNode'
import {
  cloneVisualVersionState,
  type VisualVersionEmbed,
  type VisualVersionKind,
  type VisualVersionRecord,
  type VisualVersionState,
} from './visualVersion'

const DEFAULT_LAYOUT: NodeLayout = {
  width: 190,
  textHeight: 120,
  sketchHeight: 180,
}

/** The current, stable, JSON-safe shape of a saved board. */
export type BoardSnapshot = {
  version: 7
  nodes: SavedTextFlowNode[]
  edges: SavedEdge[]
}

/** Durable node fields. React Flow's measured and dragging state is omitted. */
export type SavedTextFlowNode = Pick<
  TextFlowNode,
  'id' | 'type' | 'position' | 'sourcePosition' | 'targetPosition'
> & {
  data: Pick<
    TextNodeData,
    'name' | 'text' | 'kind' | 'spaceIds' | 'notebook' | 'task' | 'properties' | 'sketch' | 'visualVersions' | 'layout'
  >
}

/** Durable connection fields. */
export type SavedEdge = Pick<GraphEdge, 'id' | 'source' | 'target'> & {
  data: GraphEdge['data']
}

/** Converts live graph state into a clean current-version snapshot. */
export function createBoardSnapshot(
  nodes: TextFlowNode[],
  edges: GraphEdge[],
): BoardSnapshot {
  const nodesById = new Map(nodes.map((node) => [node.id, node]))
  const spaceNodeIds = new Set(
    nodes.filter((node) => node.data.kind === 'space').map((node) => node.id),
  )

  return {
    version: 7,
    nodes: nodes.map((node) => ({
      id: node.id,
      type: node.type,
      position: { ...node.position },
      sourcePosition: node.sourcePosition,
      targetPosition: node.targetPosition,
      data: {
        name: node.data.name,
        text: node.data.text,
        kind: node.data.kind,
        spaceIds: node.data.kind === 'space'
          ? []
          : [...new Set(node.data.spaceIds)].filter((spaceId) => spaceNodeIds.has(spaceId)),
        notebook: node.data.notebook === undefined
          ? migrateLegacyNotebookPage(node.data.kind)
          : node.data.notebook ? { ...node.data.notebook } : null,
        task: node.data.task
          ? { ...node.data.task }
          : node.data.kind === 'action'
            ? { day: null, completedAt: null }
            : null,
        sketch: cloneSketchDocument(node.data.sketch),
        visualVersions: cloneVisualVersionState(node.data.visualVersions),
        layout: { ...node.data.layout },
        properties: { ...node.data.properties },
      },
    })),
    edges: edges.map((edge) => {
      const projectTaskLinkIsActive = edge.data.relationKind !== 'project-task' || (
        nodesById.get(edge.source)?.data.kind === 'project'
        && nodesById.get(edge.target)?.data.kind === 'action'
      )
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        data: {
          relationKind: projectTaskLinkIsActive ? edge.data.relationKind : 'related',
          sourceAnchor: edge.data.sourceAnchor ? { ...edge.data.sourceAnchor } : null,
          relationship: !projectTaskLinkIsActive
            && (edge.data.relationship === 'has task' || edge.data.relationship === 'has action')
            ? 'relates to'
            : edge.data.relationship === 'has task'
              ? 'has action'
              : edge.data.relationship,
          properties: { ...edge.data.properties },
        },
      }
    }),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseStringProperties(value: unknown): Record<string, string> | null {
  if (!isRecord(value)) return null
  return Object.values(value).every((property) => typeof property === 'string')
    ? value as Record<string, string>
    : null
}

function parseLayout(value: unknown): NodeLayout | null {
  if (!isRecord(value)) return null
  if (
    typeof value.width !== 'number'
    || typeof value.textHeight !== 'number'
    || typeof value.sketchHeight !== 'number'
  ) return null

  return {
    width: value.width,
    textHeight: value.textHeight,
    sketchHeight: value.sketchHeight,
  }
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

function parseSketchDocument(value: unknown): SketchDocument | null {
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

/** Parses one saved non-destructive crop window on a parent-side Visual placement. */
function parseVisualEmbedCrop(value: unknown) {
  if (!isRecord(value)) return null
  if (
    typeof value.x !== 'number'
    || typeof value.y !== 'number'
    || typeof value.width !== 'number'
    || typeof value.height !== 'number'
    || !Number.isFinite(value.x)
    || !Number.isFinite(value.y)
    || !Number.isFinite(value.width)
    || !Number.isFinite(value.height)
    || value.x < 0
    || value.y < 0
    || value.width <= 0
    || value.height <= 0
    || value.x + value.width > 1
    || value.y + value.height > 1
  ) return null
  return { x: value.x, y: value.y, width: value.width, height: value.height }
}

/** Parses the compact visual draft/official/history record stored on a Visual. */
function parseVisualVersionState(value: unknown): VisualVersionState | null | undefined {
  // Boards saved before canvas versions simply have no history yet.
  if (value === undefined || value === null) return null
  if (!isRecord(value) || !Array.isArray(value.records)) return undefined
  if (value.officialId !== null && typeof value.officialId !== 'string') return undefined

  const records: VisualVersionRecord[] = []
  for (const candidate of value.records) {
    if (
      !isRecord(candidate)
      || typeof candidate.id !== 'string'
      || typeof candidate.label !== 'string'
      || typeof candidate.createdAt !== 'string'
      || Number.isNaN(Date.parse(candidate.createdAt))
      || !['draft', 'official', 'history'].includes(String(candidate.kind))
      || !Array.isArray(candidate.embeds)
    ) return undefined

    const sketch = parseSketchDocument(candidate.sketch)
    if (!sketch) return undefined

    const embeds: VisualVersionEmbed[] = []
    for (const embed of candidate.embeds) {
      const crop = isRecord(embed) && isRecord(embed.placement) && embed.placement.crop !== undefined
        ? parseVisualEmbedCrop(embed.placement.crop)
        : undefined
      if (
        !isRecord(embed)
        || typeof embed.id !== 'string'
        || typeof embed.visualId !== 'string'
        || !isRecord(embed.placement)
        || typeof embed.placement.x !== 'number'
        || typeof embed.placement.y !== 'number'
        || typeof embed.placement.width !== 'number'
        || typeof embed.placement.height !== 'number'
        || !Number.isFinite(embed.placement.x)
        || !Number.isFinite(embed.placement.y)
        || !Number.isFinite(embed.placement.width)
        || !Number.isFinite(embed.placement.height)
        || embed.placement.width <= 0
        || embed.placement.height <= 0
        || (embed.placement.aspectRatioLocked !== undefined
          && typeof embed.placement.aspectRatioLocked !== 'boolean')
        || (embed.placement.groupId !== undefined && (
          typeof embed.placement.groupId !== 'string'
          || embed.placement.groupId.trim().length === 0
        ))
        || (embed.placement.crop !== undefined && crop === null)
        || (embed.placement.semanticShade !== undefined
          && typeof embed.placement.semanticShade !== 'boolean')
      ) return undefined
      embeds.push({
        id: embed.id,
        visualId: embed.visualId,
        placement: {
          x: embed.placement.x,
          y: embed.placement.y,
          width: embed.placement.width,
          height: embed.placement.height,
          ...(typeof embed.placement.aspectRatioLocked === 'boolean'
            ? { aspectRatioLocked: embed.placement.aspectRatioLocked }
            : {}),
          ...(typeof embed.placement.groupId === 'string'
            ? { groupId: embed.placement.groupId.trim() }
            : {}),
          ...(crop ? { crop } : {}),
          ...(embed.placement.semanticShade === true ? { semanticShade: true } : {}),
        },
      })
    }
    if (new Set(embeds.map((embed) => embed.id)).size !== embeds.length) return undefined
    records.push({
      id: candidate.id,
      label: candidate.label,
      createdAt: candidate.createdAt,
      kind: candidate.kind as VisualVersionKind,
      sketch,
      embeds,
    })
  }

  if (new Set(records.map((record) => record.id)).size !== records.length) return undefined
  const officialRecords = records.filter((record) => record.kind === 'official')
  if (officialRecords.length > 1) return undefined
  if (value.officialId === null && officialRecords.length !== 0) return undefined
  if (
    typeof value.officialId === 'string'
    && (officialRecords.length !== 1 || officialRecords[0].id !== value.officialId)
  ) return undefined

  return {
    officialId: value.officialId,
    records,
  }
}

function migrateLegacySketch(value: unknown): SketchDocument | null {
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

function parseTaskData(value: unknown): TaskData | null {
  if (!isRecord(value)) return null
  const day = value.day
  const completedAt = value.completedAt
  if (day !== null && (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day))) {
    return null
  }
  if (
    completedAt !== null
    && (typeof completedAt !== 'string' || Number.isNaN(Date.parse(completedAt)))
  ) return null
  return { day, completedAt }
}

function parseNotebookPage(value: unknown): NotebookPageData | null | undefined {
  if (value === null) return null
  if (!isRecord(value) || (value.format !== 'text' && value.format !== 'sketch')) {
    return undefined
  }
  return { format: value.format }
}

function migrateLegacyNotebookPage(kind: TextNodeData['kind']): NotebookPageData | null {
  if (kind === 'sketch') return { format: 'sketch' }
  // Documents are included because older builds could make a notebook Note
  // disappear by changing its semantic type to Document.
  if (kind === 'note' || kind === 'document') return { format: 'text' }
  return null
}

function parseConnectorPosition(value: unknown, fallback: Position): Position | null {
  if (value === undefined) return fallback
  return Object.values(Position).includes(value as Position) ? value as Position : null
}

function parseNode(value: unknown, version: 1 | 2 | 3 | 4 | 5 | 6 | 7): SavedTextFlowNode | null {
  if (!isRecord(value) || value.type !== 'text' || typeof value.id !== 'string') return null
  if (!isRecord(value.position) || typeof value.position.x !== 'number' || typeof value.position.y !== 'number') {
    return null
  }
  if (!isRecord(value.data)) return null
  const data = value.data
  if (
    (data.name !== undefined && typeof data.name !== 'string')
    || typeof data.text !== 'string'
    || typeof data.kind !== 'string'
    || !NODE_KINDS.some((kind) => kind.id === (data.kind === 'task' ? 'action' : data.kind))
  ) return null

  const sourcePosition = parseConnectorPosition(value.sourcePosition, DEFAULT_CONNECTOR_POSITIONS.source)
  const targetPosition = parseConnectorPosition(value.targetPosition, DEFAULT_CONNECTOR_POSITIONS.target)
  if (!sourcePosition || !targetPosition) return null

  const properties = data.properties === undefined && version === 1
    ? {}
    : parseStringProperties(data.properties)
  const layout = data.layout === undefined && version === 1
    ? { ...DEFAULT_LAYOUT }
    : parseLayout(data.layout)
  const sketch = version >= 3
    ? parseSketchDocument(data.sketch)
    : migrateLegacySketch(data.sketchStrokes)
  const visualVersions = parseVisualVersionState(data.visualVersions)
  if (!properties || !sketch || !layout || visualVersions === undefined) return null

  const spaceIds = data.spaceIds === undefined && version < 6
    ? []
    : Array.isArray(data.spaceIds) && data.spaceIds.every((spaceId) => typeof spaceId === 'string')
      ? [...data.spaceIds]
      : null
  if (!spaceIds) return null

  const kind = (data.kind === 'task' ? 'action' : data.kind) as TextNodeData['kind']
  const notebook = version >= 5
    ? parseNotebookPage(data.notebook)
    : migrateLegacyNotebookPage(kind)
  if (notebook === undefined) return null

  let task: TaskData | null
  if (version === 1) {
    task = kind === 'action' ? { day: null, completedAt: null } : null
  } else if (version >= 5) {
    if (data.task === null) {
      if (kind === 'action') return null
      task = null
    } else {
      task = parseTaskData(data.task)
      if (!task) return null
    }
  } else if (kind === 'action') {
    task = parseTaskData(data.task)
    if (!task) return null
  } else {
    if (data.task !== null) return null
    task = null
  }

  return {
    id: value.id,
    type: 'text',
    position: { x: value.position.x, y: value.position.y },
    sourcePosition,
    targetPosition,
    data: {
      name: data.name ?? '',
      text: data.text,
      kind,
      spaceIds,
      notebook,
      task,
      properties: { ...properties },
      sketch,
      visualVersions,
      layout,
    },
  }
}

function parseConnectionAnchor(value: unknown): ConnectionAnchor | null | undefined {
  if (value === null) return null
  if (!isRecord(value) || typeof value.kind !== 'string') return undefined
  if (value.kind === 'text') {
    if (
      !Number.isInteger(value.start)
      || !Number.isInteger(value.end)
      || (value.start as number) < 0
      || (value.end as number) <= (value.start as number)
      || typeof value.quote !== 'string'
      || value.quote.length === 0
    ) return undefined
    return {
      kind: 'text',
      start: value.start as number,
      end: value.end as number,
      quote: value.quote,
    }
  }
  if (value.kind === 'sketch-region') {
    const coordinates = [value.x, value.y, value.width, value.height]
    if (
      !coordinates.every((coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate))
      || (value.width as number) <= 0
      || (value.height as number) <= 0
    ) return undefined
    return {
      kind: 'sketch-region',
      x: value.x as number,
      y: value.y as number,
      width: value.width as number,
      height: value.height as number,
    }
  }
  return undefined
}

function parseEdge(value: unknown, version: 1 | 2 | 3 | 4 | 5 | 6 | 7): SavedEdge | null {
  if (
    !isRecord(value)
    || typeof value.id !== 'string'
    || typeof value.source !== 'string'
    || typeof value.target !== 'string'
  ) return null

  if (value.data === undefined && version === 1) {
    return {
      id: value.id,
      source: value.source,
      target: value.target,
      data: {
        relationKind: 'related',
        sourceAnchor: null,
        relationship: 'relates to',
        properties: {},
      },
    }
  }
  if (!isRecord(value.data) || typeof value.data.relationship !== 'string') return null

  const properties = parseStringProperties(value.data.properties)
  if (!properties) return null

  const relationKind = version === 1 ? 'related' : value.data.relationKind
  if (
    typeof relationKind !== 'string'
    || !RELATION_KINDS.includes(relationKind as GraphEdge['data']['relationKind'])
  ) return null

  const sourceAnchor = version >= 4
    ? parseConnectionAnchor(value.data.sourceAnchor)
    : null
  if (sourceAnchor === undefined) return null

  return {
    id: value.id,
    source: value.source,
    target: value.target,
    data: {
      relationKind: relationKind as GraphEdge['data']['relationKind'],
      sourceAnchor,
      relationship: value.data.relationship === 'has task'
        ? 'has action'
        : value.data.relationship,
      properties: { ...properties },
    },
  }
}

/**
 * Validates untrusted JSON and migrates older boards in memory.
 * The database can continue storing snapshots as opaque JSON.
 */
export function parseBoardSnapshot(value: unknown): BoardSnapshot | null {
  if (
    !isRecord(value)
    || (
      value.version !== 1
      && value.version !== 2
      && value.version !== 3
      && value.version !== 4
      && value.version !== 5
      && value.version !== 6
      && value.version !== 7
    )
  ) return null
  if (!Array.isArray(value.nodes) || !Array.isArray(value.edges)) return null
  const version = value.version

  const nodes = value.nodes.map((node) => parseNode(node, version))
  const edges = value.edges.map((edge) => parseEdge(edge, version))
  if (nodes.some((node) => node === null) || edges.some((edge) => edge === null)) return null

  const parsedNodes = nodes as SavedTextFlowNode[]
  const parsedEdges = edges as SavedEdge[]
  const nodeIds = new Set(parsedNodes.map((node) => node.id))
  const edgeIds = new Set(parsedEdges.map((edge) => edge.id))
  if (nodeIds.size !== parsedNodes.length || edgeIds.size !== parsedEdges.length) return null
  if (parsedEdges.some((edge) => !nodeIds.has(edge.source) || !nodeIds.has(edge.target))) return null

  const spaceNodeIds = new Set(
    parsedNodes.filter((node) => node.data.kind === 'space').map((node) => node.id),
  )
  const normalizedNodes = parsedNodes.map((node) => ({
    ...node,
    data: {
      ...node.data,
      spaceIds: node.data.kind === 'space'
        ? []
        : [...new Set(node.data.spaceIds)].filter((spaceId) => spaceNodeIds.has(spaceId)),
    },
  }))

  const nodesById = new Map(normalizedNodes.map((node) => [node.id, node]))
  const invalidProjectTaskLink = parsedEdges.some((edge) => (
    edge.data.relationKind === 'project-task'
    && (
      nodesById.get(edge.source)?.data.kind !== 'project'
      || nodesById.get(edge.target)?.data.kind !== 'action'
    )
  ))
  if (invalidProjectTaskLink) return null

  return { version: 7, nodes: normalizedNodes, edges: parsedEdges }
}

/** Creates fresh live graph state from a normalized current snapshot. */
export function restoreBoardSnapshot(snapshot: BoardSnapshot): {
  nodes: TextFlowNode[]
  edges: GraphEdge[]
} {
  return {
    nodes: snapshot.nodes.map((node) => {
      // Early task views stored quick-entry wording in `name`. Preserve that
      // identity while copying the wording into the canonical task text.
      const text = node.data.kind === 'action'
        && node.data.text.trim() === ''
        && node.data.name.trim() !== ''
        && node.data.name.trim() !== `#${node.id}`
        ? node.data.name
        : node.data.text
      return {
        ...node,
        position: { ...node.position },
        data: {
          ...node.data,
          text,
          spaceIds: [...node.data.spaceIds],
          notebook: node.data.notebook ? { ...node.data.notebook } : null,
          task: node.data.task ? { ...node.data.task } : null,
          sketch: cloneSketchDocument(node.data.sketch),
          visualVersions: cloneVisualVersionState(node.data.visualVersions),
          layout: { ...node.data.layout },
          properties: { ...node.data.properties },
        },
      }
    }),
    edges: snapshot.edges.map((edge) => ({
      ...edge,
      data: {
        relationKind: edge.data.relationKind,
        sourceAnchor: edge.data.sourceAnchor ? { ...edge.data.sourceAnchor } : null,
        relationship: edge.data.relationship,
        properties: { ...edge.data.properties },
      },
    })),
  }
}
