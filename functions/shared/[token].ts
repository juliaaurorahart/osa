import {
  FILE_ID, findStoredFile, hasLegacyFileGrant, LEGACY_IMAGE_KEY, legacyFileDetails, managedFileReference,
  referencedFiles, storedFileResponse, type FileEnv,
} from '../assetFiles'

type Env = FileEnv

type SharedBoardRow = {
  board_id: string
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

function isCanonicalVisual(node: JsonRecord | undefined) {
  return Boolean(node && (
    nodeProperties(node)?.['osa:role'] === 'visual'
    || nodeKind(node) === 'visual'
  ))
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

function edgeProperties(edge: JsonRecord) {
  const properties = edgeData(edge)?.properties
  return isRecord(properties) ? properties : null
}

function edgeRelationKind(edge: JsonRecord) {
  const relationKind = edgeData(edge)?.relationKind
  return typeof relationKind === 'string' ? relationKind : null
}

function isOperationTargetEdge(edge: JsonRecord, nodesById: Map<string, JsonRecord>) {
  const relation = edgeRelation(edge)
  const target = typeof edge.target === 'string' ? nodesById.get(edge.target) : undefined
  // Canonical instruction Visuals pass through the publication rules below.
  // Legacy operation-visual links to Parts and Tools keep their existing
  // operation-context behavior.
  if (
    relation === 'operation-visual'
    && isCanonicalVisual(target)
  ) return false
  if (
    relation === 'operation-item'
    || relation === 'operation-input'
    || relation === 'operation-output'
    || relation === 'operation-primary-output'
    || relation === 'operation-tool'
    || relation === 'operation-step'
  ) return true

  if (!target) return false

  const role = nodeProperties(target)?.['osa:role']
  return role === 'bom-item' || role === 'tool' || nodeKind(target) === 'part' || nodeKind(target) === 'tool'
}

function isSharedInstructionVisualPublished(
  edge: JsonRecord,
  nodesById: Map<string, JsonRecord>,
): boolean {
  if (edgeRelation(edge) !== 'operation-visual' || typeof edge.target !== 'string') return false

  const target = nodesById.get(edge.target)
  if (!isCanonicalVisual(target)) return false

  const properties = edgeProperties(edge)
  const published = properties?.['operation-visual:published']
  // A present value is authoritative. Invalid values are kept private rather
  // than falling through to a permissive legacy rule.
  if (published !== undefined) return published === 'true'

  const role = properties?.['operation-visual:role']
  if (role === 'before' || role === 'after') return true
  return role === undefined
    && nodeProperties(target)?.['visual:include-in-instructions'] === 'true'
}

function isSharedLegacyStepVisualPublished(edge: JsonRecord, target: JsonRecord | undefined) {
  if (edgeRelation(edge) !== 'object-visual' || !isCanonicalVisual(target)) return false
  const published = edgeProperties(edge)?.['operation-visual:published']
  if (published !== undefined) return published === 'true'
  return nodeProperties(target)?.['visual:include-in-instructions'] === 'true'
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
export function createAssemblyScopedBoard(board: unknown, assemblyId: string): JsonRecord | null {
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
  const publishedInstructionVisualEdges = new Set<JsonRecord>()
  const publishedLegacyStepVisualEdges = new Set<JsonRecord>()
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
      if (edge.source !== operationId || !isSharedInstructionVisualPublished(edge, nodesById)) continue
      publishedInstructionVisualEdges.add(edge)
      includeNode(edge.target as string)
    }

    for (const edge of edges) {
      if (edge.source !== operationId || !isOperationTargetEdge(edge, nodesById)) continue
      if (nodesById.has(edge.target as string)) includeNode(edge.target as string)
    }
  }

  // A shared instruction receives every deliberately published Visual, not
  // only the compact-card selection. Follow embedded and official Visual
  // dependencies recursively while source slides, unassigned drafts, and
  // other design work stay outside the public packet.
  while (pendingNodeIds.length) {
    const includedNodeId = pendingNodeIds.shift()!
    const includedNode = nodesById.get(includedNodeId)
    if (!includedNode) continue

    const role = nodeProperties(includedNode)?.['osa:role']
    if (role === 'step') {
      for (const edge of edges) {
        if (edge.source === includedNodeId && edgeRelation(edge) === 'object-visual') {
          const stepCanvas = nodesById.get(edge.target as string)
          if (isSharedLegacyStepVisualPublished(edge, stepCanvas)) {
            publishedLegacyStepVisualEdges.add(edge)
            includeNode(edge.target as string)
          }
        }
      }
    }

    if (role === 'visual' || nodeKind(includedNode) === 'visual') {
      for (const edge of edges) {
        if (edge.source === includedNodeId && edgeRelation(edge) === 'visual-embed') {
          const embeddedId = edge.target as string
          if (isCanonicalVisual(nodesById.get(embeddedId))) includeNode(embeddedId)
        }
      }
      officialVisualEmbedIds(includedNode).forEach((embeddedId) => {
        if (isCanonicalVisual(nodesById.get(embeddedId))) includeNode(embeddedId)
      })
    }
  }

  return {
    ...board,
    snapshot: {
      ...snapshot,
      nodes: nodes.filter((node) => includedNodeIds.has(node.id as string)),
      // This deliberately prevents an edge from revealing an out-of-scope node.
      edges: edges.filter((edge) => {
        if (!includedNodeIds.has(edge.source as string) || !includedNodeIds.has(edge.target as string)) {
          return false
        }
        if (
          operationIds.has(edge.source as string)
          && edgeRelation(edge) === 'operation-visual'
          && isCanonicalVisual(nodesById.get(edge.target as string))
        ) return publishedInstructionVisualEdges.has(edge)
        if (
          nodeProperties(nodesById.get(edge.source as string) ?? {})?.['osa:role'] === 'step'
          && edgeRelation(edge) === 'object-visual'
          && isCanonicalVisual(nodesById.get(edge.target as string))
        ) return publishedLegacyStepVisualEdges.has(edge)
        return true
      }),
    },
  }
}

/**
 * This route is intentionally outside `/api`, so the private Access middleware
 * does not intercept a recipient opening a public, read-only share link.
 */
async function sharedAssemblyResponse(
  request: Request | undefined,
  env: Env,
  reference: string | string[] | undefined,
  includeBody: boolean,
) {
  // The dynamic filename is intentionally retained for old opaque links.
  // It now also receives a human-friendly public share name.
  if (!reference || typeof reference !== 'string') return json({ error: 'A public assembly link is required.' }, 400)
  if (!env.OSA_DB) {
    return json({ error: 'Shared assembly service is not configured.' }, 503)
  }

  try {
    const url = new URL(request?.url ?? 'https://osa.invalid/')
    const requestedAsset = url.searchParams.get('asset')
    const requestedLegacyKey = url.searchParams.get('legacyKey')
    if (requestedAsset !== null && requestedLegacyKey !== null) return json({ error: 'Choose one shared file.' }, 400)
    const sharedBoard = await env.OSA_DB
      .prepare(`
        SELECT boards.id AS board_id, boards.content, board_shares.assembly_id
        FROM board_shares
        INNER JOIN boards ON boards.id = board_shares.board_id
        WHERE board_shares.slug = ? OR board_shares.token = ?
      `)
      .bind(reference, reference)
      .first<SharedBoardRow>()
    if (!sharedBoard) return json({ error: 'This shared assembly is unavailable.' }, 404)

    const board = createAssemblyScopedBoard(JSON.parse(sharedBoard.content), sharedBoard.assembly_id)
    if (!board) return json({ error: 'This shared assembly is unavailable.' }, 404)
    const boardId = sharedBoard.board_id ?? String(board.id)
    const references = referencedFiles(board.snapshot, url.origin, boardId)

    // The share grants access only to files in this projected Assembly and
    // owned by its source board. An arbitrary ID pasted into JSON is not a grant.
    if (requestedAsset !== null) {
      if (!FILE_ID.test(requestedAsset) || !references.ids.has(requestedAsset)) {
        return json({ error: 'Shared file not found.' }, 404)
      }
      const file = await findStoredFile(env.OSA_DB, requestedAsset)
      if (!file || file.board_id !== boardId) return json({ error: 'Shared file not found.' }, 404)
      if (!env.OSA_ASSETS) return json({ error: 'File storage is not configured.' }, 503)
      return storedFileResponse(env.OSA_ASSETS, file, includeBody)
    }
    if (requestedLegacyKey !== null) {
      if (!LEGACY_IMAGE_KEY.test(requestedLegacyKey) || !references.legacyKeys.has(requestedLegacyKey)
        || !await hasLegacyFileGrant(env.OSA_DB, boardId, requestedLegacyKey)) {
        return json({ error: 'Shared file not found.' }, 404)
      }
      if (!env.OSA_ASSETS) return json({ error: 'File storage is not configured.' }, 503)
      return storedFileResponse(env.OSA_ASSETS, legacyFileDetails(requestedLegacyKey), includeBody)
    }

    const ownedIds = new Set<string>()
    const grantedLegacyKeys = new Set<string>()
    if (references.ids.size) {
      // One query per packet avoids one round trip per image on large assemblies.
      const files = await env.OSA_DB.prepare('SELECT id FROM private_assets WHERE board_id = ?')
        .bind(boardId).all<{ id: string }>()
      files.results.forEach((file) => ownedIds.add(file.id))
    }
    if (references.legacyKeys.size) {
      const grants = await env.OSA_DB.prepare('SELECT storage_key FROM legacy_asset_grants WHERE board_id = ?')
        .bind(boardId).all<{ storage_key: string }>()
      grants.results.forEach((grant) => grantedLegacyKeys.add(grant.storage_key))
    }
    const shareFileUrl = (field: 'asset' | 'legacyKey', value: string) => {
      const fileUrl = new URL(`/shared/${encodeURIComponent(reference)}`, url.origin)
      fileUrl.searchParams.set(field, value)
      return fileUrl.toString()
    }
    const rewriteFileLinks = (value: unknown): unknown => {
      if (typeof value === 'string') {
        const file = managedFileReference(value, url.origin)
        if (file?.kind === 'file') return ownedIds.has(file.id) ? shareFileUrl('asset', file.id) : ''
        if (file?.kind === 'legacy') {
          return references.legacyKeys.has(file.key) && grantedLegacyKeys.has(file.key) && (!file.boardId || file.boardId === boardId)
            ? shareFileUrl('legacyKey', file.key)
            : ''
        }
        return value
      }
      if (Array.isArray(value)) return value.map(rewriteFileLinks)
      if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rewriteFileLinks(item)]))
      return value
    }
    const response = json({ board: rewriteFileLinks(board), assemblyId: sharedBoard.assembly_id })
    return includeBody ? response : new Response(null, { status: response.status, headers: response.headers })
  } catch {
    // A schema/binding failure belongs to the service, not to the recipient's
    // link. Returning JSON avoids a raw Cloudflare 1101 page on the phone.
    return json({ error: 'Shared assembly service is temporarily unavailable.' }, 503)
  }
}

export const onRequestGet: PagesFunction<Env> = ({ request, env, params }) => (
  sharedAssemblyResponse(request, env, params.token, true)
)

export const onRequestHead: PagesFunction<Env> = ({ request, env, params }) => (
  sharedAssemblyResponse(request, env, params.token, false)
)
