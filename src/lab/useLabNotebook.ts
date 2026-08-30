export type LabNotebookStatus = 'loading' | 'ready' | 'saving' | 'saved' | 'error'

/** Compatibility name: all notebook entry points now use the same OSA graph cache. */
export { useSyncedLabNotebook as useLabNotebook } from './useSyncedLabNotebook'
