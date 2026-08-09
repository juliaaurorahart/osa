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
  const body = await request.json().catch(() => null) as { boards?: unknown } | null
  if (!body || !Array.isArray(body.boards)) return json({ error: 'Expected a boards list.' }, 400)
  if (body.boards.length > 250) return json({ error: 'Too many boards in one save.' }, 413)
  const boards = body.boards as Board[]
  if (boards.some((board) => !board?.id || !board.name || !board.updatedAt)) return json({ error: 'One or more boards are missing required details.' }, 400)
  const statements = [
    env.OSA_DB.prepare('DELETE FROM boards WHERE owner_email = ?').bind(owner),
    ...boards.map((board) => env.OSA_DB
      .prepare('INSERT INTO boards (id, owner_email, name, content, updated_at) VALUES (?, ?, ?, ?, ?)')
      .bind(board.id, owner, board.name, JSON.stringify(board), board.updatedAt)),
  ]
  await env.OSA_DB.batch(statements)
  return json({ ok: true })
}
