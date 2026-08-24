import { RELATION_KINDS, createGraphEdge, type GraphEdge } from './graphEdge'
import { NODE_KINDS, type NodeKind } from './nodeKinds'
import {
  OSA_PROPERTY,
  OSA_RELATION,
  normalizeCurrencyCode,
  osaRole,
  type OsaRole,
} from './osaData'
import { createTextNode, type TextFlowNode } from './textNode'

export type OsaImportSource = {
  id: string
  kind: 'pptx' | 'xlsx'
  fileName: string
  sha256: string
}

export type OsaImportNode = {
  id: string
  kind: NodeKind
  name: string
  text: string
  spaceIds: string[]
  properties: Record<string, string>
}

export type OsaImportEdge = {
  id: string
  source: string
  target: string
  relationKind: GraphEdge['data']['relationKind']
  relationship: string
  properties: Record<string, string>
}

/** Compact, additive data package. It deliberately omits canvas-only state. */
export type OsaImportPackage = {
  format: 'osa-import'
  version: 1
  id: string
  name: string
  sources: OsaImportSource[]
  nodes: OsaImportNode[]
  edges: OsaImportEdge[]
}

export type OsaImportPlan = {
  packageId: string
  name: string
  nodes: TextFlowNode[]
  edges: GraphEdge[]
  /** Space to open after import; the package remains ordinary OSA data. */
  spaceNodeId: string | null
  assemblyNodeId: string | null
}

export type OsaImportMergeResult = {
  nodes: TextFlowNode[]
  edges: GraphEdge[]
  addedNodeCount: number
  addedEdgeCount: number
}

const ROLE_KINDS: Record<OsaRole, readonly NodeKind[]> = {
  // Assemblies are composed parts. `project` remains accepted so older saved
  // boards and imports can still be read without a migration.
  assembly: ['part', 'project'],
  operation: ['action'],
  'bom-item': ['part'],
  feature: ['feature'],
  tool: ['tool'],
  expense: ['expense'],
  // `source-file` is the existing graph kind used by generated source nodes;
  // `document` supports source records created directly in OSA.
  source: ['document', 'source-file'],
  // A visual is a first-class, reusable graph object. A `document` remains a
  // useful legacy/container kind, while new visual records use `visual`.
  visual: ['document', 'visual'],
}

const NONNEGATIVE_DECIMAL_PROPERTIES = [
  OSA_PROPERTY.itemQuantity,
  OSA_PROPERTY.itemPackageQuantity,
  OSA_PROPERTY.itemPackagePrice,
  OSA_PROPERTY.itemPurchasedQuantity,
  OSA_PROPERTY.itemReportedCost,
  OSA_PROPERTY.expenseQuantity,
  OSA_PROPERTY.expenseUnitCost,
] as const

type RelationRoles = (typeof OSA_RELATION)[keyof typeof OSA_RELATION]

/**
 * Structured relationship roles remain strict about their source and target
 * types. Each side is a list because a Parts In/Parts Out link may point to a
 * single part or to an assembly that is itself used as a component.
 */
type RelationEndpointRoles = readonly [readonly OsaRole[], readonly OsaRole[]]

const RELATION_ENDPOINT_ROLES: Record<RelationRoles, RelationEndpointRoles> = {
  [OSA_RELATION.assemblyOperation]: [['assembly'], ['operation']],
  // An assembly can contain a purchased/derived part or another assembly.
  [OSA_RELATION.assemblyItem]: [['assembly'], ['bom-item', 'assembly']],
  [OSA_RELATION.assemblyExpense]: [['assembly'], ['expense']],
  [OSA_RELATION.assemblySource]: [['assembly'], ['source']],
  [OSA_RELATION.operationTool]: [['operation'], ['tool']],
  [OSA_RELATION.operationItem]: [['operation'], ['bom-item']],
  [OSA_RELATION.operationInput]: [['operation'], ['bom-item', 'assembly']],
  [OSA_RELATION.operationOutput]: [['operation'], ['bom-item', 'assembly']],
  [OSA_RELATION.operationPrimaryOutput]: [['operation'], ['bom-item', 'assembly']],
  // The project object owns the canonical Visual canvas/content. A card may
  // subsequently place that Visual through `operation-visual`, but it does
  // not become the owner merely by displaying it.
  [OSA_RELATION.objectVisual]: [['bom-item', 'assembly', 'tool'], ['visual']],
  // An operation card can explicitly place a first-class visual in a canvas
  // section. Existing boards that directly target a part, assembly, or tool
  // remain readable while they are migrated to visual nodes.
  [OSA_RELATION.operationVisual]: [['operation'], ['visual', 'bom-item', 'assembly', 'tool']],
  // The source visual is a separate record from a card's later visual
  // placements. This permits one source slide to remain authoritative while
  // also being placed as an ordinary image box in a user-created canvas.
  [OSA_RELATION.operationSourceVisual]: [['operation'], ['visual']],
  // A canvas may place an immutable image asset or another editable canvas.
  // Its edge carries only the child placement; neither side copies content.
  [OSA_RELATION.visualEmbed]: [['visual'], ['visual']],
  // Today a component is represented by the existing `bom-item` role. A
  // future component role can be added here without changing feature nodes.
  [OSA_RELATION.componentFeature]: [['bom-item'], ['feature']],
  [OSA_RELATION.operationFeature]: [['operation'], ['feature']],
  [OSA_RELATION.toolExpense]: [['tool'], ['expense']],
}

