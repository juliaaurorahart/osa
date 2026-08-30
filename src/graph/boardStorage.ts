import { parseBoardSnapshot, type BoardSnapshot } from './boardSnapshot'
import { prepareDocumentAssets, scopeLegacyAssets } from './portableAssets'
import { requestAccountHeaders } from './requestAccount'

export type SavedBoard = {
  id: string
  name: string
  updatedAt: string
  snapshot: BoardSnapshot
  /** Present on boards read from D1; omitted by unsaved local board drafts. */
  archived?: boolean
  /** D1 increments this on every cloud change so stale devices cannot overwrite newer work. */
  revision?: number
  /** The signed-in person's server-authorized role for this board. */
  access?: BoardAccess
}

/**
 * The small, durable identity of a saved board. Board pickers only need this
 * metadata; loading a board's image-heavy snapshot is a separate request.
 */
export type BoardSummary = Omit<SavedBoard, 'snapshot'>

export type BoardAccess = 'owner' | 'editor' | 'viewer'
export type CollaboratorRole = Exclude<BoardAccess, 'owner'>
export type BoardCollaborator = { email: string; role: CollaboratorRole }

/** A public, read-only board response addressed by an opaque share token. */
export type SharedAssembly = {
  board: SavedBoard
  assemblyId: string
}

type BoardsResponse = {
  boards: SavedBoard[]
}

type BoardSummariesResponse = {
  boards: BoardSummary[]
}

type CreateShareResponse = {
  token: string
  slug: string | null
}

export type AssemblyShare = CreateShareResponse

export class BoardAccessError extends Error {
  constructor(message = 'Sign in to access saved boards.') {
    super(message)
    this.name = 'BoardAccessError'
  }
}

export class BoardUnavailableError extends Error {
  constructor() {
    super('Board storage is unavailable in this environment.')
    this.name = 'BoardUnavailableError'
  }
}

/** The browser caught an oversized document before D1 can reject the save. */
export class BoardSizeError extends Error {
  constructor() {
    super('This board is too large to save. Remove or replace some photos.')
    this.name = 'BoardSizeError'
  }
}

/** The account is signed in but lacks permission for the requested board action. */
export class BoardPermissionError extends Error {
  constructor(message = 'You do not have permission to change this board.') {
    super(message)
    this.name = 'BoardPermissionError'
  }
}

/** The board changed on another device while this browser still had an older version. */
export class BoardConflictError extends Error {
  readonly board: SavedBoard

  constructor(board: SavedBoard) {
    super('This board changed on another device.')
    this.name = 'BoardConflictError'
    this.board = board
  }
}

