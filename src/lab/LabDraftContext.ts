import { createContext } from 'react'
import type { LabDraftSource } from './labTypes'

export type LabDraftReader = LabDraftSource | (() => LabDraftSource | Promise<LabDraftSource>)
/** A hosted editor must checkpoint its native source before the section closes it. */
export type LabEditorDraftSession = {
  registerCheckpoint: (checkpoint: (() => Promise<void>) | null) => void
  onStarted: () => void
  saveDraft: () => Promise<void>
  close: () => Promise<void>
}
/** Editors publish native state; saving a recovery draft never promotes a saved file. */
export const LabDraftContext = createContext<((source: LabDraftReader) => void) | null>(null)
