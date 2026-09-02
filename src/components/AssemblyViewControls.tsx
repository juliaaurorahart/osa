import './AssemblyViewControls.css'

type AssemblyViewControlsProps = {
  readOnly: boolean
  activeLockedCardId: string | null
  onUnlockCardView: () => void
  onBackToSpace?: () => void
  onBackToAssembly?: () => void
}

/**
 * Keeps the Assembly document chrome quiet while retaining the contextual
 * status needed for shared or deliberately locked card boards.
 */
export function AssemblyViewControls({
  readOnly,
  activeLockedCardId,
  onUnlockCardView,
  onBackToSpace,
  onBackToAssembly,
}: AssemblyViewControlsProps) {
  return (
    <>
      {onBackToSpace ? (
        <nav className="assembly-view__workspace-navigation" aria-label="Assembly workspace navigation">
          <button
            className="assembly-view__workspace-exit"
            type="button"
            aria-label="Back to Space workspace"
            onClick={onBackToSpace}
          >
            <span aria-hidden="true">←</span> Back to Space
          </button>
        </nav>
      ) : null}

      {readOnly ? (
        <div className="assembly-view__access-status">
          {onBackToAssembly ? (
            <button className="text-action" type="button" onClick={onBackToAssembly}>
              back to Assembly
            </button>
          ) : null}
          <span className="assembly-view__shared-label">
            {onBackToAssembly ? 'preview · read-only' : 'shared assembly · read-only'}
          </span>
        </div>
      ) : null}

      {activeLockedCardId ? (
        <div className="assembly-view__lock-status" aria-live="polite">
          <span>single-card view locked</span>
          <button
            className="text-action"
            type="button"
            aria-pressed={true}
            aria-label="unlock the Assembly card board and show all cards"
            onClick={onUnlockCardView}
          >
            unlock card view
          </button>
        </div>
      ) : null}
    </>
  )
}
