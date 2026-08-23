import { parseBoardSnapshot, type BoardSnapshot } from './boardSnapshot'

export type SavedBoard = {
  id: string
  name: string
  updatedAt: string
  snapshot: BoardSnapshot
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
}

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

export class SharedAssemblyUnavailableError extends Error {
  constructor() {
    super('This shared assembly is unavailable.')
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
  }
}

async function responseError(response: Response): Promise<Error> {
  if (response.status === 401 || response.status === 403) return new BoardAccessError()
  if (response.status === 404) return new BoardUnavailableError()

  const body: unknown = await response.json().catch(() => null)
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
    if (error instanceof TypeError) throw new BoardAccessError()
    throw error
  }
}

export async function fetchBoards(): Promise<SavedBoard[]> {
  const response = await boardRequest('/api/boards', {
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

/** Saves one board without allowing a stale tab to replace somebody's list. */
export async function saveBoard(board: SavedBoard): Promise<void> {
  const response = await boardRequest('/api/boards', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ board }),
  })
  if (!response.ok) throw await responseError(response)
}

/** Creates an opaque, read-only link to one assembly on a saved private board. */
export async function createAssemblyShare(boardId: string, assemblyId: string): Promise<string> {
  const response = await boardRequest('/api/shares', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ boardId, assemblyId }),
  })
  if (!response.ok) throw await responseError(response)

  const body: unknown = await response.json()
  if (!isRecord(body) || typeof body.token !== 'string' || !body.token) {
    throw new Error('The board service returned an invalid share link.')
  }
  return (body as CreateShareResponse).token
}

/** Loads the saved board and assembly selected by a public, read-only share link. */
export async function fetchSharedAssembly(token: string): Promise<SharedAssembly> {
  let response: Response
  try {
    response = await fetch(`/shared/${encodeURIComponent(token)}`, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
      redirect: 'manual',
    })
  } catch (error) {
    if (error instanceof TypeError) throw new SharedAssemblyUnavailableError()
    throw error
  }

  if (!response.ok) {
    if (response.status === 404 || response.status === 400 || response.status === 0 || response.type === 'opaqueredirect') {
      throw new SharedAssemblyUnavailableError()
    }
    throw await responseError(response)
  }

  const body: unknown = await response.json().catch(() => null)
  if (!isRecord(body) || typeof body.assemblyId !== 'string') {
    throw new SharedAssemblyUnavailableError()
  }
  const board = parseSavedBoard(body.board)
  if (!board) throw new SharedAssemblyUnavailableError()

  return { board, assemblyId: body.assemblyId }
}
