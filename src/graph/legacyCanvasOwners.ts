import type { GraphEdge } from './graphEdge'
import {
  canOwnOsaVisual,
  OSA_PROPERTY,
  OSA_RELATION,
  osaRole,
} from './osaData'
import type { TextFlowNode } from './textNode'

function isOperation(node: TextFlowNode | undefined): node is TextFlowNode {
  return node?.data.kind === 'action' || (node ? osaRole(node) === 'operation' : false)
}

function isVisual(node: TextFlowNode | undefined): node is TextFlowNode {
  return node?.data.kind === 'visual' || (node ? osaRole(node) === 'visual' : false)
}

function parentAssemblyIdForOperation(operationId: string, edges: GraphEdge[]) {
  return edges.find((edge) => (
    edge.target === operationId
    && (
      edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.assemblyOperation
      || edge.data.relationKind === 'project-task'
    )
  ))?.source ?? null
}

/**
 * Returns the output objects an older card could have used as a canvas owner.
 * The old UI preferred the explicit primary output; only if that relation is
 * absent does exactly one ordinary output qualify as an unambiguous fallback.
 */
function legacyOutputIdsForOperation(operationId: string, edges: GraphEdge[]) {
  const primaryOutputIds = edges
    .filter((edge) => (
      edge.source === operationId
      && edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.operationPrimaryOutput
    ))
    .map((edge) => edge.target)
  if (primaryOutputIds.length) return new Set(primaryOutputIds)

  const ordinaryOutputIds = edges
    .filter((edge) => (
      edge.source === operationId
      && edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.operationOutput
    ))
    .map((edge) => edge.target)
  return ordinaryOutputIds.length === 1 ? new Set(ordinaryOutputIds) : new Set<string>()
}

/**
 * Updates canvases created by OSA's older Assembly UI.
 *
 * That UI made an operation's output Part own each new canvas. In the current
 * model a card's canvas starts with the parent Assembly, and its owner can be
 * changed only to that Assembly, one of the card's In parts, or one of its
 * Tools. Moving only the clearly old pattern keeps the data coherent without
 * touching a deliberately assigned visual:
 *
 * - the visual is displayed by that operation;
 * - it has exactly one owner; and
 * - that owner is the operation's old primary (or single ordinary) output.
 *
 * The Visual node, its card reference, image, drawing, and edge ID remain
 * unchanged. The one ownership edge simply points to the parent Assembly.
 */
export function migrateLegacyCardOutputVisualOwners(
  currentNodes: TextFlowNode[],
  currentEdges: GraphEdge[],
) {
  const nodesById = new Map(currentNodes.map((node) => [node.id, node]))
  const assemblyForVisual = new Map<string, string>()
  const conflictedVisualIds = new Set<string>()

  for (const cardVisualEdge of currentEdges) {
    if (cardVisualEdge.data.properties[OSA_PROPERTY.relationRole] !== OSA_RELATION.operationVisual) {
      continue
    }

    const operation = nodesById.get(cardVisualEdge.source)
    const visual = nodesById.get(cardVisualEdge.target)
    if (!isOperation(operation) || !isVisual(visual)) continue

    const assemblyId = parentAssemblyIdForOperation(operation.id, currentEdges)
    const assembly = assemblyId ? nodesById.get(assemblyId) : undefined
    if (!assemblyId || !assembly || !canOwnOsaVisual(assembly)) continue

    const oldOutputIds = legacyOutputIdsForOperation(operation.id, currentEdges)
    if (!oldOutputIds.size) continue

    const ownerEdges = currentEdges.filter((edge) => (
      edge.target === visual.id
      && edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.objectVisual
    ))
    if (ownerEdges.length !== 1 || !oldOutputIds.has(ownerEdges[0].source)) continue

    const existingAssemblyId = assemblyForVisual.get(visual.id)
    if (existingAssemblyId && existingAssemblyId !== assemblyId) {
      // One reusable visual appearing on cards in two different Assemblies is
      // not an automatic migration case. Leave it exactly as its author set it.
      assemblyForVisual.delete(visual.id)
      conflictedVisualIds.add(visual.id)
    } else if (!conflictedVisualIds.has(visual.id)) {
      assemblyForVisual.set(visual.id, assemblyId)
    }
  }

  if (!assemblyForVisual.size) {
    return { nodes: currentNodes, edges: currentEdges }
  }

  return {
    nodes: currentNodes,
    edges: currentEdges.map((edge) => {
      const assemblyId = assemblyForVisual.get(edge.target)
      if (
        !assemblyId
        || edge.data.properties[OSA_PROPERTY.relationRole] !== OSA_RELATION.objectVisual
      ) {
        return edge
      }
      return { ...edge, source: assemblyId }
    }),
  }
}
