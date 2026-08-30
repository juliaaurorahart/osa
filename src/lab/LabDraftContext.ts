import { createContext } from 'react'
import type { LabDraftSource } from './labTypes'

export type LabDraftReader = LabDraftSource | (() => LabDraftSource | Promise<LabDraftSource>)
/** Editors publish native state; saving a recovery draft never promotes a saved file. */
export const LabDraftContext = createContext<((source: LabDraftReader) => void) | null>(null)