/**
 * A person can create an ordinary Part before assigning its more specific OSA
 * role. Permit that one safe pre-classification state to own a Visual while
 * keeping the target strictly a canonical Visual node.
 */
function canImportNodeOwnVisual(node: OsaImportNode) {
  const role = importNodeRole(node)
  return node.kind === 'part'
    || role === 'bom-item'
    || role === 'assembly'
    || role === 'tool'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function stringRecord(value: unknown, path: string) {
  if (!isRecord(value) || !Object.values(value).every((item) => typeof item === 'string')) {
    throw new Error(`${path} must contain only text values.`)
  }
  return { ...value } as Record<string, string>
}

function requiredString(value: unknown, path: string) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${path} must be non-empty text.`)
  }
  return value
}

function hasOwn(object: object, key: PropertyKey) {
  return Object.prototype.hasOwnProperty.call(object, key)
}

function isDecimal(value: string, allowZero: boolean) {
  const trimmed = value.trim()
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(trimmed)) return false
  const number = Number(trimmed)
  return Number.isFinite(number) && (allowZero ? number >= 0 : number > 0)
}

/**
 * A nested Visual is positioned by edge data, not copied into its parent.
 * Imports must therefore carry a complete, drawable placement. Keeping this
 * check at the import boundary prevents an invalid coordinate from becoming
 * durable graph state that every visual view would then need to defend
 * against.
 */
function validateVisualEmbedGeometry(properties: Record<string, string>, path: string) {
  const geometry = [
    [OSA_PROPERTY.visualEmbedX, true],
    [OSA_PROPERTY.visualEmbedY, true],
    [OSA_PROPERTY.visualEmbedWidth, false],
    [OSA_PROPERTY.visualEmbedHeight, false],
  ] as const

  for (const [propertyName, allowZero] of geometry) {
    const propertyValue = properties[propertyName]
    if (propertyValue === undefined || !isDecimal(propertyValue, allowZero)) {
      const constraint = allowZero ? 'a finite nonnegative decimal' : 'a finite positive decimal'
      throw new Error(`${path}.${propertyName} must be ${constraint}.`)
    }
  }

  const aspectRatioLocked = properties[OSA_PROPERTY.visualEmbedAspectRatioLocked]
  if (aspectRatioLocked !== undefined && aspectRatioLocked !== 'true' && aspectRatioLocked !== 'false') {
    throw new Error(`${path}.${OSA_PROPERTY.visualEmbedAspectRatioLocked} must be true or false.`)
  }
}

function validateManagedNodeProperties(
  kind: NodeKind,
  properties: Record<string, string>,
  path: string,
) {
  const roleValue = properties[OSA_PROPERTY.role]
  if (roleValue !== undefined) {
    if (!hasOwn(ROLE_KINDS, roleValue)) {
      throw new Error(`${path}.${OSA_PROPERTY.role} is not a recognized OSA role.`)
    }
    const role = roleValue as OsaRole
    if (!ROLE_KINDS[role].includes(kind)) {
      throw new Error(`${path}.${OSA_PROPERTY.role} is incompatible with node kind ${kind}.`)
    }
  }

  for (const propertyName of NONNEGATIVE_DECIMAL_PROPERTIES) {
    const propertyValue = properties[propertyName]
    if (propertyValue !== undefined && propertyValue.trim() !== '' && !isDecimal(propertyValue, true)) {
      throw new Error(`${path}.${propertyName} must be blank or a finite nonnegative decimal.`)
    }
  }

  const order = properties[OSA_PROPERTY.order]
  if (order !== undefined && order.trim() !== '' && !isDecimal(order, false)) {
    throw new Error(`${path}.${OSA_PROPERTY.order} must be blank or a positive finite decimal.`)
  }

  const currency = properties[OSA_PROPERTY.currency]
  if (currency !== undefined) {
    const normalizedCurrency = normalizeCurrencyCode(currency)
    if (!normalizedCurrency) {
      throw new Error(`${path}.${OSA_PROPERTY.currency} must be a usable three-letter currency code.`)
    }
    properties[OSA_PROPERTY.currency] = normalizedCurrency
  }
}

function importNodeRole(node: OsaImportNode) {
  const role = node.properties[OSA_PROPERTY.role]
  return role && hasOwn(ROLE_KINDS, role) ? role as OsaRole : null
}

function validateManagedEdgeProperties(
  edge: OsaImportEdge,
  sourceNode: OsaImportNode,
  targetNode: OsaImportNode,
  path: string,
) {
  const relationRole = edge.properties[OSA_PROPERTY.relationRole]
  if (relationRole === undefined) return
  if (!hasOwn(RELATION_ENDPOINT_ROLES, relationRole)) {
    throw new Error(`${path}.${OSA_PROPERTY.relationRole} is not a recognized OSA relation.`)
  }

  const sourceRole = importNodeRole(sourceNode)
  const targetRole = importNodeRole(targetNode)
  if (relationRole === OSA_RELATION.objectVisual) {
    if (!canImportNodeOwnVisual(sourceNode) || targetRole !== 'visual') {
      throw new Error(`${path}.${OSA_PROPERTY.relationRole} has incompatible endpoint roles.`)
    }
    return
  }

  const [expectedSourceRoles, expectedTargetRoles] = RELATION_ENDPOINT_ROLES[relationRole as RelationRoles]
  if (
    sourceRole === null
    || targetRole === null
    || !expectedSourceRoles.includes(sourceRole)
    || !expectedTargetRoles.includes(targetRole)
  ) {
    throw new Error(`${path}.${OSA_PROPERTY.relationRole} has incompatible endpoint roles.`)
  }

  if (relationRole === OSA_RELATION.visualEmbed) {
    validateVisualEmbedGeometry(edge.properties, path)
  }
}

/** An operation card can designate one, not several, primary represented part. */
function validateOperationPrimaryOutputs(edges: OsaImportEdge[]) {
  const primaryOutputCounts = new Map<string, number>()
  for (const edge of edges) {
    if (edge.properties[OSA_PROPERTY.relationRole] !== OSA_RELATION.operationPrimaryOutput) continue
    const count = (primaryOutputCounts.get(edge.source) ?? 0) + 1
    if (count > 1) {
      throw new Error(`Operation ${edge.source} has more than one primary output.`)
    }
    primaryOutputCounts.set(edge.source, count)
  }
}

/**
 * A canonical Visual may be placed in many cards, but it has at most one
 * project-object owner. This keeps its content location unambiguous while
 * still allowing unowned Visuals such as imported source slides or a newly
 * created blank canvas.
 */
function validateObjectVisualOwnership(edges: OsaImportEdge[]) {
  const ownersByVisualId = new Map<string, string>()
  for (const edge of edges) {
    if (edge.properties[OSA_PROPERTY.relationRole] !== OSA_RELATION.objectVisual) continue
    const existingOwnerId = ownersByVisualId.get(edge.target)
    if (existingOwnerId !== undefined) {
      throw new Error(`Visual ${edge.target} has more than one owning object.`)
    }
    ownersByVisualId.set(edge.target, edge.source)
  }
}

/** Validates untrusted JSON before any imported object reaches live state. */
export function parseOsaImportPackage(value: unknown): OsaImportPackage {
  if (!isRecord(value) || value.format !== 'osa-import' || value.version !== 1) {
    throw new Error('This is not an OSA data import file.')
  }

  const id = requiredString(value.id, 'id')
  const name = requiredString(value.name, 'name')
  if (!Array.isArray(value.sources) || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) {
    throw new Error('The import must contain sources, nodes, and edges.')
  }

  const sources = value.sources.map((source, index): OsaImportSource => {
    if (!isRecord(source) || (source.kind !== 'pptx' && source.kind !== 'xlsx')) {
      throw new Error(`sources[${index}] has an unsupported source kind.`)
    }
    return {
      id: requiredString(source.id, `sources[${index}].id`),
      kind: source.kind,
      fileName: requiredString(source.fileName, `sources[${index}].fileName`),
      sha256: requiredString(source.sha256, `sources[${index}].sha256`),
    }
  })

  const nodes = value.nodes.map((node, index): OsaImportNode => {
    if (!isRecord(node)) throw new Error(`nodes[${index}] must be an object.`)
    const kind = requiredString(node.kind, `nodes[${index}].kind`)
    if (!NODE_KINDS.some((candidate) => candidate.id === kind)) {
      throw new Error(`nodes[${index}].kind is not an OSA node type.`)
    }
    if (!Array.isArray(node.spaceIds) || !node.spaceIds.every((spaceId) => typeof spaceId === 'string')) {
      throw new Error(`nodes[${index}].spaceIds must be a text list.`)
    }
    const properties = stringRecord(node.properties, `nodes[${index}].properties`)
    validateManagedNodeProperties(kind as NodeKind, properties, `nodes[${index}].properties`)
    return {
      id: requiredString(node.id, `nodes[${index}].id`),
      kind: kind as NodeKind,
      name: typeof node.name === 'string' ? node.name : '',
      text: typeof node.text === 'string' ? node.text : '',
      spaceIds: [...node.spaceIds],
      properties,
    }
  })

  const nodeIds = new Set(nodes.map((node) => node.id))
  if (nodeIds.size !== nodes.length) throw new Error('Imported node IDs must be unique.')
  const spaceIds = new Set(nodes.filter((node) => node.kind === 'space').map((node) => node.id))
  if (nodes.some((node) => node.spaceIds.some((spaceId) => !spaceIds.has(spaceId)))) {
    throw new Error('An imported node refers to a Space that is not in this import.')
  }

  const edges = value.edges.map((edge, index): OsaImportEdge => {
    if (!isRecord(edge)) throw new Error(`edges[${index}] must be an object.`)
    const relationKind = requiredString(edge.relationKind, `edges[${index}].relationKind`)
    if (!RELATION_KINDS.includes(relationKind as GraphEdge['data']['relationKind'])) {
      throw new Error(`edges[${index}].relationKind is not supported.`)
    }
    const source = requiredString(edge.source, `edges[${index}].source`)
    const target = requiredString(edge.target, `edges[${index}].target`)
    if (!nodeIds.has(source) || !nodeIds.has(target)) {
      throw new Error(`edges[${index}] refers to a node outside this import.`)
    }
    return {
      id: requiredString(edge.id, `edges[${index}].id`),
      source,
      target,
      relationKind: relationKind as GraphEdge['data']['relationKind'],
      relationship: typeof edge.relationship === 'string' ? edge.relationship : 'relates to',
      properties: stringRecord(edge.properties, `edges[${index}].properties`),
    }
  })

  const edgeIds = new Set(edges.map((edge) => edge.id))
  if (edgeIds.size !== edges.length) throw new Error('Imported edge IDs must be unique.')
  const nodesById = new Map(nodes.map((node) => [node.id, node]))
  if (edges.some((edge) => {
    if (edge.relationKind !== 'project-task') return false
    const sourceNode = nodesById.get(edge.source)
    const targetNode = nodesById.get(edge.target)
    return targetNode?.kind !== 'action'
      || (sourceNode?.kind !== 'project' && importNodeRole(sourceNode!) !== 'assembly')
  })) {
    throw new Error('An imported project-action relationship has incompatible node types.')
  }
  edges.forEach((edge, index) => validateManagedEdgeProperties(
    edge,
    nodesById.get(edge.source)!,
    nodesById.get(edge.target)!,
    `edges[${index}].properties`,
  ))
  validateOperationPrimaryOutputs(edges)
  validateObjectVisualOwnership(edges)

  return { format: 'osa-import', version: 1, id, name, sources, nodes, edges }
}

function importedPosition(node: OsaImportNode, roleIndex: number) {
  const role = node.properties[OSA_PROPERTY.role] ?? ''
  if (node.kind === 'space') return { x: 0, y: 20 }
  const lanes: Record<string, { x: number; y: number; columns: number }> = {
    assembly: { x: 160, y: 80, columns: 1 },
    operation: { x: 420, y: 80, columns: 2 },
    'bom-item': { x: 900, y: 80, columns: 3 },
    feature: { x: 900, y: 500, columns: 3 },
    tool: { x: 1580, y: 80, columns: 2 },
    expense: { x: 2020, y: 80, columns: 3 },
    source: { x: 160, y: 440, columns: 2 },
  }
  const lane = lanes[role] ?? { x: 900, y: 80, columns: 3 }
  return {
    x: lane.x + (roleIndex % lane.columns) * 220,
    y: lane.y + Math.floor(roleIndex / lane.columns) * 190,
  }
}

/** Turns package-local objects into ordinary, saveable OSA nodes and edges. */
export function planOsaImport(importPackage: OsaImportPackage): OsaImportPlan {
  const prefix = `osa:${encodeURIComponent(importPackage.id)}:`
  const idMap = new Map(importPackage.nodes.map((node) => [node.id, `${prefix}${node.id}`]))
  const roleCounts = new Map<string, number>()

  const nodes = importPackage.nodes.map((node) => {
    const role = node.properties[OSA_PROPERTY.role] ?? ''
    const roleIndex = roleCounts.get(role) ?? 0
    roleCounts.set(role, roleIndex + 1)
    // A package can use its compact local source-visual ID as a compatibility
    // locator. Once planned, every graph object has a namespaced durable ID,
    // so rewrite only known local node references. Older image URLs remain
    // unchanged and continue to render as a fallback.
    const properties = { ...node.properties }
    const sourceVisualReference = properties[OSA_PROPERTY.instructionVisual]
    if (sourceVisualReference && idMap.has(sourceVisualReference)) {
      properties[OSA_PROPERTY.instructionVisual] = idMap.get(sourceVisualReference)!
    }
    return createTextNode({
      id: idMap.get(node.id)!,
      position: importedPosition(node, roleIndex),
      name: node.name,
      text: node.text,
      kind: node.kind,
      spaceIds: node.spaceIds.map((spaceId) => idMap.get(spaceId)!),
      properties,
    })
  })

  const edges = importPackage.edges.map((edge) => createGraphEdge({
    id: `${prefix}edge:${edge.id}`,
    source: idMap.get(edge.source)!,
    target: idMap.get(edge.target)!,
    relationKind: edge.relationKind,
    relationship: edge.relationship,
    properties: edge.properties,
  }))

  return {
    packageId: importPackage.id,
    name: importPackage.name,
    nodes,
    edges,
    spaceNodeId: nodes.find((node) => node.data.kind === 'space')?.id ?? null,
    assemblyNodeId: nodes.find((node) => osaRole(node) === 'assembly')?.id
      ?? nodes.find((node) => (
        node.data.kind === 'project'
        && edges.some((edge) => edge.source === node.id && edge.data.relationKind === 'project-task')
      ))?.id
      ?? nodes.find((node) => node.data.kind === 'project')?.id
      ?? null,
  }
}

/** Additively merges one plan by stable IDs without mutating either input. */
export function mergeOsaImportPlan(
  currentNodes: TextFlowNode[],
  currentEdges: GraphEdge[],
  plan: OsaImportPlan,
): OsaImportMergeResult {
  const importedNodesById = new Map(plan.nodes.map((node) => [node.id, node]))
  // Re-imports may add newly supported fields (for example, a visual recovered
  // from a source document). Fill only properties that do not exist yet so a
  // converter update never overwrites work already edited in OSA.
  const hydratedCurrentNodes = currentNodes.map((node) => {
    const importedNode = importedNodesById.get(node.id)
    if (!importedNode) return node
    const missingProperties = Object.fromEntries(
      Object.entries(importedNode.data.properties)
        .filter(([propertyName]) => !(propertyName in node.data.properties)),
    )
    return Object.keys(missingProperties).length === 0
      ? node
      : {
          ...node,
          data: {
            ...node.data,
            properties: { ...missingProperties, ...node.data.properties },
          },
        }
  })
  const nodeIds = new Set(currentNodes.map((node) => node.id))
  const addedNodes: TextFlowNode[] = []
  for (const node of plan.nodes) {
    if (nodeIds.has(node.id)) continue
    nodeIds.add(node.id)
    addedNodes.push(node)
  }

  const edgeIds = new Set(currentEdges.map((edge) => edge.id))
  const addedEdges: GraphEdge[] = []
  for (const edge of plan.edges) {
    if (
      edgeIds.has(edge.id)
      || !nodeIds.has(edge.source)
      || !nodeIds.has(edge.target)
    ) continue
    edgeIds.add(edge.id)
    addedEdges.push(edge)
  }

  return {
    nodes: addedNodes.length ? [...hydratedCurrentNodes, ...addedNodes] : hydratedCurrentNodes,
    edges: addedEdges.length ? [...currentEdges, ...addedEdges] : currentEdges,
    addedNodeCount: addedNodes.length,
    addedEdgeCount: addedEdges.length,
  }
}
