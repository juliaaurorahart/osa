import './AssemblyViewControls.css'

type AssemblyViewControlsProps = {
  readOnly: boolean
  activeLockedCardId: string | null
  onUnlockCardView: () => void
}

/**
 * Keeps the Assembly document header quiet while retaining the one contextual
 * escape hatch needed when the card board is deliberately locked.
 */
export function AssemblyViewControls({
  readOnly,
  activeLockedCardId,
  onUnlockCardView,
}: AssemblyViewControlsProps) {
  return (
    <>
      <header className="work-view__header assembly-view__header">
        <div>
          <h1 id="assembly-view-title">Assembly</h1>
        </div>
        {readOnly ? <span className="assembly-view__shared-label">shared assembly · read-only</span> : null}
      </header>

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
