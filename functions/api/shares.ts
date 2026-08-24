type Env = { OSA_DB: D1Database }
type AccessData = { cloudflareAccess?: { JWT?: { payload?: { email?: string } } } }

type CreateShareBody = {
  boardId?: unknown
  assemblyId?: unknown
}

type OwnedBoard = { content: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Only mint a link for an Assembly that actually exists in this saved board. */
function boardContainsAssembly(content: string, assemblyId: string) {
  try {
    const parsed: unknown = JSON.parse(content)
    if (!isRecord(parsed) || !isRecord(parsed.snapshot) || !Array.isArray(parsed.snapshot.nodes)) return false

    return parsed.snapshot.nodes.some((node) => {
      if (!isRecord(node) || node.id !== assemblyId || !isRecord(node.data)) return false
      const properties = isRecord(node.data.properties) ? node.data.properties : null
      return properties?.['osa:role'] === 'assembly' || node.data.kind === 'project'
    })
  } catch {
    return false
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

function ownerEmail(data: AccessData) {
  return data.cloudflareAccess?.JWT?.payload?.email?.toLowerCase() ?? null
}

/**
 * A share token is deliberately unguessable. It is a capability: anyone with
 * the finished link can read that saved board's selected assembly, but cannot
 * write back to it.
 */
function createShareToken() {
  return `${crypto.randomUUID().replaceAll('-', '')}${crypto.randomUUID().replaceAll('-', '')}`
}

/** Creates a public, read-only link for an assembly on one of the owner's saved boards. */
export const onRequestPost: PagesFunction<Env, string, AccessData> = async ({ request, env, data }) => {
  const owner = ownerEmail(data)
  if (!owner) return json({ error: 'Private sign-in required.' }, 403)

  const body = await request.json().catch(() => null) as CreateShareBody | null
  const boardId = body?.boardId
  const assemblyId = body?.assemblyId
  if (typeof boardId !== 'string' || !boardId || typeof assemblyId !== 'string' || !assemblyId) {
    return json({ error: 'A saved board and assembly are required to create a share link.' }, 400)
  }

  // A user may only expose a board that they already own. The public route
  // below never accepts a board id directly, only the opaque token.
  const ownedBoard = await env.OSA_DB
    .prepare('SELECT content FROM boards WHERE id = ? AND owner_email = ?')
    .bind(boardId, owner)
    .first<OwnedBoard>()
  if (!ownedBoard) return json({ error: 'That saved board was not found.' }, 404)
  if (!boardContainsAssembly(ownedBoard.content, assemblyId)) {
    return json({ error: 'Choose an assembly that exists in this saved board.' }, 400)
  }

  const token = createShareToken()
  await env.OSA_DB
    .prepare('INSERT INTO board_shares (token, board_id, assembly_id) VALUES (?, ?, ?)')
    .bind(token, boardId, assemblyId)
    .run()

  return json({ token })
}
