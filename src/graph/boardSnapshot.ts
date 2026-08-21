import { NODE_KINDS } from './nodeKinds'
import type { GraphEdge } from './graphEdge'
import type { TextFlowNode, TextNodeData } from './textNode'

/** The stable, JSON-safe shape of a saved board. */
export type BoardSnapshot = {
  version: 1
  nodes: SavedTextFlowNode[]
  edges: SavedEdge[]
}

/**
 * The node fields this playground deliberately saves.
 *
 * React Flow also adds temporary rendering fields such as `measured`,
 * `selected`, and `dragging`. Those do not belong in a durable board file.
 */
export type SavedTextFlowNode = Pick<
  TextFlowNode,
  'id' | 'type' | 'position' | 'sourcePosition' | 'targetPosition'
> & {
  data: Pick<TextNodeData, 'text' | 'kind' | 'properties' | 'sketchStrokes'>
    & Pick<TextNodeData, 'name'>
}

/** The connection fields this playground deliberately saves. */
export type SavedEdge = Pick<GraphEdge, 'id' | 'source' | 'target'> & {
  data: GraphEdge['data']
}

/**
 * Converts live React Flow state into a clean, JSON-safe board snapshot.
 *
 * This is also the boundary a future database API should use: save the
 * snapshot, not React Flow's temporary UI state or running callbacks.
 */
export function createBoardSnapshot(
  nodes: TextFlowNode[],
  edges: GraphEdge[],
): BoardSnapshot {
  return {
    version: 1,
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
        sketchStrokes: node.data.sketchStrokes.map((stroke) => ({
          ...stroke,
          points: stroke.points.map((point) => ({ ...point })),
        })),
        properties: { ...node.data.properties },
      },
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      data: {
        relationship: edge.data.relationship,
        properties: { ...edge.data.properties },
      },
    })),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Checks untrusted JSON before the app turns it back into live graph state.
 *
 * This is intentionally stricter than "it has arrays": malformed node text,
 * positions, IDs, or kinds are rejected before React Flow receives them.
 */
export function isBoardSnapshot(value: unknown): value is BoardSnapshot {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) {
    return false
  }

  const validKinds = new Set<string>(NODE_KINDS.map((kind) => kind.id))
  const nodesAreValid = value.nodes.every((node) => {
    if (!isRecord(node) || node.type !== 'text' || typeof node.id !== 'string') return false
    if (!isRecord(node.position) || typeof node.position.x !== 'number' || typeof node.position.y !== 'number') {
      return false
    }
    if (
      !isRecord(node.data)
      || (node.data.name !== undefined && typeof node.data.name !== 'string')
      || typeof node.data.text !== 'string'
      || typeof node.data.kind !== 'string'
    ) {
      return false
    }
    if (!validKinds.has(node.data.kind)) return false

    if (node.data.sketchStrokes !== undefined) {
      if (!Array.isArray(node.data.sketchStrokes)) return false
      const strokesAreValid = node.data.sketchStrokes.every((stroke) => (
        isRecord(stroke)
        && typeof stroke.id === 'string'
        && typeof stroke.color === 'string'
        && typeof stroke.width === 'number'
        && Array.isArray(stroke.points)
        && stroke.points.every((point) => (
          isRecord(point) && typeof point.x === 'number' && typeof point.y === 'number'
        ))
      ))
      if (!strokesAreValid) return false
    }

    // Version-1 files created before properties existed remain compatible.
    if (node.data.properties === undefined) return true
    return isRecord(node.data.properties)
      && Object.values(node.data.properties).every((property) => typeof property === 'string')
  })

  const edgesAreValid = value.edges.every((edge) => (
    isRecord(edge)
    && typeof edge.id === 'string'
    && typeof edge.source === 'string'
    && typeof edge.target === 'string'
    // Old saves did not have edge data, so leave them compatible.
    && (edge.data === undefined || (
      isRecord(edge.data)
      && typeof edge.data.relationship === 'string'
      && isRecord(edge.data.properties)
      && Object.values(edge.data.properties).every((property) => typeof property === 'string')
    ))
  ))

  return nodesAreValid && edgesAreValid
}

/**
 * Creates fresh React Flow state from a validated snapshot.
 * Cloning here keeps the saved JSON separate from the mutable live canvas.
 */
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
        name: node.data.name ?? '',
        sketchStrokes: node.data.sketchStrokes
          ? node.data.sketchStrokes.map((stroke) => ({
              ...stroke,
              points: stroke.points.map((point) => ({ ...point })),
            }))
          : [],
        // A pre-properties snapshot restores as an empty property set.
        properties: node.data.properties ? { ...node.data.properties } : {},
      },
    })),
    edges: snapshot.edges.map((edge) => ({
      ...edge,
      data: edge.data
        ? {
            relationship: edge.data.relationship,
            properties: { ...edge.data.properties },
          }
        : { relationship: 'relates to', properties: {} },
    })),
  }
}