export class SharedAssemblyUnavailableError extends Error {
  constructor(message = 'This shared assembly is unavailable.') {
    super(message)
    this.name = 'SharedAssemblyUnavailableError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseBoardSummary(value: unknown): BoardSummary | null {
  if (
    !isRecord(value)
    || typeof value.id !== 'string'
    || typeof value.name !== 'string'
    || typeof value.updatedAt !== 'string'
  ) return null
  return {
    id: value.id,
    name: value.name,
    updatedAt: value.updatedAt,
    archived: typeof value.archived === 'boolean' ? value.archived : false,
    revision: typeof value.revision === 'number'
      && Number.isInteger(value.revision)
      && value.revision > 0
      ? value.revision
      : undefined,
    access: value.access === 'owner' || value.access === 'editor' || value.access === 'viewer'
      ? value.access
      : undefined,
  }
}

function parseSavedBoard(value: unknown): SavedBoard | null {
  const summary = parseBoardSummary(value)
  if (!summary || !isRecord(value)) return null
  const snapshot = parseBoardSnapshot(value.snapshot)
  if (!snapshot) return null
  return { ...summary, snapshot: scopeLegacyAssets(snapshot, summary.id) }
}

type RawBoardServerState = Pick<Required<BoardSummary>, 'id' | 'name' | 'updatedAt' | 'archived' | 'revision' | 'access'>

function decodeRawBoardHeader(value: string | null) {
  if (value === null) return null
  try {
    const decoded = decodeURIComponent(value)
    return decoded || null
  } catch {
    return null
  }
}

function parseRawBoardServerState(headers: Headers): RawBoardServerState | null {
  const id = headers.get('x-osa-board-id')
  const name = decodeRawBoardHeader(headers.get('x-osa-board-name'))
  const updatedAt = headers.get('x-osa-board-updated-at')
  const revisionText = headers.get('x-osa-board-revision')
  const access = headers.get('x-osa-board-access')
  const archived = headers.get('x-osa-board-archived')
  const revision = revisionText === null ? NaN : Number(revisionText)
  if (
    !id
    || !name
    || !updatedAt
    || !Number.isSafeInteger(revision)
    || revision < 1
    || (access !== 'owner' && access !== 'editor' && access !== 'viewer')
    || (archived !== 'true' && archived !== 'false')
  ) return null
  return { id, name, updatedAt, revision, access, archived: archived === 'true' }
}

/** Applies authoritative response headers to one raw JSON board document. */
function applyRawBoardServerState(board: SavedBoard, headers: Headers): SavedBoard | null {
  const state = parseRawBoardServerState(headers)
  // A mismatched identifier would mean the response cannot safely be applied
  // to the board the caller requested or saved.
  if (!state || state.id !== board.id) return null
  return { ...board, ...state }
}

async function responseError(response: Response): Promise<Error> {
  if (response.status === 401) return new BoardAccessError()
  if (response.status === 404) return new BoardUnavailableError()

  const body: unknown = await response.json().catch(() => null)
  if (response.status === 409 && isRecord(body) && body.code === 'account_changed') {
    return new BoardAccessError('Your signed-in account changed. Save a backup, then sign in again.')
  }
  if (response.status === 403) {
    const message = isRecord(body) && typeof body.error === 'string' ? body.error : ''
    return message === 'Private sign-in required.'
      ? new BoardAccessError()
      : new BoardPermissionError(message || undefined)
  }
  if (response.status === 409 && isRecord(body)) {
    const conflictingBoard = isRecord(body.board)
      ? parseSavedBoard(body.board)
      : parseSavedBoard(body)
    if (conflictingBoard) return new BoardConflictError(conflictingBoard)
  }
  const message = isRecord(body) && typeof body.error === 'string'
    ? body.error
    : `Board request failed (${response.status}).`
  return new Error(message)
}

async function boardRequest(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  try {
    const headers = new Headers(init?.headers)
    for (const [name, value] of Object.entries(requestAccountHeaders())) headers.set(name, value)
    const response = await fetch(input, { ...init, headers, redirect: 'manual' })
    // Cloudflare Access uses an interactive cross-origin redirect. A fetch
    // cannot complete that login, but a normal link to /api/login can.
    if (response.type === 'opaqueredirect' || response.status === 0) {
      throw new BoardAccessError()
    }
    return response
  } catch (error) {
    if (error instanceof BoardAccessError) throw error
    // A normal browser network failure also arrives as TypeError. It is not
    // proof that the person needs to sign in, and cloud autosave must keep
    // the local recovery draft instead of suggesting the wrong fix.
    if (error instanceof TypeError) throw new BoardUnavailableError()
    throw error
  }
}

export type BoardListOptions = {
  /** Default false. Archived boards are opt-in so normal board screens stay uncluttered. */
  archived?: boolean
}

function boardListQuery(options: BoardListOptions, metadataOnly = false) {
  const query = new URLSearchParams()
  if (metadataOnly) query.set('metadata', 'true')
  if (options.archived) query.set('archived', 'true')
  const encoded = query.toString()
  return encoded ? `?${encoded}` : ''
}

/**
 * Reads only board identity and server state. This avoids expanding every
 * image-heavy snapshot just to populate a board picker. Older servers safely
 * return their full board objects here; the parser intentionally extracts
 * only the metadata until the thin endpoint has rolled out.
 */
export async function fetchBoardSummaries(options: BoardListOptions = {}): Promise<BoardSummary[]> {
  const response = await boardRequest(`/api/boards${boardListQuery(options, true)}`, {
    headers: { accept: 'application/json' },
  })
  if (!response.ok) throw await responseError(response)

  const body: unknown = await response.json()
  if (!isRecord(body) || !Array.isArray(body.boards)) {
    throw new Error('The board service returned invalid data.')
  }
  const boards = body.boards.map(parseBoardSummary)
  if (boards.some((board) => board === null)) {
    throw new Error('The board service returned invalid data.')
  }
  return boards as BoardSummariesResponse['boards']
}

/** Loads normal boards by default, or archived boards with `{ archived: true }`. */
export async function fetchBoards(options: BoardListOptions = {}): Promise<SavedBoard[]> {
  const response = await boardRequest(`/api/boards${boardListQuery(options)}`, {
    headers: { accept: 'application/json' },
  })
  if (!response.ok) throw await responseError(response)

  const body: unknown = await response.json()
  if (!isRecord(body) || !Array.isArray(body.boards)) {
    throw new Error('The board service returned invalid data.')
  }
  const boards = body.boards.map(parseSavedBoard)
  if (boards.some((board) => board === null)) {
    throw new Error('The board service returned invalid data.')
  }
  return boards as BoardsResponse['boards']
}

/** Convenience helper for an Archive screen without changing the normal list API. */
export async function fetchArchivedBoards(): Promise<SavedBoard[]> {
  return fetchBoards({ archived: true })
}

/** Loads one current board for cross-device refresh and conflict recovery. */
export async function fetchBoard(boardId: string): Promise<SavedBoard | null> {
  const response = await boardRequest(`/api/boards?id=${encodeURIComponent(boardId)}&raw=true`, {
    headers: { accept: 'application/json' },
  })
  if (response.status === 404) return null
  if (!response.ok) throw await responseError(response)

  const body: unknown = await response.json()
  // Pre-thin deployments ignore `raw=true` and retain the envelope. Current
  // deployments return the stored board document directly with D1 state in
  // headers, avoiding a server-side parse/stringify of the same large JSON.
  const legacyBoard = isRecord(body) ? parseSavedBoard(body.board) : null
  const rawBoard = legacyBoard === null ? parseSavedBoard(body) : null
  const board = rawBoard === null
    ? legacyBoard
    : applyRawBoardServerState(rawBoard, response.headers)
  if (!board) throw new Error('The board service returned invalid data.')
  return board
}

type RawSaveAttempt =
  | { kind: 'saved'; board: SavedBoard }
  | { kind: 'legacy-server' }

// A pre-deployment server returns one known no-op validation error for a raw
// save. Remember that result for this tab so legacy deployments do not pay
// for a failed request before every normal autosave.
let rawSaveTransportAvailable: boolean | undefined

/**
 * D1 has a 2 MB row limit. Leave room for protocol overhead and avoid making
 * a person wait through an upload that the database will reject.
 */
export const MAX_BOARD_DOCUMENT_BYTES = 1_700_000

function boardDocumentForRawSave(board: SavedBoard) {
  const document: SavedBoard & { baseRevision?: unknown } = { ...board }
  delete document.archived
  delete document.revision
  delete document.access
  delete document.baseRevision
  return document
}

function serializedBoardDocumentForRawSave(board: SavedBoard) {
  const serialized = JSON.stringify(boardDocumentForRawSave(board))
  if (new TextEncoder().encode(serialized).byteLength > MAX_BOARD_DOCUMENT_BYTES) {
    throw new BoardSizeError()
  }
  return serialized
}

function rawSaveHeaders(board: SavedBoard, baseRevision: number | null | undefined) {
  return {
    'content-type': 'application/vnd.osa.board+json',
    'x-osa-board-id': board.id,
    // Header values must remain ASCII-safe. The worker decodes this value
    // before storing the ordinary readable board name in D1.
    'x-osa-board-name': encodeURIComponent(board.name),
    'x-osa-board-updated-at': board.updatedAt,
    ...(baseRevision === undefined
      ? {}
      : { 'x-osa-base-revision': baseRevision === null ? 'null' : String(baseRevision) }),
  }
}

function rawTransportIsNotDeployed(response: Response, body: unknown) {
  // The prior endpoint parses this raw document but expects `{ board }`, then
  // returns this exact validation response without writing anything. Limit
  // fallback to that known no-op so an actual rejected raw save never becomes
  // a second, unguarded write.
  return response.status === 400
    && isRecord(body)
    && body.error === 'Expected a board.'
}

/**
 * The raw worker deliberately keeps conflict responses small. Only after a
 * real revision collision do we fetch the one current board document needed
 * by the existing reload/save-a-copy recovery UI.
 */
async function rawConflictError(body: unknown): Promise<BoardConflictError | null> {
  if (
    !isRecord(body)
    || (body.code !== 'stale' && body.code !== 'archived')
    || !isRecord(body.board)
  ) return null

  // Legacy workers already include the full conflicting board. Let
  // `responseError` parse that established response shape below.
  if (parseSavedBoard(body.board)) return null

  const summary = parseBoardSummary(body.board)
  if (!summary) return null
  const currentBoard = await fetchBoard(summary.id)
  if (!currentBoard) {
    throw new Error('The newer board version is unavailable.')
  }
  return new BoardConflictError(currentBoard)
}

/**
 * Uses the compact raw document protocol when its worker is deployed. A
 * successful response is 204 with metadata headers, so autosave does not
 * download its own complete snapshot just to learn the next revision.
 */
async function saveBoardRaw(
  board: SavedBoard,
  baseRevision: number | null | undefined,
  serializedBoardDocument: string,
): Promise<RawSaveAttempt> {
  const response = await boardRequest('/api/boards', {
    method: 'PUT',
    headers: rawSaveHeaders(board, baseRevision),
    body: serializedBoardDocument,
  })

  if (response.status === 204) {
    const savedBoard = applyRawBoardServerState(board, response.headers)
    if (!savedBoard) throw new Error('The board service returned an invalid save acknowledgement.')
    return { kind: 'saved', board: savedBoard }
  }

  if (!response.ok) {
    const body: unknown = await response.clone().json().catch(() => null)
    if (rawTransportIsNotDeployed(response, body)) return { kind: 'legacy-server' }
    if (response.status === 409) {
      const conflict = await rawConflictError(body)
      if (conflict) throw conflict
    }
    throw await responseError(response)
  }

  // Accept a transitional worker that recognizes the raw request but still
  // returns the older `{ board }` envelope.
  const body: unknown = await response.json().catch(() => null)
  const savedBoard = isRecord(body) ? parseSavedBoard(body.board) : null
  if (!savedBoard) throw new Error('The board service returned invalid data.')
  return { kind: 'saved', board: savedBoard }
}

/**
 * Saves a board against the revision this browser last loaded. `null` creates
 * a new cloud board; a number means “only if it is still this version.”
 */
export async function saveBoard(
  board: SavedBoard,
  baseRevision: number | null | undefined = undefined,
): Promise<SavedBoard> {
  // Do this before either transport path. The old JSON-envelope fallback is
  // only a few bytes larger than this raw document and still has D1 headroom.
  const serializedBoardDocument = serializedBoardDocumentForRawSave(board)
  if (rawSaveTransportAvailable !== false) {
    const rawAttempt = await saveBoardRaw(board, baseRevision, serializedBoardDocument)
    if (rawAttempt.kind === 'saved') {
      rawSaveTransportAvailable = true
      return rawAttempt.board
    }
    rawSaveTransportAvailable = false
  }

  // Older open deployments do not understand the raw document contract yet.
  // Their fallback remains exactly the established API shape.
  const response = await boardRequest('/api/boards', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ board, baseRevision }),
  })
  if (!response.ok) throw await responseError(response)

  const body: unknown = await response.json()
  const savedBoard = isRecord(body) ? parseSavedBoard(body.board) : null
  if (!savedBoard) throw new Error('The board service returned invalid data.')
  return savedBoard
}

