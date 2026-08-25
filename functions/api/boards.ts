type Board = {
  id: string
  name: string
  updatedAt: string
  /** The database is authoritative; this client-supplied value is ignored on save. */
  archived?: unknown
  /** The database is authoritative; this client-supplied value is ignored on save. */
  revision?: unknown
  [key: string]: unknown
}

type BoardRow = { content: string; archived: number; revision: number }
type SaveRequest = {
  board?: unknown
  /** Accepted during deployment so an older open tab cannot fail abruptly. */
  boards?: unknown
  /**
   * `null` means create only; an integer means update that exact revision.
   * Omission is the compatibility route for already-open older clients.
   */
  baseRevision?: unknown
}
type ArchiveRequest = { boardId?: unknown; archived?: unknown }

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

/** The stored JSON is the board document; server state lives in D1 columns. */
function boardWithServerState({ content, archived, revision }: BoardRow) {
  const board: unknown = JSON.parse(content)
  return typeof board === 'object' && board !== null
    ? { ...board, archived: archived === 1, revision }
    : board
}

function isRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1
}

function isValidBaseRevision(value: unknown) {
  return value === undefined || value === null || isRevision(value)
}

/** Removes server-owned fields before the board is stored as its durable document. */
function boardContent(board: Board) {
  const content = { ...board }
  delete content.archived
  delete content.revision
  delete content.baseRevision
  return content
}

async function ownedBoard(env: Env, boardId: string, owner: string) {
  return env.OSA_DB
    .prepare('SELECT content, archived, revision FROM boards WHERE id = ? AND owner_email = ?')
    .bind(boardId, owner)
    .first<BoardRow>()
}

/** Explains why a guarded save was not applied without revealing another owner's board. */
async function saveConflictResponse(env: Env, boardId: string, owner: string) {
  const current = await ownedBoard(env, boardId, owner)
  if (!current) return json({ error: 'That saved board was not found.' }, 404)

  const board = boardWithServerState(current)
  if (current.archived === 1) {
    return json({
      error: 'Restore this board before saving changes.',
      code: 'archived',
      board,
    }, 409)
  }

  return json({
    error: 'A newer saved version exists.',
    code: 'stale',
    board,
  }, 409)
}

function requestedArchiveState(request: Request) {
  const value = new URL(request.url).searchParams.get('archived')
  if (value === null || value === 'false') return 0
  if (value === 'true') return 1
  return null
}

/**
 * Normal boards are listed by default. Archived boards require an explicit
 * `?archived=true`, so an existing authoring screen never suddenly shows them.
 */
export const onRequestGet: PagesFunction<Env, string, AccessData> = async ({ request, env, data }) => {
  const owner = ownerEmail(data)
  if (!owner) return json({ error: 'Private sign-in required.' }, 403)

  const url = new URL(request.url)
  const boardId = url.searchParams.get('id')
  // A current editor polls one board by ID. Unlike the list route, this must
  // also reveal that another device archived the board so it can stop syncing.
  if (boardId !== null) {
    if (!boardId.trim()) return json({ error: 'A board id is required.' }, 400)
    const board = await ownedBoard(env, boardId, owner)
    if (!board) return json({ error: 'That saved board was not found.' }, 404)
    return json({ board: boardWithServerState(board) })
  }

  const archived = requestedArchiveState(request)
  if (archived === null) return json({ error: 'Use archived=true or archived=false.' }, 400)

  const result = await env.OSA_DB
    .prepare('SELECT content, archived, revision FROM boards WHERE owner_email = ? AND archived = ? ORDER BY updated_at DESC')
    .bind(owner, archived)
    .all<BoardRow>()
  return json({ boards: result.results.map(boardWithServerState) })
}

