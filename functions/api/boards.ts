import {
  accessibleBoard,
  accountMatchesRequest,
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
type BoardMetadataRow = {
  id: string
  name: string
  updatedAt: string
  archived: number
  revision: number
  access: BoardRow['access']
}
type RawBoardRow = BoardMetadataRow & { content: string }
type LegacyBoardListFootprint = {
  boardCount: number
  contentBytes: number
}
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

/**
 * Opt-in transport for large board documents. Its body is the board document
 * itself, while the few fields the database needs live in headers. That keeps
 * image-heavy JSON out of the worker's object graph: it is read once as text
 * and bound directly to D1 instead of being parsed, copied, and stringified.
 *
 * Header names deliberately use a private vendor media type rather than
 * changing the existing JSON-envelope PUT contract used by open older tabs.
 */
const rawBoardMediaType = 'application/vnd.osa.board+json'
const rawBoardIdHeader = 'x-osa-board-id'
const rawBoardNameHeader = 'x-osa-board-name'
const rawBoardUpdatedAtHeader = 'x-osa-board-updated-at'
const rawBoardBaseRevisionHeader = 'x-osa-base-revision'

// Older open tabs still request every stored board in one response. Parsing
// and serializing several photo-heavy documents can exceed the Pages Worker
// CPU limit, so direct those tabs to reload into the current thin transport.
// These are intentionally conservative: the metadata and raw-document routes
// below remain available for any size board.
const legacyFullListMaximumBoards = 12
const legacyFullListMaximumContentBytes = 750_000

type RawBoardSave = {
  id: string
  name: string
  updatedAt: string
  baseRevision: number | null | undefined
}

type RawBoardSaveRequest =
  | { kind: 'not-raw' }
  | { kind: 'invalid'; error: string }
  | { kind: 'raw'; save: RawBoardSave }

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function isTooLargeError(error: unknown) {
  return /(?:SQLITE_TOOBIG|too (?:large|big)|(?:maximum|max(?:imum)?) (?:string|blob|row)|string or blob|value too large)/i.test(
    errorMessage(error),
  )
}

/** Keeps D1 failures from becoming opaque Pages 1101/500 responses. */
function unexpectedBoardServiceResponse(error: unknown) {
  console.error('OSA board API failed.', error)
  if (isTooLargeError(error)) {
    return json({
      error: 'This board is too large for cloud sync. Reduce or replace large photos and try again.',
    }, 413)
  }
  return json({ error: 'Board service is temporarily unavailable. Please try again.' }, 503)
}

async function withBoardServiceErrors(work: () => Promise<Response>) {
  try {
    return await work()
  } catch (error) {
    return unexpectedBoardServiceResponse(error)
  }
}

/** The stored JSON is the board document; server state lives in D1 columns. */
function boardWithServerState({ content, archived, revision, access }: BoardRow) {
  const board: unknown = JSON.parse(content)
  return typeof board === 'object' && board !== null
    ? { ...board, archived: archived === 1, revision, access }
    : board
}

/** A compact record for board pickers and save acknowledgements. */
function boardMetadata({ id, name, updatedAt, archived, revision, access }: BoardMetadataRow) {
  return { id, name, updatedAt, archived: archived === 1, revision, access }
}

function rawBoardHeaders({ id, name, updatedAt, archived, revision, access }: BoardMetadataRow) {
  return {
    'cache-control': 'no-store',
    'content-type': `${rawBoardMediaType}; charset=utf-8`,
    'x-osa-board-id': id,
    // `encodeURIComponent` lets names with Unicode and spaces travel safely
    // through headers. Raw-save clients decode this value when they need it.
    'x-osa-board-name': encodeURIComponent(name),
    'x-osa-board-updated-at': updatedAt,
    'x-osa-board-revision': String(revision),
    'x-osa-board-access': access,
    'x-osa-board-archived': archived === 1 ? 'true' : 'false',
  }
}

/** Returns a document verbatim after the same access check as normal board reads. */
function rawBoardResponse(board: RawBoardRow) {
  return new Response(board.content, { headers: rawBoardHeaders(board) })
}

function isRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1
}

function isValidBaseRevision(value: unknown) {
  return value === undefined || value === null || isRevision(value)
}

function requestMediaType(request: Request) {
  return request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() ?? ''
}

/**
 * Raw saves send their document as the request body and the compact metadata
 * as headers. Board names are URI-encoded so every valid Unicode name travels
 * through an HTTP header safely; ordinary ASCII names also work unchanged.
 */
