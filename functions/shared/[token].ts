type Env = { OSA_DB: D1Database }

type SharedBoardRow = {
  content: string
  assembly_id: string
}

type JsonRecord = Record<string, unknown>

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null
}

function nodeProperties(node: JsonRecord) {
  const data = node.data
  return isRecord(data) && isRecord(data.properties) ? data.properties : null
}

function nodeKind(node: JsonRecord) {
  const data = node.data
  return isRecord(data) && typeof data.kind === 'string' ? data.kind : null
}

function edgeData(edge: JsonRecord) {
  return isRecord(edge.data) ? edge.data : null
}

function edgeRelation(edge: JsonRecord) {
  const properties = edgeData(edge)?.properties
  return isRecord(properties) && typeof properties['osa:relation'] === 'string'
    ? properties['osa:relation']
    : null
}

function edgeRelationKind(edge: JsonRecord) {
  const relationKind = edgeData(edge)?.relationKind
  return typeof relationKind === 'string' ? relationKind : null
}

function isOperationTargetEdge(edge: JsonRecord, nodesById: Map<string, JsonRecord>) {
  const relation = edgeRelation(edge)
  if (relation === 'operation-item' || relation === 'operation-tool') return true

  const target = typeof edge.target === 'string' ? nodesById.get(edge.target) : undefined
  if (!target) return false

  const role = nodeProperties(target)?.['osa:role']
  return role === 'bom-item' || role === 'tool' || nodeKind(target) === 'part' || nodeKind(target) === 'tool'
}

function isAssemblyTargetEdge(edge: JsonRecord, nodesById: Map<string, JsonRecord>) {
  const relation = edgeRelation(edge)
  if (relation === 'assembly-item' || relation === 'assembly-expense' || relation === 'assembly-source') {
    return true
  }

  const target = typeof edge.target === 'string' ? nodesById.get(edge.target) : undefined
  if (target) {
    const role = nodeProperties(target)?.['osa:role']
    if (
      role === 'bom-item'
      || role === 'expense'
      || role === 'source'
      || nodeKind(target) === 'part'
      || nodeKind(target) === 'expense'
    ) return true
  }

  // Match the same ordinary wording fallback used by the Assembly projection
  // for boards made before structured OSA relations existed.
  const relationship = edgeData(edge)?.relationship
  return typeof relationship === 'string' && /\b(part|parts|material|materials|component|components|expense|expenses|cost|costs|purchase|purchases|source|sources|reference|references)\b|comes from/i.test(relationship)
}

/**
 * Derives the smallest useful assembly packet from a saved board. A public
 * recipient receives the assembly, its direct BOM/expense/source context,
 * its operations and their parts/tools, and visual-node references -- never
 * unrelated board data.
 */
function createAssemblyScopedBoard(board: unknown, assemblyId: string): JsonRecord | null {
  if (!isRecord(board) || typeof board.id !== 'string' || typeof board.name !== 'string' || typeof board.updatedAt !== 'string') {
    return null
  }
  const snapshot = board.snapshot
  if (!isRecord(snapshot) || !Array.isArray(snapshot.nodes) || !Array.isArray(snapshot.edges)) return null

  const nodes = snapshot.nodes.filter((node): node is JsonRecord => isRecord(node) && typeof node.id === 'string')
  const edges = snapshot.edges.filter((edge): edge is JsonRecord => (
    isRecord(edge) && typeof edge.source === 'string' && typeof edge.target === 'string'
  ))
  const nodesById = new Map(nodes.map((node) => [node.id as string, node]))
  const assembly = nodesById.get(assemblyId)
  if (!assembly) return null

  const assemblyRole = nodeProperties(assembly)?.['osa:role']
  if (assemblyRole !== 'assembly' && nodeKind(assembly) !== 'project') return null

  const includedNodeIds = new Set([assemblyId])
  const operationIds = new Set<string>()

  // Assembly -> operation links have a durable structured relation. Retain a
  // project-task fallback so boards created before that relation existed work.
  for (const edge of edges) {
    if (edge.source !== assemblyId) continue
    if (edgeRelation(edge) !== 'assembly-operation' && edgeRelationKind(edge) !== 'project-task') continue
    if (!nodesById.has(edge.target as string)) continue
    const operationId = edge.target as string
    includedNodeIds.add(operationId)
    operationIds.add(operationId)
  }

  for (const edge of edges) {
    if (edge.source !== assemblyId || !isAssemblyTargetEdge(edge, nodesById)) continue
    if (nodesById.has(edge.target as string)) includedNodeIds.add(edge.target as string)
  }

  for (const operationId of operationIds) {
    for (const edge of edges) {
      if (edge.source !== operationId || !isOperationTargetEdge(edge, nodesById)) continue
      if (nodesById.has(edge.target as string)) includedNodeIds.add(edge.target as string)
    }
  }

  // Most instruction visuals are asset paths. A visual can instead point at
  // another graph object; preserve that object only when it is a real node id.
  for (const includedNodeId of includedNodeIds) {
    const includedNode = nodesById.get(includedNodeId)
    const visual = includedNode ? nodeProperties(includedNode)?.['instruction:visual'] : null
    if (typeof visual === 'string' && nodesById.has(visual)) includedNodeIds.add(visual)
  }

  return {
    ...board,
    snapshot: {
      ...snapshot,
      nodes: nodes.filter((node) => includedNodeIds.has(node.id as string)),
      // This deliberately prevents an edge from revealing an out-of-scope node.
      edges: edges.filter((edge) => (
        includedNodeIds.has(edge.source as string) && includedNodeIds.has(edge.target as string)
      )),
    },
  }
}

/**
 * This route is intentionally outside `/api`, so the private Access middleware
 * does not intercept a recipient opening an opaque, read-only share link.
 */
export const onRequestGet: PagesFunction<Env> = async ({ env, params }) => {
  const token = params.token
  if (!token) return json({ error: 'A share token is required.' }, 400)

  const sharedBoard = await env.OSA_DB
    .prepare(`
      SELECT boards.content, board_shares.assembly_id
      FROM board_shares
      INNER JOIN boards ON boards.id = board_shares.board_id
      WHERE board_shares.token = ?
    `)
    .bind(token)
    .first<SharedBoardRow>()
  if (!sharedBoard) return json({ error: 'This shared assembly is unavailable.' }, 404)

  try {
    const board = createAssemblyScopedBoard(JSON.parse(sharedBoard.content), sharedBoard.assembly_id)
    if (!board) return json({ error: 'This shared assembly is unavailable.' }, 404)
    return json({ board, assemblyId: sharedBoard.assembly_id })
  } catch {
    // Corrupt saved content should not expose an implementation error to a
    // recipient who only has a read-only link.
    return json({ error: 'This shared assembly is unavailable.' }, 404)
  }
}
