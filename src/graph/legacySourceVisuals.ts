import { createGraphEdge, type GraphEdge } from './graphEdge'
import {
  canOwnOsaVisual,
  OSA_PROPERTY,
  OSA_RELATION,
  osaRole,
} from './osaData'
import { createTextNode, type TextFlowNode } from './textNode'

/** True when a node is OSA's first-class, reusable Visual object. */
function isVisualNode(node: TextFlowNode | undefined) {
  return node?.data.kind === 'visual' || (node !== undefined && osaRole(node) === 'visual')
}

/**
 * Legacy operations stored a source slide directly as an image URL in
 * `instruction:visual`. A URL is useful provenance, but it is not an
 * editable/reusable project object. This identifies those direct image
 * locators without guessing that an arbitrary missing node ID is an image.
 */
function isRawImageReference(value: string) {
  return value.startsWith('/')
    || /^https?:\/\//i.test(value)
    || /^data:image\//i.test(value)
}

function uniqueId(preferredId: string, existingIds: Set<string>) {
  if (!existingIds.has(preferredId)) return preferredId

  let suffix = 2
  let candidate = `${preferredId}-${suffix}`
  while (existingIds.has(candidate)) {
    suffix += 1
    candidate = `${preferredId}-${suffix}`
  }
  return candidate
}

function operationParentAssemblyId(operationId: string, edges: GraphEdge[]) {
  return edges.find((edge) => (
    edge.target === operationId
    && (
      edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.assemblyOperation
      || edge.data.relationKind === 'project-task'
    )
  ))?.source ?? null
}

/**
 * A source visual belongs to the thing an instruction produces. Older or
 * incomplete cards can safely use their parent Assembly instead. This is an
 * ownership rule only; it never makes an operation own visual content.
 */
function sourceVisualOwnerId(
  operation: TextFlowNode,
  nodes: TextFlowNode[],
  edges: GraphEdge[],
) {
  const primaryOutputId = edges.find((edge) => (
    edge.source === operation.id
    && edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.operationPrimaryOutput
  ))?.target
  const parentAssemblyId = operationParentAssemblyId(operation.id, edges)

  return [primaryOutputId, parentAssemblyId]
    .find((candidateId) => {
      if (!candidateId) return false
      const candidate = nodes.find((node) => node.id === candidateId)
      return Boolean(candidate && canOwnOsaVisual(candidate))
    }) ?? null
}

function sourceProperties(operation: TextFlowNode, image: string, alt: string) {
  const provenance = Object.fromEntries(Object.entries(operation.data.properties)
    .filter(([name]) => name.startsWith('source:')))

  return {
    [OSA_PROPERTY.role]: 'visual',
    [OSA_PROPERTY.assetImage]: image,
    [OSA_PROPERTY.assetImageAlt]: alt,
    [OSA_PROPERTY.visualContent]: 'image',
    [OSA_PROPERTY.visualImmutable]: 'true',
    // Keep the old fields on the Visual as display-compatible mirrors. The
    // operation itself now points at this Visual node and the relation below
    // is authoritative.
    [OSA_PROPERTY.instructionVisual]: image,
    [OSA_PROPERTY.instructionVisualAlt]: alt,
    ...provenance,
  }
}

/**
 * Promotes direct legacy source-image URLs into normal reusable Visual nodes.
 *
 * The migration is intentionally additive and idempotent. It never replaces
 * an existing Visual, source relation, or owner; it only supplies missing
 * durable objects/relationships needed to make an old source slide editable
 * and selectable through the same path as every other canvas.
 */
