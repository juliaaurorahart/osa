import type { GraphEdge } from './graphEdge'
import {
  appearanceAccentColor,
  defaultVisualEmbedPlacement,
  normalizeVisualEmbedPlacement,
  OSA_PROPERTY,
  OSA_RELATION,
  osaRole,
  type VisualEmbedPlacement,
} from './osaData'
import type { TextFlowNode } from './textNode'
import {
  officialVisualVersion,
  visualForOfficialVersion,
  type VisualVersionEmbed,
  type VisualVersionRecord,
} from './visualVersion'

/**
 * A placement is deliberately a relationship, not copied canvas data.
 *
 * `visual` is the canonical child object. `placement` describes only how the
 * parent canvas shows it. The same Visual can therefore appear in several
 * canvases with a different position and size in each one.
 */
export type VisualEmbedInstance = {
  /** Stable edge id for existing links; a local draft may use a temporary id. */
  id: string
  visual: TextFlowNode
  placement: VisualEmbedPlacement
  /**
   * A derived, non-persistent cue from this Visual or its canonical owner.
   * Canvas artwork stays unchanged; views may render a compact frame/tag to
   * connect a placed visual to the Part or Tool it represents.
   */
  accentColor?: string
  /**
   * The child canvas's own placements, projected from the same graph. A
   * preview needs this small tree so a canvas placed inside another canvas
   * renders its actual contents instead of an empty white box.
   *
   * This is derived display data only. The durable records remain the direct
   * `visual-embed` edges; no child content is copied onto its parent.
   */
  embeddedVisuals?: VisualEmbedInstance[]
}

type VisualProjection = 'official' | 'draft'

/** A Visual remains a normal OSA node whether it is a canvas or an image asset. */
export function isVisualNode(node: TextFlowNode | undefined) {
  return Boolean(node && (node.data.kind === 'visual' || osaRole(node) === 'visual'))
}

/**
 * Resolves the canonical object that owns a reusable Visual.
 *
 * Ownership is a graph relationship rather than a copied property on the
 * Visual, so changing a Part/Tool name or accent automatically reaches every
 * Visual placement without rewriting artwork or placement edges.
 */
export function visualOwnerFor(
  visualId: string,
  nodes: TextFlowNode[],
  edges: GraphEdge[],
) {
  const ownership = edges.find((edge) => (
    edge.target === visualId
    && edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.objectVisual
  ))
  return ownership ? nodes.find((node) => node.id === ownership.source) : undefined
}

/**
 * A Visual may opt into its own accent, otherwise inherit its owner's semantic
 * accent. The owner fallback is what makes a Tool's purple label and its
 * reusable drill Visual coordinate everywhere.
 */
export function visualAccentColor(
  visual: TextFlowNode,
  nodes: TextFlowNode[],
  edges: GraphEdge[],
) {
  return appearanceAccentColor(visual) ?? appearanceAccentColor(visualOwnerFor(visual.id, nodes, edges))
}

/** True only for the direct parent-canvas -> child-Visual relationship. */
export function isVisualEmbedEdge(edge: GraphEdge, parentId?: string) {
  return edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.visualEmbed
    && (parentId === undefined || edge.source === parentId)
}

/** Reads safe pixel geometry from an embed edge, including old/missing values. */
export function visualEmbedPlacementFromEdge(edge: GraphEdge, index: number) {
  const aspectRatioLocked = edge.data.properties[OSA_PROPERTY.visualEmbedAspectRatioLocked]
  return normalizeVisualEmbedPlacement({
    x: Number(edge.data.properties[OSA_PROPERTY.visualEmbedX]),
    y: Number(edge.data.properties[OSA_PROPERTY.visualEmbedY]),
    width: Number(edge.data.properties[OSA_PROPERTY.visualEmbedWidth]),
    height: Number(edge.data.properties[OSA_PROPERTY.visualEmbedHeight]),
    // Older boards did not have this property. Omitting it lets the current
    // placement default apply instead of accidentally treating it as unlock.
    ...((aspectRatioLocked === 'true' || aspectRatioLocked === 'false')
      ? { aspectRatioLocked: aspectRatioLocked === 'true' }
      : {}),
  }, defaultVisualEmbedPlacement(index))
}

function visualForProjection(visual: TextFlowNode, projection: VisualProjection) {
  return projection === 'official' ? visualForOfficialVersion(visual) : visual
}

