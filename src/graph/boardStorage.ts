import { parseBoardSnapshot, type BoardSnapshot } from './boardSnapshot'

export type SavedBoard = {
  id: string
  name: string
  updatedAt: string
  snapshot: BoardSnapshot
  /** Present on boards read from D1; omitted by unsaved local board drafts. */
  archived?: boolean
  /** D1 increments this on every cloud change so stale devices cannot overwrite newer work. */
  revision?: number
}

/** A public, read-only board response addressed by an opaque share token. */
export type SharedAssembly = {
  board: SavedBoard
  assemblyId: string
}

type BoardsResponse = {
  boards: SavedBoard[]
}

type CreateShareResponse = {
  token: string
  slug: string | null
}

export type AssemblyShare = CreateShareResponse

export class BoardAccessError extends Error {
  constructor() {
    super('Sign in to access saved boards.')
    this.name = 'BoardAccessError'
  }
}

export class BoardUnavailableError extends Error {
  constructor() {
    super('Board storage is unavailable in this environment.')
    this.name = 'BoardUnavailableError'
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

function parseSavedBoard(value: unknown): SavedBoard | null {
  if (
    !isRecord(value)
    || typeof value.id !== 'string'
    || typeof value.name !== 'string'
    || typeof value.updatedAt !== 'string'
  ) return null
  const snapshot = parseBoardSnapshot(value.snapshot)
  if (!snapshot) return null
  return {
    id: value.id,
    name: value.name,
    updatedAt: value.updatedAt,
    snapshot,
    archived: typeof value.archived === 'boolean' ? value.archived : false,
    revision: typeof value.revision === 'number'
      && Number.isInteger(value.revision)
      && value.revision > 0
      ? value.revision
      : undefined,
  }
}

async function responseError(response: Response): Promise<Error> {
  if (response.status === 401 || response.status === 403) return new BoardAccessError()
  if (response.status === 404) return new BoardUnavailableError()

  const body: unknown = await response.json().catch(() => null)
  if (response.status === 409 && isRecord(body)) {
    const conflictingBoard = parseSavedBoard(body.board)
    if (conflictingBoard) return new BoardConflictError(conflictingBoard)
  }
  const message = isRecord(body) && typeof body.error === 'string'
    ? body.error
    : `Board request failed (${response.status}).`
  return new Error(message)
}

async function boardRequest(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  try {
    const response = await fetch(input, { ...init, redirect: 'manual' })
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

/** Loads normal boards by default, or archived boards with `{ archived: true }`. */
export async function fetchBoards(options: BoardListOptions = {}): Promise<SavedBoard[]> {
  const query = options.archived ? '?archived=true' : ''
  const response = await boardRequest(`/api/boards${query}`, {
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
  const response = await boardRequest(`/api/boards?id=${encodeURIComponent(boardId)}`, {
    headers: { accept: 'application/json' },
  })
  if (response.status === 404) return null
  if (!response.ok) throw await responseError(response)

  const body: unknown = await response.json()
  const board = isRecord(body) ? parseSavedBoard(body.board) : null
  if (!board) throw new Error('The board service returned invalid data.')
  return board
}

/**
 * Saves a board against the revision this browser last loaded. `null` creates
 * a new cloud board; a number means “only if it is still this version.”
 */
export async function saveBoard(
  board: SavedBoard,
  baseRevision: number | null | undefined = undefined,
): Promise<SavedBoard> {
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

/** Moves a board into the archive, preserving its data and public share links. */
export async function archiveBoard(boardId: string): Promise<SavedBoard> {
  return setBoardArchived(boardId, true)
}

/** Returns an archived board to the normal saved-board list. */
export async function restoreBoard(boardId: string): Promise<SavedBoard> {
  return setBoardArchived(boardId, false)
}

async function setBoardArchived(boardId: string, archived: boolean): Promise<SavedBoard> {
  const response = await boardRequest('/api/boards', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ boardId, archived }),
  })
  if (!response.ok) throw await responseError(response)

  const body: unknown = await response.json().catch(() => null)
  const board = isRecord(body) ? parseSavedBoard(body.board) : null
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
