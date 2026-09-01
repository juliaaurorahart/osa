import type { GraphEdge } from '../graph/graphEdge'
import {
  isOsaOperationStatus,
  OSA_OPERATION_INSTRUCTION_MODE,
  OSA_OPERATION_STATUS,
  OSA_OPERATION_VISUAL_ROLE,
  OSA_PROPERTY,
  OSA_RELATION,
  operationVisualDisplayOrder,
  operationVisualRole,
  operationOrder,
  osaRole,
  type OsaOperationStatus,
  type OsaOperationVisualRole,
} from '../graph/osaData'
import type { TextFlowNode } from '../graph/textNode'
import { isVisualNode, visualEmbedsForCanvas } from '../graph/visualEmbed'
import { visualForOfficialVersion } from '../graph/visualVersion'

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
 * The Assembly tracks physical throughput as a count, not as a task checkbox.
 * Older boards that marked an instruction complete still read as one until a
 * deliberate count is entered.
 */
export function operationCompletedCount(operation: TextFlowNode) {
  const storedCount = operation.data.properties[OSA_PROPERTY.operationCompletedCount]
  if (storedCount === undefined || storedCount.trim() === '') {
    return operation.data.task?.completedAt ? 1 : 0
  }

  const parsedCount = Number(storedCount)
  return Number.isFinite(parsedCount) && parsedCount >= 0
    ? Math.floor(parsedCount)
    : 0
}

/**
 * Reads one instruction's deliberate workflow state.
 *
 * Status stays independent from physical throughput and legacy task
 * completion. An older instruction therefore begins as Pending until
 * someone deliberately changes this field.
 */
export function operationStatus(operation: TextFlowNode): OsaOperationStatus {
  const storedStatus = operation.data.properties[OSA_PROPERTY.operationStatus]
  if (storedStatus && isOsaOperationStatus(storedStatus)) return storedStatus
  return OSA_OPERATION_STATUS.notStarted
}

export function operationStatusLabel(status: OsaOperationStatus) {
  if (status === OSA_OPERATION_STATUS.inProgress) return 'In progress'
  if (status === OSA_OPERATION_STATUS.partialComplete) return 'Partial Complete'
  if (status === OSA_OPERATION_STATUS.complete) return 'Complete'
  return 'Pending'
}

/** A concise exception shown directly beneath an instruction's status. */
export function operationAttentionNote(operation: TextFlowNode) {
  return operation.data.properties[OSA_PROPERTY.operationAttention]?.trim() ?? ''
}

/**
 * Presents old structured Step text as one description without rewriting or
 * deleting the underlying nodes. A deliberate mode cutover makes the
 * instruction-level text authoritative, including an intentionally blank
 * description.
 */
export function instructionDescription(operation: TextFlowNode, steps: TextFlowNode[]) {
  if (
    operation.data.properties[OSA_PROPERTY.operationInstructionMode]
    === OSA_OPERATION_INSTRUCTION_MODE.single
  ) return operation.data.text

  const legacyStepDescription = steps.flatMap((step) => {
    const defaultName = /^step(?:\s+\d+)?$/i
    const name = step.data.name.trim()
    const text = step.data.text.trim()
    const lines = [
      name && !defaultName.test(name) ? name : '',
      text && text !== name ? text : '',
    ].filter(Boolean)
    return lines.length ? [lines.join('\n')] : []
  }).join('\n\n')

  return legacyStepDescription || operation.data.text
}

export type InstructionVisual = {
  /** Exact placement identity; a Step-only legacy Visual has no placement yet. */
  edgeId: string | null
  visual: TextFlowNode
  role: OsaOperationVisualRole | null
}

/**
 * Collects explicit operation Visuals plus any older Step-owned Visuals.
 * Legacy Visuals remain unassigned until someone deliberately chooses Before
 * or After; no image is guessed or moved during this compatibility projection.
 */
