import shakoLightWrapRaw from '../../imports/shako-light-wrap.osa.json?raw'
import { createGraphEdge, type GraphEdge } from '../graph/graphEdge'
import { createTextNode, type TextFlowNode } from '../graph/textNode'
import {
  OSA_PROPERTY,
  OSA_RELATION,
  osaRole,
} from '../graph/osaData'
import {
  parseOsaImportPackage,
  planOsaImport,
  type OsaImportPlan,
} from '../graph/osaImport'
import type { OsaStarter } from './starter'

/** Display name used when the bundled project becomes the active board. */
const SHAKO_LIGHT_WRAP_STARTER_NAME = 'Shako Light Wrap'

const LEGACY_SHAKO_VISUAL = /^\/import-assets\/shako-light-wrap\/operation-\d+\.png$/

/**
 * The first bundled Shako import treated the three drilling bits as one Tool.
 * These IDs are deliberately stable: old saved boards already contain the
 * combined-tool ID, so we reuse it for the first separated bit rather than
 * deleting a node that may have acquired notes, a Visual, or other links.
 */
const LEGACY_SHAKO_DRILL_BITS_TOOL_ID = 'osa:shako-light-wrap:tool-bits-5-16-1-8-7-64'
const LEGACY_SHAKO_CONNECTOR_BOX_DRILL_ID = 'osa:shako-light-wrap:operation-01'
const LEGACY_SHAKO_DRILL_BITS_NAME = 'Bits: 5/16”, 1/8”, 7/64”'

const SHAKO_DRILL_BIT_TOOLS = [
  {
    id: LEGACY_SHAKO_DRILL_BITS_TOOL_ID,
    name: '5/16 in bit',
    xOffset: 0,
  },
  {
    id: 'osa:shako-light-wrap:tool-bit-1-8',
    name: '1/8 in bit',
    xOffset: 220,
  },
  {
    id: 'osa:shako-light-wrap:tool-bit-7-64',
    name: '7/64 in bit',
    xOffset: 440,
  },
] as const

function isToolNode(node: TextFlowNode | undefined) {
  if (!node) return false
  return node.data.kind === 'tool' || osaRole(node) === 'tool'
}

function splitNodeId(preferredId: string, nodeIds: Set<string>) {
  if (!nodeIds.has(preferredId)) return preferredId

  let attempt = 2
  let candidate = `${preferredId}:legacy-split`
  while (nodeIds.has(candidate)) {
    candidate = `${preferredId}:legacy-split-${attempt}`
    attempt += 1
  }
  return candidate
}

function splitEdgeId(preferredId: string, edgeIds: Set<string>) {
  if (!edgeIds.has(preferredId)) return preferredId

  let attempt = 2
  let candidate = `${preferredId}:legacy-split`
  while (edgeIds.has(candidate)) {
    candidate = `${preferredId}:legacy-split-${attempt}`
    attempt += 1
  }
  return candidate
}

/**
 * Parses the bundled Shako data through the same validation and planning path
 * as a project package selected through OSA's normal import control.
 */
export function createShakoLightWrapImportPlan() {
  return planOsaImport(
    parseOsaImportPackage(JSON.parse(shakoLightWrapRaw) as unknown),
  )
}

/**
 * Safely upgrades exactly the original Shako Connector Box Drill bit Tool.
 *
 * This is intentionally narrower than a title-based global cleanup. It only
 * runs when the imported operation and its exact one combined Bits Tool are
 * both present and connected by one `operation-tool` edge. The legacy node
 * becomes the 5/16 in bit, preserving all of its durable data and unrelated
 * edges. The two remaining bit Tools inherit its durable source information
 * and receive their own `operation-tool` relationship. Re-running it is a
 * no-op, so local drafts cannot accumulate duplicate nodes or edges.
 */
