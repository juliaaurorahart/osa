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
  type NotebookPageData,
  type NodeLayout,
  type TaskData,
  type TextFlowNode,
  type TextNodeData,
} from './textNode'
import { migrateLegacySketch, parseSketchDocument } from './sketchSnapshot'
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

/**
 * Compares board documents after the same restore/save normalization used by
 * the editor. This keeps legacy-compatible hydration details from looking
 * like a person edited a board on another device.
 */
export function boardDocumentFingerprint(name: string, snapshot: BoardSnapshot) {
  const restored = restoreBoardSnapshot(snapshot)
  return JSON.stringify({
    name: name.trim(),
    snapshot: createBoardSnapshot(restored.nodes, restored.edges),
  })
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
