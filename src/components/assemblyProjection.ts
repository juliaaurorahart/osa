import type { GraphEdge } from '../graph/graphEdge'
import {
  OSA_PROPERTY,
  OSA_RELATION,
  operationOrder,
  osaRole,
} from '../graph/osaData'
import type { TextFlowNode } from '../graph/textNode'
import { isVisualNode } from '../graph/visualEmbed'

/**
 * Shared, read-only derivations for Assembly and Assembly Instructions.
 *
 * These helpers live outside either React component so both projections keep
 * the same interpretation of the durable graph without affecting hot reload.
 */
export function nodeTitle(node: TextFlowNode) {
  return node.data.name.trim()
    || node.data.text.trim().split(/\r?\n/, 1)[0]
    || `#${node.id}`
}

/**
 * Finds ordinary nodes connected from a root node for one Assembly projection.
 *
 * Imported data may carry an optional relation hint. Objects made directly in
 * OSA remain discoverable through their normal edge meaning and node kind.
 */
export function connectedTargets(
  rootId: string,
  candidates: TextFlowNode[],
  edges: GraphEdge[],
  relationHint: string,
  relationshipPattern: RegExp,
  relationKind?: GraphEdge['data']['relationKind'],
) {
  const targetIds = edges
    .filter((edge) => edge.source === rootId && (
      edge.data.properties[OSA_PROPERTY.relationRole] === relationHint
      || relationshipPattern.test(edge.data.relationship)
      || (relationKind !== undefined && edge.data.relationKind === relationKind)
    ))
    .map((edge) => edge.target)
  const order = new Map(targetIds.map((id, index) => [id, index]))

  return candidates
    .filter((node) => order.has(node.id))
    .sort((left, right) => (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0))
}

export function operationsForAssembly(
  assemblyId: string,
  operations: TextFlowNode[],
  edges: GraphEdge[],
) {
  return connectedTargets(
    assemblyId,
    operations,
    edges,
    OSA_RELATION.assemblyOperation,
    /\b(operation|action|step)\b/i,
    'project-task',
  ).sort((left, right) => operationOrder(left) - operationOrder(right))
}

/** Ordered instruction objects that belong directly to one Assembly card. */
export function stepsForOperation(
  operationId: string,
  nodes: TextFlowNode[],
  edges: GraphEdge[],
) {
  return connectedTargets(
    operationId,
    nodes,
    edges,
    OSA_RELATION.operationStep,
    /\b(step|steps)\b/i,
  )
    .filter((node) => osaRole(node) === 'step')
    .sort((left, right) => {
      const leftOrder = Number(left.data.properties[OSA_PROPERTY.order])
      const rightOrder = Number(right.data.properties[OSA_PROPERTY.order])
      return (Number.isFinite(leftOrder) ? leftOrder : Number.MAX_SAFE_INTEGER)
        - (Number.isFinite(rightOrder) ? rightOrder : Number.MAX_SAFE_INTEGER)
    })
}

/** A step's canvas is a normal Visual owned by that one step. */
export function canvasOwnedByStep(stepId: string, nodes: TextFlowNode[], edges: GraphEdge[]) {
  const visualId = edges.find((edge) => (
    edge.source === stepId
    && edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.objectVisual
  ))?.target
  const visual = visualId ? nodes.find((node) => node.id === visualId) : undefined
  return isVisualNode(visual) ? visual : undefined
}
