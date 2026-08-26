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
  /**
   * The card whose full authoring controls are currently open. Keeping this
   * separate from focus lets Assembly stay a compact, preview-like document
   * until someone deliberately opens one card to edit it.
   */
  openCardId: string | null
  lockedCardId: string | null
  /** The Visual in the temporary canvas editor overlay; never saved as project data. */
  editingVisualId: string | null
  /** The card that opened the Visual editor; node-card canvases leave this null. */
  editingOperationId: string | null
  drawingCardId: string | null
  toolDraft: string
  toolDraftFor: AssemblyToolDraft | null
  /** Per-card presentation only: hiding a canvas never changes graph data. */
  hiddenVisualOwnerIdsByOperation: Record<string, string[]>
}

/** Creates the normal, unlocked Assembly screen state for a new app session. */
export function createAssemblyViewUiState(): AssemblyViewUiState {
  return {
    focusedCardId: 'assembly-index',
    openCardId: null,
    lockedCardId: null,
    editingVisualId: null,
    editingOperationId: null,
    drawingCardId: null,
    toolDraft: '',
    toolDraftFor: null,
    hiddenVisualOwnerIdsByOperation: {},
  }
}
