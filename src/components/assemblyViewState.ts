/**
 * Temporary Assembly screen state. It deliberately stays outside BoardSnapshot:
 * it should survive switching views in one browser session, but should not
 * become durable project data.
 */
export type AssemblyToolDraft = {
  operationId: string
  placeholder: boolean
}

export type AssemblyViewUiState = {
  focusedCardId: string
  lockedCardId: string | null
  /** The Visual being edited over this Assembly card; never saved as project data. */
  editingVisualId: string | null
  /** The specific card that opened the Visual editor; also temporary UI state. */
  editingOperationId: string | null
  drawingCardId: string | null
  toolDraft: string
  toolDraftFor: AssemblyToolDraft | null
}

/** Creates the normal, unlocked Assembly screen state for a new app session. */
export function createAssemblyViewUiState(): AssemblyViewUiState {
  return {
    focusedCardId: 'assembly-index',
    lockedCardId: null,
    editingVisualId: null,
    editingOperationId: null,
    drawingCardId: null,
    toolDraft: '',
    toolDraftFor: null,
  }
}
