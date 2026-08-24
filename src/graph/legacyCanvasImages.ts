import { createGraphEdge, type GraphEdge } from './graphEdge'
import {
  defaultVisualEmbedPlacement,
  OSA_PROPERTY,
  OSA_RELATION,
} from './osaData'
import { createTextNode, type TextFlowNode } from './textNode'
import { isVisualEmbedEdge, isVisualNode } from './visualEmbed'

/**
 * Earlier canvas drafts stored an uploaded photo directly on the editable
 * canvas as `asset:image`. That made it a background, so it could not be
 * selected, moved, resized, or removed independently.
 *
 * This additive migration promotes that photo to its own immutable Visual and
 * places it in the former canvas through a normal `visual-embed` edge. The
 * original canvas keeps its sketch, name, and ownership; only the misplaced
 * image payload moves to its own durable object.
 */
function legacyImageAssetId(canvasId: string) {
  return `osa:legacy:visual:${encodeURIComponent(canvasId)}:image`
}

function uniqueId(preferred: string, existing: Set<string>) {
  if (!existing.has(preferred)) return preferred
  let index = 2
  let candidate = `${preferred}-${index}`
  while (existing.has(candidate)) {
    index += 1
    candidate = `${preferred}-${index}`
  }
  return candidate
}

function isEditableVisualWithLegacyBackground(node: TextFlowNode) {
  const image = node.data.properties[OSA_PROPERTY.assetImage]?.trim()
  return isVisualNode(node)
    && node.data.properties[OSA_PROPERTY.visualContent] !== 'image'
    && node.data.properties[OSA_PROPERTY.visualImmutable] !== 'true'
    && Boolean(image)
}

export function migrateLegacyCanvasBackgroundImages(
  currentNodes: TextFlowNode[],
  currentEdges: GraphEdge[],
) {
  let nodes = currentNodes
  let edges = currentEdges
  let nodesChanged = false
  let edgesChanged = false
  const nodeIds = new Set(nodes.map((node) => node.id))
  const edgeIds = new Set(edges.map((edge) => edge.id))

  for (const canvas of currentNodes) {
    if (!isEditableVisualWithLegacyBackground(canvas)) continue

    const image = canvas.data.properties[OSA_PROPERTY.assetImage]?.trim() ?? ''
    const alt = canvas.data.properties[OSA_PROPERTY.assetImageAlt]?.trim()
      || `${canvas.data.name || 'canvas'} image`
    const preferredImageId = legacyImageAssetId(canvas.id)
    let imageAsset = nodes.find((node) => (
      node.id === preferredImageId
      && isVisualNode(node)
      && node.data.properties[OSA_PROPERTY.assetImage] === image
    ))

    if (!imageAsset) {
      const imageId = uniqueId(preferredImageId, nodeIds)
      imageAsset = createTextNode({
        id: imageId,
        position: { x: canvas.position.x + 240, y: canvas.position.y + 120 },
        name: alt,
        text: 'Imported image asset migrated from a canvas background.',
        kind: 'visual',
        spaceIds: canvas.data.spaceIds,
        properties: {
          [OSA_PROPERTY.role]: 'visual',
          [OSA_PROPERTY.visualContent]: 'image',
          [OSA_PROPERTY.visualImmutable]: 'true',
          [OSA_PROPERTY.assetImage]: image,
          [OSA_PROPERTY.assetImageAlt]: alt,
        },
      })
      nodes = [...nodes, imageAsset]
      nodeIds.add(imageId)
    }

    const hasPlacement = edges.some((edge) => (
      edge.source === canvas.id
      && edge.target === imageAsset.id
      && isVisualEmbedEdge(edge)
    ))
    if (!hasPlacement) {
      const placement = defaultVisualEmbedPlacement(edges.filter((edge) => (
        edge.source === canvas.id && isVisualEmbedEdge(edge)
      )).length)
      const edgeId = uniqueId(
        `osa:legacy:edge:${encodeURIComponent(canvas.id)}:background-image`,
        edgeIds,
      )
      edges = [...edges, createGraphEdge({
        id: edgeId,
        source: canvas.id,
        target: imageAsset.id,
        relationship: 'includes visual',
        properties: {
          [OSA_PROPERTY.relationRole]: OSA_RELATION.visualEmbed,
          [OSA_PROPERTY.visualEmbedX]: String(placement.x),
          [OSA_PROPERTY.visualEmbedY]: String(placement.y),
          [OSA_PROPERTY.visualEmbedWidth]: String(placement.width),
          [OSA_PROPERTY.visualEmbedHeight]: String(placement.height),
        },
      })]
      edgeIds.add(edgeId)
      edgesChanged = true
    }

    nodes = nodes.map((node) => {
      if (node.id !== canvas.id) return node
      const properties = { ...node.data.properties }
      delete properties[OSA_PROPERTY.assetImage]
      delete properties[OSA_PROPERTY.assetImageAlt]
      return {
        ...node,
        data: {
          ...node.data,
          properties: {
            ...properties,
            [OSA_PROPERTY.visualContent]: 'canvas',
          },
        },
      }
    })
    nodesChanged = true
  }

  return { nodes, edges, nodesChanged, edgesChanged }
}