export function migrateLegacyShakoDrillBits(
  currentNodes: TextFlowNode[],
  currentEdges: GraphEdge[],
) {
  const operation = currentNodes.find((node) => (
    node.id === LEGACY_SHAKO_CONNECTOR_BOX_DRILL_ID
    && node.data.kind === 'action'
  ))
  const legacyTool = currentNodes.find((node) => (
    node.id === LEGACY_SHAKO_DRILL_BITS_TOOL_ID
    && isToolNode(node)
    && node.data.name === LEGACY_SHAKO_DRILL_BITS_NAME
  ))
  if (!operation || !legacyTool) {
    return { nodes: currentNodes, edges: currentEdges }
  }

  const legacyToolEdges = currentEdges.filter((edge) => (
    edge.target === legacyTool.id
    && edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.operationTool
  ))
  const legacyConnectorEdge = legacyToolEdges.find((edge) => edge.source === operation.id)
  // Do not reinterpret a combined tool that someone later reused elsewhere.
  // The known old Shako data has exactly this one operation-tool link.
  if (!legacyConnectorEdge || legacyToolEdges.length !== 1) {
    return { nodes: currentNodes, edges: currentEdges }
  }

  const firstBit = SHAKO_DRILL_BIT_TOOLS[0]
  let nextNodes = currentNodes.map((node) => (
    node.id === legacyTool.id
      ? {
          ...node,
          data: {
            ...node.data,
            name: firstBit.name,
            properties: {
              ...node.data.properties,
              [OSA_PROPERTY.sourceText]: node.data.properties[OSA_PROPERTY.sourceText]
                ?? LEGACY_SHAKO_DRILL_BITS_NAME,
            },
          },
        }
      : node
  ))
  let nodesChanged = true
  let nextEdges = currentEdges
  let edgesChanged = false
  const nodeIds = new Set(nextNodes.map((node) => node.id))
  const edgeIds = new Set(currentEdges.map((edge) => edge.id))

  for (const bit of SHAKO_DRILL_BIT_TOOLS.slice(1)) {
    // A newer import may already have supplied the separated Tool. Reuse it
    // instead of creating a second object with the same meaning.
    const existingTool = nextNodes.find((node) => (
      (node.id === bit.id || (
        node.id.startsWith('osa:shako-light-wrap:')
        && node.data.name === bit.name
      ))
      && isToolNode(node)
    ))
    const toolId = existingTool?.id ?? splitNodeId(bit.id, nodeIds)

    if (!existingTool) {
      const newTool = createTextNode({
        id: toolId,
        position: {
          x: legacyTool.position.x + bit.xOffset,
          y: legacyTool.position.y,
        },
        name: bit.name,
        text: legacyTool.data.text,
        kind: 'tool',
        spaceIds: legacyTool.data.spaceIds,
        properties: {
          ...legacyTool.data.properties,
          [OSA_PROPERTY.role]: 'tool',
          [OSA_PROPERTY.sourceText]: legacyTool.data.properties[OSA_PROPERTY.sourceText]
            ?? LEGACY_SHAKO_DRILL_BITS_NAME,
        },
        sketch: legacyTool.data.sketch,
        layout: legacyTool.data.layout,
        task: legacyTool.data.task,
        notebook: legacyTool.data.notebook,
        sourcePosition: legacyTool.sourcePosition,
        targetPosition: legacyTool.targetPosition,
      })
      nextNodes = [...nextNodes, newTool]
      nodeIds.add(toolId)
      nodesChanged = true
    }

    const alreadyLinked = nextEdges.some((edge) => (
      edge.source === operation.id
      && edge.target === toolId
      && edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.operationTool
    ))
    if (alreadyLinked) continue

    const edgeId = splitEdgeId(
      `osa:shako-light-wrap:edge:operation-01-${toolId.slice('osa:shako-light-wrap:'.length)}`,
      edgeIds,
    )
    edgeIds.add(edgeId)
    nextEdges = [...nextEdges, createGraphEdge({
      id: edgeId,
      source: operation.id,
      target: toolId,
      relationship: legacyConnectorEdge.data.relationship,
      relationKind: legacyConnectorEdge.data.relationKind,
      sourceAnchor: legacyConnectorEdge.data.sourceAnchor,
      properties: legacyConnectorEdge.data.properties,
    })]
    edgesChanged = true
  }

  return {
    nodes: nodesChanged ? nextNodes : currentNodes,
    edges: edgesChanged ? nextEdges : currentEdges,
  }
}

