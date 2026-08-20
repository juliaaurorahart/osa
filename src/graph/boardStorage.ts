import { isBoardSnapshot, type BoardSnapshot } from './boardSnapshot'

export type SavedBoard = {
  id: string
  name: string
  updatedAt: string
  snapshot: BoardSnapshot
}

type BoardsResponse = {
  boards: SavedBoard[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isSavedBoard(value: unknown): value is SavedBoard {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.name === 'string'
    && typeof value.updatedAt === 'string'
    && isBoardSnapshot(value.snapshot)
}

async function responseError(response: Response): Promise<Error> {
  const body: unknown = await response.json().catch(() => null)
  const message = isRecord(body) && typeof body.error === 'string'
    ? body.error
    : `Board request failed (${response.status}).`
  return new Error(message)
}

export async function fetchBoards(): Promise<SavedBoard[]> {
  const response = await fetch('/api/boards', {
    headers: { accept: 'application/json' },
  })
  if (!response.ok) throw await responseError(response)

  const body: unknown = await response.json()
  if (!isRecord(body) || !Array.isArray(body.boards) || !body.boards.every(isSavedBoard)) {
    throw new Error('The board service returned invalid data.')
  }

  return (body as BoardsResponse).boards
}

/** The current API stores the complete board list as one atomic replacement. */
export async function replaceBoards(boards: SavedBoard[]): Promise<void> {
  const response = await fetch('/api/boards', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ boards }),
  })
  if (!response.ok) throw await responseError(response)
}
