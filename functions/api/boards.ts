import {
  accessibleBoard,
  ownedBoard,
  signedInEmail,
  type AccessData,
  type StoredBoardRow,
} from './boardAccess'

type Board = {
  id: string
  name: string
  updatedAt: string
  /** The database is authoritative; this client-supplied value is ignored on save. */
  archived?: unknown
  /** The database is authoritative; this client-supplied value is ignored on save. */
  revision?: unknown
  /** The database is authoritative; this client-supplied value is ignored on save. */
  access?: unknown
  [key: string]: unknown
}

type BoardRow = StoredBoardRow
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

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

/** The stored JSON is the board document; server state lives in D1 columns. */
function boardWithServerState({ content, archived, revision, access }: BoardRow) {
  const board: unknown = JSON.parse(content)
  return typeof board === 'object' && board !== null
    ? { ...board, archived: archived === 1, revision, access }
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
  delete content.access
  delete content.baseRevision
  return content
}

/** Explains why a guarded save was not applied without revealing another person's board. */
async function saveConflictResponse(env: Env, boardId: string, email: string) {
  const current = await accessibleBoard(env, boardId, email)
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
 * Normal boards are listed by default. A signed-in owner, editor, or viewer
 * sees the same current board record; the returned access role tells the UI
 * whether it may edit it. Archived boards require an explicit opt-in.
 */
export const onRequestGet: PagesFunction<Env, string, AccessData> = async ({ request, env, data }) => {
  const email = signedInEmail(data)
  if (!email) return json({ error: 'Private sign-in required.' }, 403)

  const url = new URL(request.url)
  const boardId = url.searchParams.get('id')
  // A current editor polls one board by ID. Unlike the list route, this must
  // also reveal that another device archived the board so it can stop syncing.
  if (boardId !== null) {
    if (!boardId.trim()) return json({ error: 'A board id is required.' }, 400)
    const board = await accessibleBoard(env, boardId, email)
    if (!board) return json({ error: 'That saved board was not found.' }, 404)
    return json({ board: boardWithServerState(board) })
  }

  const archived = requestedArchiveState(request)
  if (archived === null) return json({ error: 'Use archived=true or archived=false.' }, 400)

  const result = await env.OSA_DB
    .prepare(`
      SELECT
        boards.content,
        boards.archived,
        boards.revision,
        CASE
          WHEN boards.owner_email = ? THEN 'owner'
          ELSE board_collaborators.role
        END AS access
      FROM boards
      LEFT JOIN board_collaborators
        ON board_collaborators.board_id = boards.id
        AND board_collaborators.email = ?
      WHERE boards.archived = ?
        AND (boards.owner_email = ? OR board_collaborators.email = ?)
      ORDER BY boards.updated_at DESC
    `)
    .bind(email, email, archived, email, email)
    .all<BoardRow>()
  return json({ boards: result.results.map(boardWithServerState) })
}

export const onRequestPut: PagesFunction<Env, string, AccessData> = async ({ request, env, data }) => {
  const email = signedInEmail(data)
  if (!email) return json({ error: 'Private sign-in required.' }, 403)
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

    const serializedContent = JSON.stringify(boardContent(board))

    if (baseRevision === null) {
      // New current clients explicitly create rather than overwriting a board
      // whose ID happens to already exist on another device.
      const result = await env.OSA_DB
        .prepare(`
          INSERT INTO boards (id, owner_email, name, content, updated_at, revision)
          VALUES (?, ?, ?, ?, ?, 1)
          ON CONFLICT(id) DO NOTHING
        `)
        .bind(board.id, email, board.name, serializedContent, board.updatedAt)
        .run()
      if (!result.meta.changes) return saveConflictResponse(env, board.id, email)
      return json({
        board: boardWithServerState({
          content: serializedContent,
          archived: 0,
          revision: 1,
          access: 'owner',
        }),
      })
    }

    if (isRevision(baseRevision)) {
      const current = await accessibleBoard(env, board.id, email)
      if (!current) return json({ error: 'That saved board was not found.' }, 404)
      if (current.access === 'viewer') {
        return json({ error: 'This board is shared with you for viewing only.' }, 403)
      }

      // The revision predicate prevents a stale device from silently
      // overwriting another owner/editor. The membership predicate is kept in
      // the same statement so a removed collaborator cannot write mid-session.
      const result = await env.OSA_DB
        .prepare(`
          UPDATE boards
          SET name = ?, content = ?, updated_at = ?, revision = revision + 1
          WHERE id = ?
            AND archived = 0
            AND revision = ?
            AND (
              owner_email = ?
              OR EXISTS (
                SELECT 1
                FROM board_collaborators
                WHERE board_collaborators.board_id = boards.id
                  AND board_collaborators.email = ?
                  AND board_collaborators.role = 'editor'
              )
            )
        `)
        .bind(board.name, serializedContent, board.updatedAt, board.id, baseRevision, email, email)
        .run()
      if (!result.meta.changes) return saveConflictResponse(env, board.id, email)
      return json({
        board: boardWithServerState({
          content: serializedContent,
          archived: 0,
          revision: baseRevision + 1,
          access: current.access,
        }),
      })
    }

    // Older open tabs do not send `baseRevision`. Keep the old owner-only
    // route functional during rollout; current collaborating clients always
    // send a revision and use the guarded branch above.
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
      .bind(board.id, email, board.name, serializedContent, board.updatedAt)
      .run()
    if (!result.meta.changes) return saveConflictResponse(env, board.id, email)
    const saved = await accessibleBoard(env, board.id, email)
    if (!saved) return json({ error: 'Unable to read the saved board.' }, 500)
    return json({ board: boardWithServerState(saved) })
  }

  // The old multi-board payload remains accepted for already-open owner tabs.
  // New clients save a single guarded board at a time.
  const boards = Array.isArray(body?.boards) ? body.boards as Board[] : null
  if (!boards) return json({ error: 'Expected a board.' }, 400)
  if (boards.length > 250) return json({ error: 'Too many boards in one save.' }, 413)
  if (boards.some((board) => !board?.id || !board.name || !board.updatedAt)) return json({ error: 'One or more boards are missing required details.' }, 400)
  const statements = boards.map((board) => {
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
    `).bind(board.id, email, board.name, JSON.stringify(content), board.updatedAt)
  })
  const results = await env.OSA_DB.batch(statements)
  if (results.some((result) => result.meta.changes === 0)) {
    return json({ error: 'Restore an archived board before saving changes.' }, 409)
  }
  return json({ ok: true })
}

/** Archiving is owner-only: collaborators can edit the document, not its lifecycle. */
export const onRequestPatch: PagesFunction<Env, string, AccessData> = async ({ request, env, data }) => {
  const owner = signedInEmail(data)
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
