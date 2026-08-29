import type { BoardAccess, BoardSummary, SavedBoard } from '../graph/boardStorage'
import { boardDocumentFingerprint } from '../graph/boardSnapshot'

/** One created or loaded cloud board is refreshed in the background while open. */
export const CLOUD_AUTOSAVE_DELAY_MS = 1_500
export const CLOUD_REFRESH_INTERVAL_MS = 15_000

export type AutomaticCloudBoardCreationState = {
  /** The private board list loaded successfully, proving this origin has a board API. */
  cloudBoardListReady: boolean
  isSharedAssembly: boolean
  cloudRevision: number | null
  boardAccess: BoardAccess
  hasCloudConflict: boolean
  savedBoardCount: number
  currentBoardIsUntouched: boolean
  alreadyAttempted: boolean
}

/**
 * Decides whether a local-first board should receive its D1 record now.
 *
 * An untouched startup canvas yields to an existing cloud board. Everything
 * else is created once the private board list proves cloud storage is
 * available. Plain Vite localhost never reaches that ready state, so it keeps
 * its normal local recovery draft without repeatedly calling a missing API.
 */
export function shouldCreateCloudBoardAutomatically({
  cloudBoardListReady,
  isSharedAssembly,
  cloudRevision,
  boardAccess,
  hasCloudConflict,
  savedBoardCount,
  currentBoardIsUntouched,
  alreadyAttempted,
}: AutomaticCloudBoardCreationState) {
  if (
    !cloudBoardListReady
    || isSharedAssembly
    || cloudRevision !== null
    || boardAccess === 'viewer'
    || hasCloudConflict
    || alreadyAttempted
  ) return false

  return savedBoardCount === 0 || !currentBoardIsUntouched
}

/** A lost create response is safe to adopt only when D1 has the exact document. */
export function isAcknowledgedAutomaticCloudCreate(
  attemptedBoard: SavedBoard,
  existingBoard: SavedBoard,
) {
  return existingBoard.id === attemptedBoard.id
    && !existingBoard.archived
    && boardDocumentFingerprint(existingBoard.name, existingBoard.snapshot)
      === boardDocumentFingerprint(attemptedBoard.name, attemptedBoard.snapshot)
}

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
