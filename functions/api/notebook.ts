import { signedInEmail, type AccessData } from './boardAccess'

type Env = { OSA_DB: D1Database }
type NotebookRow = { content: string; revision: number }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } })

async function notebook(env: Env, email: string) {
  const row = await env.OSA_DB.prepare(`SELECT boards.content, boards.revision FROM lab_notebooks
    JOIN boards ON boards.id = lab_notebooks.board_id AND boards.owner_email = lab_notebooks.owner_email
    WHERE lab_notebooks.owner_email = ?`).bind(email).first<NotebookRow>()
  return row ? { ...JSON.parse(row.content), revision: row.revision, archived: false, access: 'owner' } : null
}

function accountError(request: Request, email: string | null) {
  if (!email) return json({ error: 'Private sign-in required.' }, 401)
  const expected = request.headers.get('x-osa-account')
  if (expected && expected !== email) return json({ error: 'The signed-in account changed. Reopen the Lab before syncing.' }, 403)
  return null
}

export const onRequestGet: PagesFunction<Env, string, AccessData> = async ({ request, env, data }) => {
  const email = signedInEmail(data)
  const error = accountError(request, email)
  if (error) return error
  try { return json({ board: await notebook(env, email!) }) }
  catch { return json({ error: 'Notebook storage is unavailable. Your local notebook has not been changed.' }, 503) }
}

/** Provision only on an explicit request. No request body or guest data is adopted here. */
export const onRequestPut: PagesFunction<Env, string, AccessData> = async ({ request, env, data }) => {
  const email = signedInEmail(data)
  const error = accountError(request, email)
  if (error) return error
  // Cross-site requests cannot provision notebooks even where cookies are sent.
  const origin = request.headers.get('origin')
  if (origin && origin !== new URL(request.url).origin) return json({ error: 'Same-origin request required.' }, 403)
  try {
    const existing = await notebook(env, email!)
    if (existing) return json({ board: existing })
    const id = crypto.randomUUID()
    const updatedAt = new Date().toISOString()
    const board = { id, name: 'Lab notebook', updatedAt, snapshot: { version: 7, nodes: [], edges: [] } }
    // The batch is transactional. Conditional insert + association means two
    // simultaneous first opens cannot leave orphan boards or replace a notebook.
    await env.OSA_DB.batch([
      env.OSA_DB.prepare(`INSERT INTO boards (id, owner_email, name, content, updated_at, revision)
        SELECT ?, ?, ?, ?, ?, 1 WHERE NOT EXISTS (SELECT 1 FROM lab_notebooks WHERE owner_email = ?)`)
        .bind(id, email, board.name, JSON.stringify(board), updatedAt, email),
      env.OSA_DB.prepare(`INSERT OR IGNORE INTO lab_notebooks (owner_email, board_id)
        SELECT ?, id FROM boards WHERE id = ? AND owner_email = ?`).bind(email, id, email),
    ])
    const created = await notebook(env, email!)
    return created ? json({ board: created }) : json({ error: 'The account notebook could not be opened. Try again.' }, 503)
  } catch { return json({ error: 'Notebook storage is unavailable. Your local notebook has not been changed.' }, 503) }
}
