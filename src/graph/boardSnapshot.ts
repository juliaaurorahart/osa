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
  type NodeLayout,
  type SketchDocument,
  type SketchLayer,
  type SketchStroke,
  type TaskData,
  type TextFlowNode,
  type TextNodeData,
} from './textNode'

const DEFAULT_LAYOUT: NodeLayout = {
  width: 190,
  textHeight: 120,
  sketchHeight: 180,
}

/** The current, stable, JSON-safe shape of a saved board. */
export type BoardSnapshot = {
  version: 4
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
    'name' | 'text' | 'kind' | 'task' | 'properties' | 'sketch' | 'layout'
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
  return {
    version: 4,
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
        task: node.data.task ? { ...node.data.task } : null,
        sketch: cloneSketchDocument(node.data.sketch),
        layout: { ...node.data.layout },
        properties: { ...node.data.properties },
      },
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      data: {
        relationKind: edge.data.relationKind,
        sourceAnchor: edge.data.sourceAnchor ? { ...edge.data.sourceAnchor } : null,
        relationship: edge.data.relationship,
        properties: { ...edge.data.properties },
      },
    })),
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
    const strokes = parseSketchStrokes(layer.strokes, {
      legacy: false,
      width: value.width,
      height: value.height,
    })
    if (!strokes) return null
    layers.push({
      id: layer.id,
      name: layer.name,
      visible: layer.visible,
      locked: layer.locked,
      strokes,
    })
  }

  if (new Set(layers.map((layer) => layer.id)).size !== layers.length) return null
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

function parseConnectorPosition(value: unknown, fallback: Position): Position | null {
  if (value === undefined) return fallback
  return Object.values(Position).includes(value as Position) ? value as Position : null
}

function parseNode(value: unknown, version: 1 | 2 | 3 | 4): SavedTextFlowNode | null {
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
    || !NODE_KINDS.some((kind) => kind.id === data.kind)
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
  const sketch = version === 3 || version === 4
    ? parseSketchDocument(data.sketch)
    : migrateLegacySketch(data.sketchStrokes)
  if (!properties || !sketch || !layout) return null

  let task: TaskData | null
  if (version === 1) {
    task = data.kind === 'task' ? { day: null, completedAt: null } : null
  } else if (data.kind === 'task') {
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
      kind: data.kind as TextNodeData['kind'],
      task,
      properties: { ...properties },
      sketch,
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

function parseEdge(value: unknown, version: 1 | 2 | 3 | 4): SavedEdge | null {
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

  const sourceAnchor = version === 4
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
      relationship: value.data.relationship,
      properties: { ...properties },
    },
  }
}

/**
 * Validates untrusted JSON and migrates legacy version-1/2/3 boards in memory.
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

  const nodesById = new Map(parsedNodes.map((node) => [node.id, node]))
  const invalidProjectTaskLink = parsedEdges.some((edge) => (
    edge.data.relationKind === 'project-task'
    && (
      nodesById.get(edge.source)?.data.kind !== 'project'
      || nodesById.get(edge.target)?.data.kind !== 'task'
    )
  ))
  if (invalidProjectTaskLink) return null

  return { version: 4, nodes: parsedNodes, edges: parsedEdges }
}

/** Creates fresh live graph state from a normalized current snapshot. */
export function restoreBoardSnapshot(snapshot: BoardSnapshot): {
  nodes: TextFlowNode[]
  edges: GraphEdge[]
} {
  return {
    nodes: snapshot.nodes.map((node) => ({
      ...node,
      position: { ...node.position },
      data: {
        ...node.data,
        task: node.data.task ? { ...node.data.task } : null,
        sketch: cloneSketchDocument(node.data.sketch),
        layout: { ...node.data.layout },
        properties: { ...node.data.properties },
      },
    })),
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
