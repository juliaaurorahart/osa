import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react'
import { createBoardSnapshot } from '../graph/boardSnapshot'
import type { GraphEdge } from '../graph/graphEdge'
import type { TextFlowNode } from '../graph/textNode'
import type { BoardAccess } from '../graph/boardStorage'
import { LocalDraftIdentityError, writeLocalDraft } from './browserSession'

type LocalDraftPersistenceOptions = {
  identity: string | null
  enabled: boolean
  boardId: string
  boardName: string
  nodes: TextFlowNode[]
  edges: GraphEdge[]
  cloudRevision: number | null
  boardAccess: BoardAccess
  cloudDirty: boolean
  setDraftStatus: Dispatch<SetStateAction<string>>
}

/**
 * Keeps one compact browser recovery draft current.
 *
 * D1 synchronization remains separate: this hook only protects in-progress
 * work during ordinary editing, refreshes, and mobile browser lifecycle pauses.
 */
export function useLocalDraftPersistence({
  identity,
  enabled,
  boardId,
  boardName,
  nodes,
  edges,
  cloudRevision,
  boardAccess,
  cloudDirty,
  setDraftStatus,
}: LocalDraftPersistenceOptions) {
  const latestCloudState = useRef({ cloudRevision, boardAccess, cloudDirty })

  useEffect(() => {
    latestCloudState.current = { cloudRevision, boardAccess, cloudDirty }
  }, [boardAccess, cloudDirty, cloudRevision])

  useEffect(() => {
    if (!enabled) return
    setDraftStatus('Saving local draft…')
    const saveTimer = window.setTimeout(() => {
      try {
        writeLocalDraft({
          id: boardId,
          name: boardName,
          updatedAt: new Date().toISOString(),
          snapshot: createBoardSnapshot(nodes, edges),
          ...(cloudRevision === null ? {} : { revision: cloudRevision, access: boardAccess }),
          cloudDirty,
        }, identity)
        setDraftStatus(`Draft saved ${new Date().toLocaleTimeString([], {
          hour: 'numeric',
          minute: '2-digit',
          second: '2-digit',
        })}`)
      } catch (error) {
        setDraftStatus(error instanceof LocalDraftIdentityError
          ? error.message
          : 'Local draft could not save — download a backup')
      }
    }, 900)
    return () => window.clearTimeout(saveTimer)
  }, [
    boardAccess,
    boardId,
    boardName,
    cloudDirty,
    cloudRevision,
    edges,
    enabled,
    identity,
    nodes,
    setDraftStatus,
  ])

  useEffect(() => {
    if (!enabled) return

    const flushLocalDraft = () => {
      try {
        const latest = latestCloudState.current
        writeLocalDraft({
          id: boardId,
          name: boardName,
          updatedAt: new Date().toISOString(),
          snapshot: createBoardSnapshot(nodes, edges),
          ...(latest.cloudRevision === null
            ? {}
            : { revision: latest.cloudRevision, access: latest.boardAccess }),
          cloudDirty: latest.cloudDirty,
        }, identity)
      } catch {
        // The normal autosave status is where storage failures are reported.
      }
    }

    const flushWhenHidden = () => {
      if (document.visibilityState === 'hidden') flushLocalDraft()
    }

    window.addEventListener('pagehide', flushLocalDraft)
    document.addEventListener('visibilitychange', flushWhenHidden)
    return () => {
      window.removeEventListener('pagehide', flushLocalDraft)
      document.removeEventListener('visibilitychange', flushWhenHidden)
    }
  }, [boardId, boardName, edges, enabled, identity, nodes])
}