/** Reserve ownership before uploading files; notify callers so failed uploads can resume. */
export async function saveBoardWithAssets(
  board: SavedBoard,
  baseRevision: number | null,
  onProvisioned?: (board: SavedBoard) => void,
): Promise<SavedBoard> {
  let revision = baseRevision
  if (revision === null) {
    const scaffold = { ...board, snapshot: { ...board.snapshot, nodes: [], edges: [] } }
    let provisioned: SavedBoard
    try { provisioned = await saveBoard(scaffold, null) } catch (error) {
      // A lost create response can be recovered only when the reserved board is still empty.
      if (!(error instanceof BoardConflictError) || error.board.name !== board.name
        || error.board.snapshot.nodes.length || error.board.snapshot.edges.length || error.board.archived) throw error
      provisioned = error.board
    }
    revision = provisioned.revision ?? null
    if (revision === null) throw new Error('Board storage did not acknowledge its revision.')
    onProvisioned?.(provisioned)
  }
  const snapshot = await prepareDocumentAssets(board.snapshot, board.id)
  return saveBoard({ ...board, snapshot }, revision)
}

/** Moves a board into the archive, preserving its data and public share links. */
export async function archiveBoard(boardId: string): Promise<SavedBoard> {
  return setBoardArchived(boardId, true, false)
}