export const onRequestPut: PagesFunction<Env, string, AccessData> = async ({ request, env, data }) => {
  const owner = ownerEmail(data)
  if (!owner) return json({ error: 'Private sign-in required.' }, 403)
  const body = await request.json().catch(() => null) as SaveRequest | null

  if (body?.board) {
    const board = body.board as Board
    const baseRevision = body.baseRevision
    if (!board?.id || !board.name || !board.updatedAt) {
      return json({ error: 'The board is missing required details.' }, 400)
    }
    if (!isValidBaseRevision(baseRevision)) {
      return json({ error: 'baseRevision must be a positive integer or null.' }, 400)
    }

    const content = boardContent(board)
    const serializedContent = JSON.stringify(content)

    if (baseRevision === null) {
      // New current clients explicitly create rather than overwriting a board
      // whose ID happens to already exist on another device.
      const result = await env.OSA_DB
        .prepare(`
          INSERT INTO boards (id, owner_email, name, content, updated_at, revision)
          VALUES (?, ?, ?, ?, ?, 1)
          ON CONFLICT(id) DO NOTHING
        `)
        .bind(board.id, owner, board.name, serializedContent, board.updatedAt)
        .run()
      if (!result.meta.changes) return saveConflictResponse(env, board.id, owner)
      return json({ board: boardWithServerState({ content: serializedContent, archived: 0, revision: 1 }) })
    }

    if (isRevision(baseRevision)) {
      // This is the optimistic-concurrency path used by current clients. The
      // revision predicate makes a stale device fail rather than last-write-win.
      const result = await env.OSA_DB
        .prepare(`
          UPDATE boards
          SET name = ?, content = ?, updated_at = ?, revision = revision + 1
          WHERE id = ?
            AND owner_email = ?
            AND archived = 0
            AND revision = ?
        `)
        .bind(board.name, serializedContent, board.updatedAt, board.id, owner, baseRevision)
        .run()
      if (!result.meta.changes) return saveConflictResponse(env, board.id, owner)
      return json({
        board: boardWithServerState({
          content: serializedContent,
          archived: 0,
          revision: baseRevision + 1,
        }),
      })
    }

    // Older open tabs do not send `baseRevision`. Keep them functional during
    // rollout, while still preventing them from reviving an archived board.
    const result = await env.OSA_DB
      .prepare(`
        INSERT INTO boards (id, owner_email, name, content, updated_at, revision)
        VALUES (?, ?, ?, ?, ?, 1)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          content = excluded.content,
          updated_at = excluded.updated_at,
          revision = boards.revision + 1
        WHERE boards.owner_email = excluded.owner_email
          AND boards.archived = 0
      `)
      .bind(board.id, owner, board.name, serializedContent, board.updatedAt)
      .run()
    if (!result.meta.changes) return saveConflictResponse(env, board.id, owner)
    const saved = await ownedBoard(env, board.id, owner)
    if (!saved) return json({ error: 'Unable to read the saved board.' }, 500)
    return json({ board: boardWithServerState(saved) })
  }

  // The old multi-board payload remains accepted for clients that were already
  // open during deployment. New clients use the guarded single-board route.
  const boards = Array.isArray(body?.boards) ? body.boards as Board[] : null
  if (!boards) return json({ error: 'Expected a board.' }, 400)
  if (boards.length > 250) return json({ error: 'Too many boards in one save.' }, 413)
  if (boards.some((board) => !board?.id || !board.name || !board.updatedAt)) return json({ error: 'One or more boards are missing required details.' }, 400)
  const statements = boards.map((board) => {
    // A stale tab must never unarchive a board just because its in-memory JSON
    // still says `archived: false`. Only PATCH below changes this D1 field.
    const content = boardContent(board)
    return env.OSA_DB.prepare(`
      INSERT INTO boards (id, owner_email, name, content, updated_at, revision)
      VALUES (?, ?, ?, ?, ?, 1)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        content = excluded.content,
        updated_at = excluded.updated_at,
        revision = boards.revision + 1
      WHERE boards.owner_email = excluded.owner_email
        AND boards.archived = 0
    `).bind(board.id, owner, board.name, JSON.stringify(content), board.updatedAt)
  })
  const results = await env.OSA_DB.batch(statements)
  if (results.some((result) => result.meta.changes === 0)) {
    return json({ error: 'Restore an archived board before saving changes.' }, 409)
  }
  return json({ ok: true })
}

/** Archives or restores one owned board without deleting its contents or shares. */
export const onRequestPatch: PagesFunction<Env, string, AccessData> = async ({ request, env, data }) => {
  const owner = ownerEmail(data)
  if (!owner) return json({ error: 'Private sign-in required.' }, 403)

  const body = await request.json().catch(() => null) as ArchiveRequest | null
  const boardId = body?.boardId
  const archived = body?.archived
  if (typeof boardId !== 'string' || !boardId || typeof archived !== 'boolean') {
    return json({ error: 'A board id and archived true or false are required.' }, 400)
  }

  const result = await env.OSA_DB
    .prepare('UPDATE boards SET archived = ?, revision = revision + 1 WHERE id = ? AND owner_email = ?')
    .bind(archived ? 1 : 0, boardId, owner)
    .run()
  if (!result.meta.changes) return json({ error: 'That saved board was not found.' }, 404)

  const board = await ownedBoard(env, boardId, owner)
  if (!board) return json({ error: 'Unable to read the saved board.' }, 500)
  return json({ ok: true, archived, board: boardWithServerState(board) })
}
