type Env = { OSA_DB?: D1Database }

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
  if (
    relation === 'operation-item'
    || relation === 'operation-input'
    || relation === 'operation-output'
    || relation === 'operation-primary-output'
    || relation === 'operation-tool'
    || relation === 'operation-step'
  ) return true

  const target = typeof edge.target === 'string' ? nodesById.get(edge.target) : undefined
  if (!target) return false

  const role = nodeProperties(target)?.['osa:role']
  return role === 'bom-item' || role === 'tool' || nodeKind(target) === 'part' || nodeKind(target) === 'tool'
}

function officialVisualEmbedIds(node: JsonRecord) {
  const data = node.data
  if (!isRecord(data) || !isRecord(data.visualVersions)) return []

  const state = data.visualVersions
  const officialId = state.officialId
  const records = state.records
  if (typeof officialId !== 'string' || !Array.isArray(records)) return []

  const official = records.find((record) => (
    isRecord(record) && record.id === officialId && record.kind === 'official'
  ))
  if (!isRecord(official) || !Array.isArray(official.embeds)) return []

  return official.embeds.flatMap((embed) => (
    isRecord(embed) && typeof embed.visualId === 'string' ? [embed.visualId] : []
  ))
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
 * recipient receives the assembly, its direct BOM/expense context, its
 * operations, and the durable steps/canvases needed to carry them out --
 * never unrelated board data.
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

  const includedNodeIds = new Set<string>()
  const pendingNodeIds: string[] = []
  const includeNode = (nodeId: string) => {
    if (!nodesById.has(nodeId) || includedNodeIds.has(nodeId)) return
    includedNodeIds.add(nodeId)
    pendingNodeIds.push(nodeId)
  }
  const operationIds = new Set<string>()
  includeNode(assemblyId)

  // Assembly -> operation links have a durable structured relation. Retain a
  // project-task fallback so boards created before that relation existed work.
  for (const edge of edges) {
    if (edge.source !== assemblyId) continue
    if (edgeRelation(edge) !== 'assembly-operation' && edgeRelationKind(edge) !== 'project-task') continue
    if (!nodesById.has(edge.target as string)) continue
    const operationId = edge.target as string
    includeNode(operationId)
    operationIds.add(operationId)
  }

  for (const edge of edges) {
    if (edge.source !== assemblyId || !isAssemblyTargetEdge(edge, nodesById)) continue
    if (nodesById.has(edge.target as string)) includeNode(edge.target as string)
  }

  for (const operationId of operationIds) {
    for (const edge of edges) {
      if (edge.source !== operationId || !isOperationTargetEdge(edge, nodesById)) continue
      if (nodesById.has(edge.target as string)) includeNode(edge.target as string)
    }
  }

  // A shared instruction needs the Visual owned by each included Step, plus
  // only the Visuals embedded inside those step canvases. This walks that
  // small dependency tree without exposing every visual attached to a Part.
  while (pendingNodeIds.length) {
    const includedNodeId = pendingNodeIds.shift()!
    const includedNode = nodesById.get(includedNodeId)
    if (!includedNode) continue

    const role = nodeProperties(includedNode)?.['osa:role']
    if (role === 'step') {
      for (const edge of edges) {
        if (edge.source === includedNodeId && edgeRelation(edge) === 'object-visual') {
          includeNode(edge.target as string)
        }
      }
    }

    if (role === 'visual') {
      for (const edge of edges) {
        if (edge.source === includedNodeId && edgeRelation(edge) === 'visual-embed') {
          includeNode(edge.target as string)
        }
      }
      officialVisualEmbedIds(includedNode).forEach(includeNode)
    }
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
  if (!env.OSA_DB) {
    return json({ error: 'Shared assembly service is not configured.' }, 503)
  }

  try {
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

    const board = createAssemblyScopedBoard(JSON.parse(sharedBoard.content), sharedBoard.assembly_id)
    if (!board) return json({ error: 'This shared assembly is unavailable.' }, 404)
    return json({ board, assemblyId: sharedBoard.assembly_id })
  } catch {
    // A schema/binding failure belongs to the service, not to the recipient's
    // link. Returning JSON avoids a raw Cloudflare 1101 page on the phone.
    return json({ error: 'Shared assembly service is temporarily unavailable.' }, 503)
  }
}