function snapshotEmbedsForCanvas(
  embeds: readonly VisualVersionEmbed[],
  nodes: TextFlowNode[],
  edges: GraphEdge[],
  ancestorVisualIds: ReadonlySet<string>,
  projection: VisualProjection,
): VisualEmbedInstance[] {
  return embeds
    .map((embed) => {
      const visual = nodes.find((node) => node.id === embed.visualId)
      if (!visual || !isVisualNode(visual)) return null
      const embeddedVisuals = visualEmbedsForCanvas(
        visual.id,
        nodes,
        edges,
        ancestorVisualIds,
        projection,
      )
      const accentColor = visualAccentColor(visual, nodes, edges)
      const instance: VisualEmbedInstance = {
        id: embed.id,
        visual: visualForProjection(visual, projection),
        placement: { ...embed.placement },
        // Keep the old JSON/render projection byte-for-byte stable when no
        // semantic accent exists; the cue is optional derived display data.
        ...(accentColor ? { accentColor } : {}),
      }
      return embeddedVisuals.length ? { ...instance, embeddedVisuals } : instance
    })
    .filter((embed): embed is VisualEmbedInstance => embed !== null)
}

/**
 * Projects one saved version record. This is what lets an Assembly card keep
 * showing the locked positions of its child visuals while its editable draft
 * changes elsewhere.
 */
export function visualEmbedsForVersion(
  parentVisualId: string,
  record: VisualVersionRecord,
  nodes: TextFlowNode[],
  edges: GraphEdge[],
  ancestorVisualIds: ReadonlySet<string> = new Set(),
  projection: VisualProjection = 'official',
): VisualEmbedInstance[] {
  // Invalid older data could contain a visual-embed cycle. Normal authoring
  // rejects those cycles, but a preview should still stay finite and render
  // the valid portion of the graph.
  if (ancestorVisualIds.has(parentVisualId)) return []
  const nextAncestors = new Set(ancestorVisualIds)
  nextAncestors.add(parentVisualId)

  return snapshotEmbedsForCanvas(
    record.embeds,
    nodes,
    edges,
    nextAncestors,
    projection,
  )
}

/**
 * Projects the direct children of one canvas into a renderable local list.
 * Normal views receive the locked Official version when there is one; the
 * canvas editor deliberately asks for the live draft projection instead.
 */
export function visualEmbedsForCanvas(
  parentVisualId: string,
  nodes: TextFlowNode[],
  edges: GraphEdge[],
  ancestorVisualIds: ReadonlySet<string> = new Set(),
  projection: VisualProjection = 'official',
): VisualEmbedInstance[] {
  if (ancestorVisualIds.has(parentVisualId)) return []
  const nextAncestors = new Set(ancestorVisualIds)
  nextAncestors.add(parentVisualId)

  const parentVisual = nodes.find((node) => node.id === parentVisualId)
  const official = projection === 'official'
    ? officialVisualVersion(parentVisual?.data.visualVersions)
    : null
  if (official) {
    return snapshotEmbedsForCanvas(
      official.embeds,
      nodes,
      edges,
      nextAncestors,
      projection,
    )
  }

  return edges
    .filter((edge) => isVisualEmbedEdge(edge, parentVisualId))
    .map((edge, index) => {
      const visual = nodes.find((node) => node.id === edge.target)
      if (!visual || !isVisualNode(visual)) return null
      const embeddedVisuals = visualEmbedsForCanvas(
        visual.id,
        nodes,
        edges,
        nextAncestors,
        projection,
      )
      const accentColor = visualAccentColor(visual, nodes, edges)
      const instance: VisualEmbedInstance = {
        id: edge.id,
        visual: visualForProjection(visual, projection),
        placement: visualEmbedPlacementFromEdge(edge, index),
        ...(accentColor ? { accentColor } : {}),
      }
      return embeddedVisuals.length ? { ...instance, embeddedVisuals } : instance
    })
    .filter((embed): embed is VisualEmbedInstance => embed !== null)
}

/** The live direct edges are the editable canvas draft, never the official render. */
export function visualDraftEmbedsForCanvas(
  parentVisualId: string,
  nodes: TextFlowNode[],
  edges: GraphEdge[],
) {
  return visualEmbedsForCanvas(parentVisualId, nodes, edges, new Set(), 'draft')
}

/**
 * Reject a relationship that would make a Visual contain itself, directly or
 * through another canvas. The traversal follows only `visual-embed` edges;
 * ownership and Assembly display links have different meanings.
 */
export function visualEmbedWouldCreateCycle(
  parentVisualId: string,
  childVisualId: string,
  edges: GraphEdge[],
) {
  if (parentVisualId === childVisualId) return true

  const pending = [childVisualId]
  const seen = new Set<string>()
  while (pending.length) {
    const current = pending.pop()
    if (!current || seen.has(current)) continue
    if (current === parentVisualId) return true
    seen.add(current)

    edges.forEach((edge) => {
      if (edge.source === current && isVisualEmbedEdge(edge)) {
        pending.push(edge.target)
      }
    })
  }
  return false
}