/**
 * Updates only OSA's old bundled Shako image references when Julia reopens the
 * starter. A person-selected upload or drawing is never replaced.
 */
export function refreshBundledShakoSlideReferences(
  currentNodes: TextFlowNode[],
  plan: OsaImportPlan,
) {
  const importedNodes = new Map(plan.nodes.map((node) => [node.id, node]))
  let changed = false
  const refreshedNodes = currentNodes.map((node) => {
    if (!node.id.startsWith('osa:shako-light-wrap:')) return node
    const importedNode = importedNodes.get(node.id)
    const importedName = importedNode?.data.name ?? ''
    const currentVisual = node.data.properties[OSA_PROPERTY.instructionVisual]
    const bundledSlide = importedNode?.data.properties[OSA_PROPERTY.instructionVisual]
    const importedText = importedNode?.data.text.trim() ?? ''
    const currentText = node.data.text.trim()
    // The original deck has empty Steps blocks. A previous starter version
    // accidentally copied the card title into that empty field. Clear only
    // that exact bundled duplication—not text someone has actually authored.
    const duplicateBundledStepTitle = importedNode?.data.kind === 'action'
      && !importedText
      && Boolean(currentText)
      && (currentText === node.data.name.trim() || currentText === importedNode.data.name.trim())
    // The source slide is its own Visual. Keep its generated title short so
    // the card does not repeat the instruction title beside the image.
    const oldGeneratedSourceVisualName = / — Source Slide$/.test(node.data.name)
      && importedName === 'source slide'

    // Do not turn an older saved image URL into a visual-node ID unless that
    // node already lives in this draft. A full import/merge can add the
    // source Visual and relation later; until then, preserving the working
    // legacy URL is safer than creating a broken image reference.
    const draftHasBundledVisual = currentNodes.some((candidate) => candidate.id === bundledSlide)
    const shouldRefreshSlideReference = (
      Boolean(currentVisual)
      && Boolean(bundledSlide)
      && draftHasBundledVisual
      && LEGACY_SHAKO_VISUAL.test(currentVisual)
    )
    if (!shouldRefreshSlideReference && !duplicateBundledStepTitle && !oldGeneratedSourceVisualName) {
      return node
    }

    changed = true
    return {
      ...node,
      data: {
        ...node.data,
        ...(duplicateBundledStepTitle ? { text: '' } : {}),
        ...(oldGeneratedSourceVisualName ? { name: importedName } : {}),
        properties: shouldRefreshSlideReference ? {
          ...node.data.properties,
          [OSA_PROPERTY.instructionVisual]: bundledSlide ?? '',
          [OSA_PROPERTY.instructionVisualAlt]: importedNode?.data.properties[
            OSA_PROPERTY.instructionVisualAlt
          ] ?? '',
        } : node.data.properties,
      },
    }
  })

  return changed ? refreshedNodes : currentNodes
}

/** All Shako-specific behavior exposed through OSA's generic starter contract. */
export const shakoLightWrapStarter = {
  id: 'shako-light-wrap',
  name: SHAKO_LIGHT_WRAP_STARTER_NAME,
  openActionLabel: 'open Shako Light Wrap starter',
  compactOpenActionLabel: 'open Shako starter',
  createImportPlan: createShakoLightWrapImportPlan,
  refreshImportedNodes: refreshBundledShakoSlideReferences,
  migrateLegacyGraph: migrateLegacyShakoDrillBits,
} satisfies OsaStarter
