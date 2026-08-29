import './AssemblyViewControls.css'

type AssemblyViewControlsProps = {
  readOnly: boolean
  activeLockedCardId: string | null
  onUnlockCardView: () => void
}

/**
 * Keeps the Assembly document chrome quiet while retaining the contextual
 * status needed for shared or deliberately locked card boards.
 */
export function AssemblyViewControls({
  readOnly,
  activeLockedCardId,
  onUnlockCardView,
}: AssemblyViewControlsProps) {
  return (
    <>
      {readOnly ? (
        <div className="assembly-view__access-status">
          <span className="assembly-view__shared-label">shared assembly · read-only</span>
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
