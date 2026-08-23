type Board = { id: string; name: string; updatedAt: string; [key: string]: unknown }

type Env = { OSA_DB: D1Database }
type AccessData = { cloudflareAccess?: { JWT?: { payload?: { email?: string } } } }

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

function ownerEmail(data: AccessData) {
  return data.cloudflareAccess?.JWT?.payload?.email?.toLowerCase() ?? null
}

export const onRequestGet: PagesFunction<Env, string, AccessData> = async ({ env, data }) => {
  const owner = ownerEmail(data)
  if (!owner) return json({ error: 'Private sign-in required.' }, 403)
  const result = await env.OSA_DB
    .prepare('SELECT content FROM boards WHERE owner_email = ? ORDER BY updated_at DESC')
    .bind(owner)
    .all<{ content: string }>()
  return json({ boards: result.results.map(({ content }) => JSON.parse(content)) })
}

export const onRequestPut: PagesFunction<Env, string, AccessData> = async ({ request, env, data }) => {
  const owner = ownerEmail(data)
  if (!owner) return json({ error: 'Private sign-in required.' }, 403)
  const body = await request.json().catch(() => null) as {
    board?: unknown
    /** Accepted during deployment so an older open tab cannot fail abruptly. */
    boards?: unknown
  } | null
  const boards = body?.board
    ? [body.board as Board]
    : Array.isArray(body?.boards)
      ? body.boards as Board[]
      : null
  if (!boards) return json({ error: 'Expected a board.' }, 400)
  if (boards.length > 250) return json({ error: 'Too many boards in one save.' }, 413)
  if (boards.some((board) => !board?.id || !board.name || !board.updatedAt)) return json({ error: 'One or more boards are missing required details.' }, 400)
  const statements = boards.map((board) => env.OSA_DB.prepare(`
    INSERT INTO boards (id, owner_email, name, content, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      content = excluded.content,
      updated_at = excluded.updated_at
    WHERE boards.owner_email = excluded.owner_email
  `).bind(board.id, owner, board.name, JSON.stringify(board), board.updatedAt))
  await env.OSA_DB.batch(statements)
  return json({ ok: true })
}