/** Returns an archived board to the normal saved-board list. */
export async function restoreBoard(boardId: string): Promise<SavedBoard> {
  return setBoardArchived(boardId, false, false)
}

/**
 * Archives without downloading the board snapshot. Use this for a board-list
 * row; the normal `archiveBoard` remains for callers that already expect the
 * full document after the lifecycle change.
 */
export async function archiveBoardSummary(boardId: string): Promise<BoardSummary> {
  return setBoardArchived(boardId, true, true)
}

/** Restores a board-list row without expanding its snapshot. */
export async function restoreBoardSummary(boardId: string): Promise<BoardSummary> {
  return setBoardArchived(boardId, false, true)
}

async function setBoardArchived(
  boardId: string,
  archived: boolean,
  metadataOnly: true,
): Promise<BoardSummary>
async function setBoardArchived(
  boardId: string,
  archived: boolean,
  metadataOnly: false,
): Promise<SavedBoard>
async function setBoardArchived(
  boardId: string,
  archived: boolean,
  metadataOnly: boolean,
): Promise<BoardSummary | SavedBoard> {
  const query = metadataOnly ? '?metadata=true' : ''
  const response = await boardRequest(`/api/boards${query}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ boardId, archived }),
  })
  if (!response.ok) throw await responseError(response)

  const body: unknown = await response.json().catch(() => null)
  if (!isRecord(body)) throw new Error('The board service returned invalid data.')
  if (metadataOnly) {
    const board = parseBoardSummary(body.board)
    if (!board) throw new Error('The board service returned invalid data.')
    return board
  }
  const board = parseSavedBoard(body.board)
  if (!board) throw new Error('The board service returned invalid data.')
  return board
}

/** Creates a public, read-only link to one assembly on a saved private board. */
export async function createAssemblyShare(
  boardId: string,
  assemblyId: string,
  slug: string,
): Promise<AssemblyShare> {
  const response = await boardRequest('/api/shares', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ boardId, assemblyId, slug }),
  })
  if (!response.ok) throw await responseError(response)

  const body: unknown = await response.json()
  if (
    !isRecord(body)
    || typeof body.token !== 'string'
    || !body.token
    || (body.slug !== null && typeof body.slug !== 'string')
  ) {
    throw new Error('The board service returned an invalid share link.')
  }
  return body as AssemblyShare
}

function parseCollaborator(value: unknown): BoardCollaborator | null {
  if (
    !isRecord(value)
    || typeof value.email !== 'string'
    || (value.role !== 'editor' && value.role !== 'viewer')
  ) return null
  return { email: value.email, role: value.role }
}

/** Lists people with access. The owner is implicit and is not duplicated here. */
export async function fetchBoardCollaborators(boardId: string): Promise<BoardCollaborator[]> {
  const response = await boardRequest(`/api/collaborators?boardId=${encodeURIComponent(boardId)}`, {
    headers: { accept: 'application/json' },
  })
  if (!response.ok) throw await responseError(response)

  const body: unknown = await response.json()
  if (!isRecord(body) || !Array.isArray(body.collaborators)) {
    throw new Error('The board service returned invalid collaborators.')
  }
  const collaborators = body.collaborators.map(parseCollaborator)
  if (collaborators.some((collaborator) => collaborator === null)) {
    throw new Error('The board service returned invalid collaborators.')
  }
  return collaborators as BoardCollaborator[]
}

/** Adds a person or changes their editor/viewer role. Owner-only on the server. */
export async function saveBoardCollaborator(
  boardId: string,
  email: string,
  role: CollaboratorRole,
): Promise<BoardCollaborator> {
  const response = await boardRequest('/api/collaborators', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ boardId, email, role }),
  })
  if (!response.ok) throw await responseError(response)

  const body: unknown = await response.json()
  const collaborator = isRecord(body) ? parseCollaborator(body.collaborator) : null
  if (!collaborator) throw new Error('The board service returned an invalid collaborator.')
  return collaborator
}

/** Removes one person's board access. Owner-only on the server. */
export async function removeBoardCollaborator(boardId: string, email: string): Promise<void> {
  const response = await boardRequest('/api/collaborators', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ boardId, email }),
  })
  if (!response.ok) throw await responseError(response)
}

/** Loads the saved board and assembly selected by a public, read-only share link. */
export async function fetchSharedAssembly(reference: string): Promise<SharedAssembly> {
  let response: Response
  try {
    response = await fetch(`/shared/${encodeURIComponent(reference)}`, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
      redirect: 'manual',
    })
  } catch (error) {
    if (error instanceof TypeError) throw new SharedAssemblyUnavailableError()
    throw error
  }

  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null)
    const message = isRecord(body) && typeof body.error === 'string'
      ? body.error
      : 'This shared assembly is unavailable.'
    if (
      response.status === 404
      || response.status === 400
      || response.status >= 500
      || response.status === 0
      || response.type === 'opaqueredirect'
    ) {
      throw new SharedAssemblyUnavailableError(message)
    }
    throw new Error(message)
  }

  const body: unknown = await response.json().catch(() => null)
  if (!isRecord(body) || typeof body.assemblyId !== 'string') {
    throw new SharedAssemblyUnavailableError()
  }
  const board = parseSavedBoard(body.board)
  if (!board) throw new SharedAssemblyUnavailableError()

  return { board, assemblyId: body.assemblyId }
}
