import { signedInEmail, type AccessData } from './boardAccess'

type Env = { OSA_DB: D1Database }
type Entry = { id: string; name: string; nameRevision: number; updatedAt: string; isDefault: number; content?: string; revision?: number }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } })
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const validName = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
  && value.trim().length <= 120 && !Array.from(value).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
const metadata = `SELECT boards.id, COALESCE(catalog.name, boards.name) AS name, COALESCE(catalog.name_revision, 1) AS nameRevision,
  boards.updated_at AS updatedAt, EXISTS(SELECT 1 FROM lab_notebooks
    WHERE board_id = boards.id AND owner_email = boards.owner_email) AS isDefault`
// Include defaults created by a still-running old worker after migration's
// one-time backfill. Reads do not need to create/repair metadata to open them.
const membership = `FROM boards LEFT JOIN lab_notebook_catalog catalog ON boards.id = catalog.board_id
  AND boards.owner_email = catalog.owner_email WHERE boards.owner_email = ? AND boards.archived = 0
  AND (catalog.board_id IS NOT NULL OR EXISTS (SELECT 1 FROM lab_notebooks
    WHERE lab_notebooks.board_id = boards.id AND lab_notebooks.owner_email = boards.owner_email))`
const publicEntry = (entry: Entry) => ({ id: entry.id, name: entry.name, nameRevision: entry.nameRevision,
  updatedAt: entry.updatedAt, isDefault: Boolean(entry.isDefault) })
async function read(env: Env, email: string, id: string) {
  const row = await env.OSA_DB.prepare(`${metadata}, boards.content, boards.revision ${membership} AND boards.id = ?`)
    .bind(email, id).first<Entry>()
  return row ? { ...JSON.parse(row.content!), ...publicEntry(row), revision: row.revision, archived: false, access: 'owner' } : null
}
function guard(request: Request, email: string | null) {
  if (!email) return json({ error: 'Private sign-in required.' }, 401)
  const expected = request.headers.get('x-osa-account')
  if (expected && expected !== email) return json({ error: 'The signed-in account changed. Reopen the Lab before syncing.' }, 403)
  const origin = request.headers.get('origin')
  if (request.method !== 'GET' && origin && origin !== new URL(request.url).origin) return json({ error: 'Same-origin request required.' }, 403)
  return null
}
const unavailable = () => json({ error: 'Notebook switching is unavailable. Your current notebook has not been changed.' }, 503)

export const onRequestGet: PagesFunction<Env, string, AccessData> = async ({ request, env, data }) => {
  const email = signedInEmail(data)
  const error = guard(request, email)
  if (error) return error
  try {
    const id = new URL(request.url).searchParams.get('id')
    if (id !== null) {
      const board = await read(env, email!, id)
      return board ? json({ board }) : json({ error: 'That notebook was not found.' }, 404)
    }
    const rows = await env.OSA_DB.prepare(`${metadata} ${membership} ORDER BY catalog.name COLLATE NOCASE, boards.id`).bind(email).all<Entry>()
    return json({ notebooks: rows.results.map(publicEntry) })
  } catch { return unavailable() }
}

/** Explicit, empty creation. A retry key prevents duplicates after a lost response. */
export const onRequestPost: PagesFunction<Env, string, AccessData> = async ({ request, env, data }) => {
  const email = signedInEmail(data)
  const error = guard(request, email)
  if (error) return error
  const body: unknown = await request.json().catch(() => null)
  if (!record(body) || !validName(body.name) || typeof body.creationKey !== 'string'
    || !/^[a-zA-Z0-9-]{16,80}$/.test(body.creationKey)) return json({ error: 'Enter a notebook name (1–120 characters) and a valid creation key.' }, 400)
  try {
    const id = crypto.randomUUID()
    const name = body.name.trim()
    const updatedAt = new Date().toISOString()
    const board = { id, name, updatedAt, snapshot: { version: 7, nodes: [], edges: [] } }
    await env.OSA_DB.batch([
      env.OSA_DB.prepare(`INSERT INTO boards (id, owner_email, name, content, updated_at, revision)
        SELECT ?, ?, ?, ?, ?, 1 WHERE NOT EXISTS (SELECT 1 FROM lab_notebook_catalog WHERE owner_email = ? AND creation_key = ?)`)
        .bind(id, email, name, JSON.stringify(board), updatedAt, email, body.creationKey),
      env.OSA_DB.prepare(`INSERT OR IGNORE INTO lab_notebook_catalog (board_id, owner_email, name, creation_key)
        SELECT id, owner_email, ?, ? FROM boards WHERE id = ? AND owner_email = ?`).bind(name, body.creationKey, id, email),
    ])
    const created = await env.OSA_DB.prepare('SELECT board_id FROM lab_notebook_catalog WHERE owner_email = ? AND creation_key = ?')
      .bind(email, body.creationKey).first<{ board_id: string }>()
    const result = created ? await read(env, email!, created.board_id) : null
    return result ? json({ board: result }, 201) : json({ error: 'This creation request belongs to a notebook that is no longer available. Start a new notebook request.' }, 409)
  } catch { return unavailable() }
}

/** Naming has its own revision; it neither replaces artwork nor consumes a draft. */
export const onRequestPatch: PagesFunction<Env, string, AccessData> = async ({ request, env, data }) => {
  const email = signedInEmail(data)
  const error = guard(request, email)
  if (error) return error
  const body: unknown = await request.json().catch(() => null)
  if (!record(body) || !validName(body.name) || typeof body.id !== 'string'
    || !Number.isSafeInteger(body.nameRevision) || Number(body.nameRevision) < 1) return json({ error: 'A name and its current revision are required.' }, 400)
  try {
    const board = await read(env, email!, body.id)
    if (!board) return json({ error: 'That notebook was not found.' }, 404)
    await env.OSA_DB.prepare(`INSERT OR IGNORE INTO lab_notebook_catalog (board_id, owner_email, name, created_at)
      SELECT boards.id, boards.owner_email, boards.name, lab_notebooks.created_at FROM lab_notebooks
      JOIN boards ON boards.id = lab_notebooks.board_id AND boards.owner_email = lab_notebooks.owner_email
      WHERE boards.id = ? AND boards.owner_email = ? AND boards.archived = 0`).bind(body.id, email).run()
    const result = await env.OSA_DB.prepare(`UPDATE lab_notebook_catalog SET name = ?, name_revision = name_revision + 1
      WHERE board_id = ? AND owner_email = ? AND name_revision = ?
      AND EXISTS (SELECT 1 FROM boards WHERE boards.id = board_id AND boards.owner_email = ? AND boards.archived = 0)`)
      .bind(body.name.trim(), body.id, email, body.nameRevision, email).run()
    if (!result.meta.changes) return json({ error: 'The notebook was renamed elsewhere. Reopen it before renaming again.' }, 409)
    const renamed = await read(env, email!, body.id)
    return renamed ? json({ board: renamed }) : json({ error: 'The notebook is no longer available.' }, 409)
  } catch { return unavailable() }
}
