import {
  normalizeCollaboratorRole,
  normalizeEmail,
  ownedBoard,
  signedInEmail,
  type AccessData,
  type CollaboratorRole,
} from './boardAccess'

type Env = { OSA_DB: D1Database }
type Collaborator = { email: string; role: CollaboratorRole }
type CollaboratorRequest = {
  boardId?: unknown
  email?: unknown
  role?: unknown
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

async function requireOwnedBoard(env: Env, boardId: unknown, owner: string) {
  if (typeof boardId !== 'string' || !boardId.trim()) return null
  return ownedBoard(env, boardId, owner)
}

/** Lists the people explicitly invited to one board. The owner is implicit. */
export const onRequestGet: PagesFunction<Env, string, AccessData> = async ({ request, env, data }) => {
  const owner = signedInEmail(data)
  if (!owner) return json({ error: 'Private sign-in required.' }, 403)

  const boardId = new URL(request.url).searchParams.get('boardId')
  const board = await requireOwnedBoard(env, boardId, owner)
  if (!board) return json({ error: 'That saved board was not found.' }, 404)

  const result = await env.OSA_DB
    .prepare('SELECT email, role FROM board_collaborators WHERE board_id = ? ORDER BY email COLLATE NOCASE')
    .bind(boardId)
    .all<Collaborator>()
  return json({ collaborators: result.results })
}

/** Invites or updates one person. New people are editors unless the owner chooses viewer. */
export const onRequestPost: PagesFunction<Env, string, AccessData> = async ({ request, env, data }) => {
  const owner = signedInEmail(data)
  if (!owner) return json({ error: 'Private sign-in required.' }, 403)

  const body = await request.json().catch(() => null) as CollaboratorRequest | null
  const board = await requireOwnedBoard(env, body?.boardId, owner)
  if (!board) return json({ error: 'That saved board was not found.' }, 404)

  const email = normalizeEmail(body?.email)
  const role = body?.role === undefined ? 'editor' : normalizeCollaboratorRole(body.role)
  if (!email || !role) return json({ error: 'Use a valid email and editor or viewer access.' }, 400)
  if (email === owner) return json({ error: 'The board owner already has access.' }, 400)

  await env.OSA_DB
    .prepare(`
      INSERT INTO board_collaborators (board_id, email, role)
      VALUES (?, ?, ?)
      ON CONFLICT(board_id, email) DO UPDATE SET role = excluded.role
    `)
    .bind(body!.boardId, email, role)
    .run()
  return json({ collaborator: { email, role } })
}

/** Removes one invitation without touching the board or its public links. */
export const onRequestDelete: PagesFunction<Env, string, AccessData> = async ({ request, env, data }) => {
  const owner = signedInEmail(data)
  if (!owner) return json({ error: 'Private sign-in required.' }, 403)

  const body = await request.json().catch(() => null) as CollaboratorRequest | null
  const board = await requireOwnedBoard(env, body?.boardId, owner)
  if (!board) return json({ error: 'That saved board was not found.' }, 404)

  const email = normalizeEmail(body?.email)
  if (!email) return json({ error: 'Use a valid collaborator email.' }, 400)

  await env.OSA_DB
    .prepare('DELETE FROM board_collaborators WHERE board_id = ? AND email = ?')
    .bind(body!.boardId, email)
    .run()
  return json({ ok: true })
}
