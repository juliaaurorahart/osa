import type { GraphEdge } from './graphEdge'
import type { NodeKind } from './nodeKinds'
import type { TextFlowNode } from './textNode'

export const NO_SPACE_FILTER = '__no-space__'

export type NodeKindFilter = NodeKind | 'all'
export type NodeConnectionFilter = 'all' | 'connected' | 'dangling'

export function spaceNodes(nodes: TextFlowNode[]) {
  return nodes.filter((node) => node.data.kind === 'space')
}

/**
 * Adds one ordinary node to one Space without disturbing its other Spaces.
 *
 * Returning the original array when nothing changes keeps this safe to call
 * while reconciling existing node-to-Space connections after a board loads.
 */
export function addNodeToSpace(
  nodes: TextFlowNode[],
  nodeId: string,
  spaceId: string,
) {
  const memberNode = nodes.find((node) => node.id === nodeId)
  const spaceNode = nodes.find((node) => node.id === spaceId)
  if (
    !memberNode
    || memberNode.data.kind === 'space'
    || spaceNode?.data.kind !== 'space'
    || memberNode.data.spaceIds.includes(spaceId)
  ) return nodes

  return nodes.map((node) => node.id === nodeId
    ? {
        ...node,
        data: {
          ...node.data,
          spaceIds: [...node.data.spaceIds, spaceId],
        },
      }
    : node)
}

/** New objects inherit the named Space currently being viewed. */
export function spaceIdsForNewNode(
  nodes: TextFlowNode[],
  selectedSpaceId: string,
  kind: NodeKind,
) {
  if (kind === 'space' || selectedSpaceId === NO_SPACE_FILTER) return []
  return nodes.some((node) => node.id === selectedSpaceId && node.data.kind === 'space')
    ? [selectedSpaceId]
    : []
}

/** Applies only the selected organizational context, never graph display filters. */
export function nodesInSpace(nodes: TextFlowNode[], selectedSpaceId: string) {
  if (selectedSpaceId === '') return nodes
  if (selectedSpaceId === NO_SPACE_FILTER) {
    return nodes.filter((node) => node.data.kind !== 'space' && node.data.spaceIds.length === 0)
  }
  return nodes.filter((node) => node.data.spaceIds.includes(selectedSpaceId))
}

/** Narrows the graph canvas without changing the objects available to other views. */
export function filterGraphNodes(
  nodes: TextFlowNode[],
  edges: GraphEdge[],
  kindFilter: NodeKindFilter,
  connectionFilter: NodeConnectionFilter,
) {
  const connectedNodeIds = connectionFilter === 'all'
    ? null
    : new Set(edges.flatMap((edge) => [edge.source, edge.target]))

  return nodes.filter((node) => (
    (kindFilter === 'all' || node.data.kind === kindFilter)
    && (
      connectedNodeIds === null
      || (connectionFilter === 'connected'
        ? connectedNodeIds.has(node.id)
        : !connectedNodeIds.has(node.id))
    )
  ))
}

export function edgesWithinNodes(nodes: TextFlowNode[], edges: GraphEdge[]) {
  const nodeIds = new Set(nodes.map((node) => node.id))
  return edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
}