export function migrateLegacyOperationSourceVisuals(
  currentNodes: TextFlowNode[],
  currentEdges: GraphEdge[],
) {
  let nextNodes = currentNodes
  let nextEdges = currentEdges
  let nodesChanged = false
  let edgesChanged = false
  const nodeIds = new Set(currentNodes.map((node) => node.id))
  const edgeIds = new Set(currentEdges.map((edge) => edge.id))

  for (const operation of currentNodes) {
    if (operation.data.kind !== 'action' && osaRole(operation) !== 'operation') continue

    const rawReference = operation.data.properties[OSA_PROPERTY.instructionVisual]?.trim() ?? ''
    const directReferenceNode = nextNodes.find((node) => node.id === rawReference)
    const existingSourceVisual = nextEdges
      .filter((edge) => (
        edge.source === operation.id
        && edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.operationSourceVisual
      ))
      .map((edge) => nextNodes.find((node) => node.id === edge.target))
      .find(isVisualNode)

    let visual = existingSourceVisual ?? (isVisualNode(directReferenceNode) ? directReferenceNode : undefined)

    if (!visual) {
      // A missing ID may be a broken reference rather than a legacy image.
      // Only promote unmistakable direct image locators.
      if (!isRawImageReference(rawReference)) continue

      const preferredVisualId = `osa:legacy:visual:${encodeURIComponent(operation.id)}:source`
      // Recover a board saved halfway through an older upgrade without making
      // a second source slide. It must be the expected legacy Visual and it
      // must carry the same image, so an unrelated Visual with the same ID is
      // never silently adopted.
      const partiallyMigratedVisual = nextNodes.find((node) => (
        node.id === preferredVisualId
        && isVisualNode(node)
        && node.data.properties[OSA_PROPERTY.assetImage] === rawReference
      ))
      if (partiallyMigratedVisual) {
        visual = partiallyMigratedVisual
        const migratedVisualId = partiallyMigratedVisual.id
        nextNodes = nextNodes.map((node) => (
          node.id === operation.id
            ? {
                ...node,
                data: {
                  ...node.data,
                  properties: {
                    ...node.data.properties,
                    [OSA_PROPERTY.instructionVisual]: migratedVisualId,
                  },
                },
              }
            : node
        ))
        nodesChanged = true
      } else {
        const visualId = uniqueId(preferredVisualId, nodeIds)
        const alt = operation.data.properties[OSA_PROPERTY.instructionVisualAlt]?.trim()
          || `${operation.data.name || 'operation'} source slide`
        visual = createTextNode({
          id: visualId,
          position: {
            x: operation.position.x + 260,
            y: operation.position.y,
          },
          name: 'source slide',
          text: 'Source visual migrated from this operation.',
          kind: 'visual',
          spaceIds: operation.data.spaceIds,
          properties: sourceProperties(operation, rawReference, alt),
        })
        nextNodes = nextNodes.map((node) => (
          node.id === operation.id
            ? {
                ...node,
                data: {
                  ...node.data,
                  properties: {
                    ...node.data.properties,
                    [OSA_PROPERTY.instructionVisual]: visualId,
                  },
                },
              }
            : node
        ))
        nextNodes = [...nextNodes, visual]
        nodeIds.add(visualId)
        nodesChanged = true
      }
    }

    // The branches above either found/promoted a real Visual or skipped this
    // operation. Keeping this explicit makes the following relationship work
    // on a concrete object rather than a raw image locator.
    if (!visual) continue

    // The original PowerPoint slide is an image asset, not an annotation
    // canvas. Older OSA drafts already contain canonical `source slide`
    // Visuals, so mark just that known source-asset shape without touching a
    // deliberately created canvas or an explicit person-made content choice.
    const shouldMarkAsImmutableImage = (
      visual.data.name.trim().toLowerCase() === 'source slide'
      && Boolean(visual.data.properties[OSA_PROPERTY.assetImage]?.trim())
      && !visual.data.properties[OSA_PROPERTY.visualContent]
      && !visual.data.properties[OSA_PROPERTY.visualImmutable]
    )
    if (shouldMarkAsImmutableImage) {
      const visualId = visual.id
      nextNodes = nextNodes.map((node) => (
        node.id === visualId
          ? {
              ...node,
              data: {
                ...node.data,
                properties: {
                  ...node.data.properties,
                  [OSA_PROPERTY.visualContent]: 'image',
                  [OSA_PROPERTY.visualImmutable]: 'true',
                },
              },
            }
          : node
      ))
      visual = nextNodes.find((node) => node.id === visualId) ?? visual
      nodesChanged = true
    }

    const hasSourceRelation = nextEdges.some((edge) => (
      edge.source === operation.id
      && edge.target === visual.id
      && edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.operationSourceVisual
    ))
    if (!hasSourceRelation) {
      const edgeId = uniqueId(
        `osa:legacy:edge:${encodeURIComponent(operation.id)}:source-visual`,
        edgeIds,
      )
      nextEdges = [...nextEdges, createGraphEdge({
        id: edgeId,
        source: operation.id,
        target: visual.id,
        relationship: 'uses source visual',
        properties: { [OSA_PROPERTY.relationRole]: OSA_RELATION.operationSourceVisual },
      })]
      edgeIds.add(edgeId)
      edgesChanged = true
    }

    const alreadyOwned = nextEdges.some((edge) => (
      edge.target === visual.id
      && edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.objectVisual
    ))
    if (alreadyOwned) continue

    const currentOperation = nextNodes.find((node) => node.id === operation.id) ?? operation
    const ownerId = sourceVisualOwnerId(currentOperation, nextNodes, nextEdges)
    if (!ownerId) continue

    const edgeId = uniqueId(
      `osa:legacy:edge:${encodeURIComponent(operation.id)}:owns-source-visual`,
      edgeIds,
    )
    nextEdges = [...nextEdges, createGraphEdge({
      id: edgeId,
      source: ownerId,
      target: visual.id,
      relationship: 'owns visual',
      properties: { [OSA_PROPERTY.relationRole]: OSA_RELATION.objectVisual },
    })]
    edgeIds.add(edgeId)
    edgesChanged = true
  }

  return {
    nodes: nodesChanged ? nextNodes : currentNodes,
    edges: edgesChanged ? nextEdges : currentEdges,
  }
}
