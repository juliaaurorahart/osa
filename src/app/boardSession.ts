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

export type BoardLoadSyncState = {
  cloudRevision: number | null
  cloudDirty: boolean
  cloudBaseline: string | null
  currentDocument: string
  untouchedDocument: string
}

/**
 * A known cloud board compares against its last acknowledged document. A
 * local-first board has no cloud baseline yet, so only real work—not the
 * untouched starter—must be created before another board replaces it.
 */
export function boardNeedsSyncBeforeLoad({
  cloudRevision,
  cloudDirty,
  cloudBaseline,
  currentDocument,
  untouchedDocument,
}: BoardLoadSyncState) {
  if (cloudRevision === null) return currentDocument !== untouchedDocument
  return cloudDirty || cloudBaseline === null || currentDocument !== cloudBaseline
}

/**
 * Finishes an existing autosave, then gives edits made during that request up
 * to two stable save passes before allowing a board switch. Returning false
 * keeps the current board and its one-browser recovery draft on screen.
 */
export async function syncCurrentBoardBeforeLoad({
  getPendingSave,
  hasUnsyncedChanges,
  saveCurrentBoard,
}: {
  getPendingSave: () => Promise<void> | null
  hasUnsyncedChanges: () => boolean
  saveCurrentBoard: () => Promise<boolean>
}) {
  const pendingSave = getPendingSave()
  if (pendingSave) await pendingSave

  for (let attempt = 0; attempt < 2 && hasUnsyncedChanges(); attempt += 1) {
    if (!await saveCurrentBoard()) return false
  }
  return !hasUnsyncedChanges()
}

/**
 * Reads the destination on both sides of the source sync. The first read
 * proves that the requested board is available before a potentially slow
 * save; the second prevents that save window from opening an older target.
 * If the source changes during the final read, the switch is cancelled so no
 * edit can be replaced before it reaches cloud storage.
 */
export async function prepareBoardForLoad<T>({
  readTarget,
  sourceStillOpen,
  secureSource,
  sourceNeedsSync,
}: {
  readTarget: () => Promise<T | null>
  sourceStillOpen: () => boolean
  secureSource: () => Promise<boolean>
  sourceNeedsSync: () => boolean
}): Promise<T | null> {
  const availableTarget = await readTarget()
  if (!availableTarget || !sourceStillOpen()) return null

  if (!await secureSource() || !sourceStillOpen()) return null

  const latestTarget = await readTarget()
  if (!latestTarget || !sourceStillOpen() || sourceNeedsSync()) return null
  return latestTarget
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