export function instructionVisualsForOperation(
  operationId: string,
  steps: TextFlowNode[],
  nodes: TextFlowNode[],
  edges: GraphEdge[],
): InstructionVisual[] {
  const placements = edges
    .map((edge, edgeIndex) => ({ edge, edgeIndex }))
    .filter(({ edge }) => (
      edge.source === operationId
      && edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.operationVisual
    ))
    .sort((left, right) => (
      operationVisualDisplayOrder(
        left.edge.data.properties[OSA_PROPERTY.operationVisualOrder],
        left.edgeIndex,
      ) - operationVisualDisplayOrder(
        right.edge.data.properties[OSA_PROPERTY.operationVisualOrder],
        right.edgeIndex,
      )
    ))
    .flatMap(({ edge }) => {
      const visual = nodes.find((node) => node.id === edge.target)
      if (!visual || !isVisualNode(visual)) return []
      const placement: InstructionVisual = {
        edgeId: edge.id,
        visual,
        // Existing Step canvases were deliberately published with this flag
        // before Before/After roles existed. Keep those visible as After until
        // the author explicitly moves them; unpublished roleless work remains
        // private and unprojected.
        role: operationVisualRole(
          edge.data.properties[OSA_PROPERTY.operationVisualRole],
        ) ?? (visual.data.properties[OSA_PROPERTY.visualIncludeInInstructions] === 'true'
          ? OSA_OPERATION_VISUAL_ROLE.after
          : null),
      }
      return [placement]
    })

  const placedVisualIds = new Set(placements.map((placement) => placement.visual.id))
  const legacyStepVisuals: InstructionVisual[] = []
  steps.forEach((step) => {
    const visual = canvasOwnedByStep(step.id, nodes, edges)
    if (visual && !placedVisualIds.has(visual.id)) {
      legacyStepVisuals.push({
        edgeId: null,
        visual,
        role: visual.data.properties[OSA_PROPERTY.visualIncludeInInstructions] === 'true'
          ? OSA_OPERATION_VISUAL_ROLE.after
          : null,
      })
    }
  })

  return [...placements, ...legacyStepVisuals]
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

/** One incoming graph relationship shown by an object's Included-in list. */
export type InclusionRelationship = {
  edgeId: string
  container: TextFlowNode
  relationship: string
}

/**
 * Returns the exact incoming graph relationships for one object.
 *
 * The inspector does not keep a second membership list or infer hidden links.
 * One row represents one durable edge, so removing that row can remove that
 * exact edge without deleting either object or disturbing another relation.
 */
export function inclusionRelationshipsFor(
  itemId: string,
  nodes: TextFlowNode[],
  edges: GraphEdge[],
): InclusionRelationship[] {
  const nodesById = new Map(nodes.map((node) => [node.id, node]))

  return edges.flatMap((edge) => {
    if (edge.target !== itemId) return []
    const container = nodesById.get(edge.source)
    if (!container) return []

    return [{
      edgeId: edge.id,
      container,
      relationship: edge.data.relationship.trim() || 'relates to',
    }]
  })
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

/**
 * Returns whether a Visual will contribute something visible to a read-only
 * Assembly Instruction. The instruction view renders the Official version
 * when there is one, so this deliberately checks that same projection rather
 * than exposing an empty draft work surface to a recipient.
 */
export function visualHasInstructionContent(
  visual: TextFlowNode,
  nodes: TextFlowNode[],
  edges: GraphEdge[],
) {
  const displayed = visualForOfficialVersion(visual)
  const image = displayed.data.properties[OSA_PROPERTY.assetImage]?.trim()
  if (image) return true

  const hasDrawing = displayed.data.sketch.layers.some((layer) => (
    (layer.elements?.length ?? 0) > 0 || layer.strokes.length > 0
  ))
  if (hasDrawing) return true

  // A deliberately assembled canvas can consist solely of linked Visuals.
  return visualEmbedsForCanvas(visual.id, nodes, edges).length > 0
}
