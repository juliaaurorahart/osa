import type { BoardSummary, SavedBoard } from '../graph/boardStorage'

/** One deliberately saved cloud board is refreshed in the background while open. */
export const CLOUD_AUTOSAVE_DELAY_MS = 1_500
export const CLOUD_REFRESH_INTERVAL_MS = 15_000

/** Saved board names are unique within the active list so the load target is unambiguous. */
export function boardNameAlreadyInUse(
  boards: readonly BoardSummary[],
  boardId: string,
  name: string,
) {
  const normalizedName = name.trim().toLocaleLowerCase()
  return boards.some((board) => (
    board.id !== boardId
    && board.name.trim().toLocaleLowerCase() === normalizedName
  ))
}

/** Keep board pickers compact even after opening an image-heavy board. */
export function boardSummary(savedBoard: SavedBoard): BoardSummary {
  return {
    id: savedBoard.id,
    name: savedBoard.name,
    updatedAt: savedBoard.updatedAt,
    archived: savedBoard.archived,
    revision: savedBoard.revision,
    access: savedBoard.access,
  }
}
