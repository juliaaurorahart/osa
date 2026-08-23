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
  drawingCardId: string | null
  toolDraft: string
  toolDraftFor: AssemblyToolDraft | null
}

/** Creates the normal, unlocked Assembly screen state for a new app session. */
export function createAssemblyViewUiState(): AssemblyViewUiState {
  return {
    focusedCardId: 'assembly-index',
    lockedCardId: null,
    drawingCardId: null,
    toolDraft: '',
    toolDraftFor: null,
  }
}