function decodeRawBoardName(value: string | null) {
  if (!value) return null
  try {
    const decoded = decodeURIComponent(value)
    return decoded || null
  } catch {
    // A caller may send a literal percent sign in an otherwise normal ASCII
    // name. Treat it as a literal header value rather than rejecting a board
    // name that the legacy route has always accepted.
    return value
  }
}

function rawBoardSaveRequest(request: Request): RawBoardSaveRequest {
  const mediaType = requestMediaType(request)
  const isRaw = mediaType === rawBoardMediaType || request.headers.has(rawBoardIdHeader)
  if (!isRaw) return { kind: 'not-raw' }

  if (mediaType !== rawBoardMediaType) {
    return { kind: 'invalid', error: `Raw board saves must use ${rawBoardMediaType}.` }
  }

  const id = request.headers.get(rawBoardIdHeader)
  const name = decodeRawBoardName(request.headers.get(rawBoardNameHeader))
  const updatedAt = request.headers.get(rawBoardUpdatedAtHeader)
  if (!id || !name || !updatedAt) {
    return {
      kind: 'invalid',
      error: 'Raw board saves require x-osa-board-id, x-osa-board-name, and x-osa-board-updated-at headers.',
    }
  }

  const rawBaseRevision = request.headers.get(rawBoardBaseRevisionHeader)
  let baseRevision: number | null | undefined
  if (rawBaseRevision === null) {
    // Mirrors the owner-only compatibility route for old envelope clients.
    baseRevision = undefined
  } else if (rawBaseRevision === 'null') {
    baseRevision = null
  } else if (/^[1-9][0-9]*$/.test(rawBaseRevision)) {
    const parsed = Number(rawBaseRevision)
    if (!isRevision(parsed)) {
      return { kind: 'invalid', error: 'x-osa-base-revision must be a positive integer or null.' }
    }
    baseRevision = parsed
  } else {
    return { kind: 'invalid', error: 'x-osa-base-revision must be a positive integer or null.' }
  }

  return { kind: 'raw', save: { id, name, updatedAt, baseRevision } }
}

/**
 * The raw transport intentionally does not parse a large board document in
 * either Worker JavaScript or a separate validation query. The caller owns
 * serialization; this only rejects an empty or obviously non-object body.
 */
function hasRawBoardObjectShape(content: string) {
  for (let index = 0; index < content.length; index += 1) {
    const code = content.charCodeAt(index)
    if (code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d) continue
    return code === 0x7b // {
  }
  return false
}

/** A raw client already has its document, so return only server-owned state. */
function rawBoardSaveResponse(
  { id, name, updatedAt }: Pick<RawBoardSave, 'id' | 'name' | 'updatedAt'>,
  revision: number,
  access: BoardRow['access'],
) {
  return new Response(null, {
    status: 204,
    headers: rawBoardHeaders({ id, name, updatedAt, archived: 0, revision, access }),
  })
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

/**
 * Raw clients recover a conflict with a separate raw GET. Returning only D1
 * metadata here avoids parsing and sending the current image-heavy snapshot
 * merely to tell the caller which version won.
 */
async function rawSaveConflictResponse(env: Env, boardId: string, email: string) {
  const current = await accessibleBoardMetadata(env, boardId, email)
  if (!current) return json({ error: 'That saved board was not found.' }, 404)

  const board = boardMetadata(current)
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

function requestsRawBoard(url: URL) {
  return url.searchParams.get('raw') === 'true'
}

function requestsMetadata(url: URL) {
  return url.searchParams.get('metadata') === 'true'
}

/**
 * A legacy list response expands every board document. Check only aggregate
 * D1 metadata first so stale tabs get a useful reload instruction instead of
 * pushing the Worker through a multi-megabyte parse/stringify cycle.
 */
async function legacyFullListRequiresReload(env: Env, email: string, archived: number) {
  const footprint = await env.OSA_DB
    .prepare(`
      SELECT
        COUNT(*) AS boardCount,
        COALESCE(SUM(LENGTH(boards.content)), 0) AS contentBytes
      FROM boards
      WHERE boards.archived = ?
        AND NOT EXISTS (SELECT 1 FROM lab_notebooks WHERE lab_notebooks.board_id = boards.id)
        AND NOT EXISTS (SELECT 1 FROM lab_notebook_catalog WHERE lab_notebook_catalog.board_id = boards.id)
        AND (
          boards.owner_email = ?
          OR EXISTS (
            SELECT 1
            FROM board_collaborators
            WHERE board_collaborators.board_id = boards.id
              AND board_collaborators.email = ?
          )
        )
    `)
    .bind(archived, email, email)
    .first<LegacyBoardListFootprint>()

  return (footprint?.boardCount ?? 0) > legacyFullListMaximumBoards
    || (footprint?.contentBytes ?? 0) > legacyFullListMaximumContentBytes
}

/**
 * The normal access helper intentionally returns only the stored document.
 * The raw transport additionally needs D1's compact metadata, so it performs
 * the exact same owner/collaborator predicate while selecting those columns.
 */
async function accessibleRawBoard(env: Env, boardId: string, email: string): Promise<RawBoardRow | null> {
  return env.OSA_DB
    .prepare(`
      SELECT
        boards.id,
        boards.name,
        boards.updated_at AS updatedAt,
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
      WHERE boards.id = ?
        AND (boards.owner_email = ? OR board_collaborators.email = ?)
    `)
    .bind(email, email, boardId, email, email)
    .first<RawBoardRow>()
}

/** Same authorization predicate as a full read, without selecting the document. */
async function accessibleBoardMetadata(
  env: Env,
  boardId: string,
  email: string,
): Promise<BoardMetadataRow | null> {
  return env.OSA_DB
    .prepare(`
      SELECT
        boards.id,
        boards.name,
        boards.updated_at AS updatedAt,
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
      WHERE boards.id = ?
        AND (boards.owner_email = ? OR board_collaborators.email = ?)
    `)
    .bind(email, email, boardId, email, email)
    .first<BoardMetadataRow>()
}

async function ownedBoardMetadata(env: Env, boardId: string, owner: string): Promise<BoardMetadataRow | null> {
  const row = await env.OSA_DB
    .prepare(`
      SELECT id, name, updated_at AS updatedAt, archived, revision
      FROM boards
      WHERE id = ? AND owner_email = ?
    `)
    .bind(boardId, owner)
    .first<Omit<BoardMetadataRow, 'access'>>()
  return row ? { ...row, access: 'owner' } : null
}

/**
 * Normal boards are listed by default. A signed-in owner, editor, or viewer
 * sees the same current board record; the returned access role tells the UI
 * whether it may edit it. Archived boards require an explicit opt-in.
 */
export const onRequestGet: PagesFunction<Env, string, AccessData> = async ({ request, env, data }) => {
  return withBoardServiceErrors(async () => {
  const email = signedInEmail(data)
  if (!email) return json({ error: 'Private sign-in required.' }, 403)
  if (!accountMatchesRequest(request, email)) return json({ error: 'The signed-in account changed.', code: 'account_changed' }, 409)

  const url = new URL(request.url)
  const boardId = url.searchParams.get('id')
  if (requestsRawBoard(url) && boardId === null) {
    return json({ error: 'raw=true requires a board id.' }, 400)
  }
  // A current editor polls one board by ID. Unlike the list route, this must
  // also reveal that another device archived the board so it can stop syncing.
  if (boardId !== null) {
    if (!boardId.trim()) return json({ error: 'A board id is required.' }, 400)
    if (requestsRawBoard(url)) {
      const board = await accessibleRawBoard(env, boardId, email)
      if (!board) return json({ error: 'That saved board was not found.' }, 404)
      return rawBoardResponse(board)
    }
    const board = await accessibleBoard(env, boardId, email)
    if (!board) return json({ error: 'That saved board was not found.' }, 404)
    return json({ board: boardWithServerState(board) })
  }

  const archived = requestedArchiveState(request)
  if (archived === null) return json({ error: 'Use archived=true or archived=false.' }, 400)

  if (requestsMetadata(url)) {
    const result = await env.OSA_DB
      .prepare(`
        SELECT
          boards.id,
          boards.name,
          boards.updated_at AS updatedAt,
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
          AND NOT EXISTS (SELECT 1 FROM lab_notebooks WHERE lab_notebooks.board_id = boards.id)
          AND NOT EXISTS (SELECT 1 FROM lab_notebook_catalog WHERE lab_notebook_catalog.board_id = boards.id)
          AND (boards.owner_email = ? OR board_collaborators.email = ?)
        ORDER BY boards.updated_at DESC
      `)
      .bind(email, email, archived, email, email)
      .all<BoardMetadataRow>()
    return json({ boards: result.results.map(boardMetadata) })
  }

  if (await legacyFullListRequiresReload(env, email, archived)) {
    return json({ error: 'Reload OSA to use the current cloud sync.' }, 426)
  }

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
        AND NOT EXISTS (SELECT 1 FROM lab_notebooks WHERE lab_notebooks.board_id = boards.id)
        AND NOT EXISTS (SELECT 1 FROM lab_notebook_catalog WHERE lab_notebook_catalog.board_id = boards.id)
        AND (boards.owner_email = ? OR board_collaborators.email = ?)
      ORDER BY boards.updated_at DESC
    `)
    .bind(email, email, archived, email, email)
    .all<BoardRow>()
  return json({ boards: result.results.map(boardWithServerState) })
  })
}

/**
 * Stores an opt-in raw document without JSON.parse/JSON.stringify in the
 * worker. Its only body check is a leading-object-token guard, leaving full
 * serialization ownership with the client for photo-heavy snapshots.
 */
async function saveRawBoard(
  request: Request,
  env: Env,
  email: string,
  save: RawBoardSave,
) {
  let serializedContent: string
  try {
    serializedContent = await request.text()
  } catch {
    return json({ error: 'Unable to read the raw board document.' }, 400)
  }
  if (!hasRawBoardObjectShape(serializedContent)) {
    return json({
      error: 'The raw board document must begin with a JSON object.',
    }, 400)
  }

  const { id, name, updatedAt, baseRevision } = save
  if (baseRevision === null) {
    // New raw clients explicitly create rather than overwriting a board whose
    // ID happens to already exist on another device.
    const result = await env.OSA_DB
      .prepare(`
        INSERT INTO boards (id, owner_email, name, content, updated_at, revision)
        VALUES (?, ?, ?, ?, ?, 1)
        ON CONFLICT(id) DO NOTHING
      `)
      .bind(id, email, name, serializedContent, updatedAt)
      .run()
    if (!result.meta.changes) return rawSaveConflictResponse(env, id, email)
    return rawBoardSaveResponse(save, 1, 'owner')
  }

  if (isRevision(baseRevision)) {
    const current = await accessibleBoardMetadata(env, id, email)
    if (!current) return json({ error: 'That saved board was not found.' }, 404)
    if (current.access === 'viewer') {
      return json({ error: 'This board is shared with you for viewing only.' }, 403)
    }

    // This is deliberately identical to the normal guarded save: a stale
    // editor cannot overwrite a newer version or write after access removal.
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
      .bind(name, serializedContent, updatedAt, id, baseRevision, email, email)
      .run()
    if (!result.meta.changes) return rawSaveConflictResponse(env, id, email)
    return rawBoardSaveResponse(save, baseRevision + 1, current.access)
  }

  // Retain the owner-only, unguarded compatibility behavior when a raw client
  // omits x-osa-base-revision, just as older JSON-envelope clients do.
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
    .bind(id, email, name, serializedContent, updatedAt)
    .run()
  if (!result.meta.changes) return rawSaveConflictResponse(env, id, email)
  const saved = await accessibleBoardMetadata(env, id, email)
  if (!saved) return json({ error: 'Unable to read the saved board.' }, 500)
  return rawBoardSaveResponse(save, saved.revision, saved.access)
}

export const onRequestPut: PagesFunction<Env, string, AccessData> = async ({ request, env, data }) => {
  return withBoardServiceErrors(async () => {
  const email = signedInEmail(data)
  if (!email) return json({ error: 'Private sign-in required.' }, 403)
  if (!accountMatchesRequest(request, email)) return json({ error: 'The signed-in account changed.', code: 'account_changed' }, 409)
  const rawRequest = rawBoardSaveRequest(request)
  if (rawRequest.kind === 'invalid') return json({ error: rawRequest.error }, 400)
  if (rawRequest.kind === 'raw') return saveRawBoard(request, env, email, rawRequest.save)

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
  })
}

/** Archiving is owner-only: collaborators can edit the document, not its lifecycle. */
export const onRequestPatch: PagesFunction<Env, string, AccessData> = async ({ request, env, data }) => {
  return withBoardServiceErrors(async () => {
  const owner = signedInEmail(data)
  if (!owner) return json({ error: 'Private sign-in required.' }, 403)
  if (!accountMatchesRequest(request, owner)) return json({ error: 'The signed-in account changed.', code: 'account_changed' }, 409)

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

  if (requestsMetadata(new URL(request.url))) {
    const board = await ownedBoardMetadata(env, boardId, owner)
    if (!board) return json({ error: 'Unable to read the saved board.' }, 500)
    return json({ ok: true, archived, board: boardMetadata(board) })
  }

  const board = await ownedBoard(env, boardId, owner)
  if (!board) return json({ error: 'Unable to read the saved board.' }, 500)
  return json({ ok: true, archived, board: boardWithServerState(board) })
  })
}
