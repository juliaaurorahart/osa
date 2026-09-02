import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type PointerEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import {
  ASSEMBLY_PEOPLE_THRESHOLD_MAX,
  ASSEMBLY_PEOPLE_THRESHOLD_MIN,
  normalizeAssemblyPeopleThreshold,
  type AssemblyPeopleDisplay,
  type OsaTheme,
} from '../app/browserSession'
import type {
  BoardAccess,
  BoardCollaborator,
  BoardSummary,
  CollaboratorRole,
} from '../graph/boardStorage'
import './WorkspaceSettingsMenu.css'

export type WorkspaceSettingsAction = () => void | Promise<void>
export type WorkspaceSettingsFileHandler = (
  event: ChangeEvent<HTMLInputElement>,
) => void | Promise<void>

/**
 * App state and actions presented by the settings dialog.
 *
 * The component deliberately owns only temporary UI state (open/closed and
 * the collaborator form). Board, cloud, sharing, and backup state continue to
 * belong to App so opening Settings cannot create a second source of truth.
 */
export type WorkspaceSettingsMenuProps = {
  triggerLabel?: string
  theme: OsaTheme
  onToggleTheme: () => void
  assemblyPeopleDisplay: AssemblyPeopleDisplay
  onAssemblyPeopleDisplayChange: (display: AssemblyPeopleDisplay) => void
  assemblyPeopleThreshold: number
  onAssemblyPeopleThresholdChange: (threshold: number) => void
  onOpenChange?: (open: boolean) => void

  boardId: string
  boardName: string
  boardAccess: BoardAccess
  savedBoards: readonly BoardSummary[]
  archivedBoards: readonly BoardSummary[]
  selectedBoardId: string
  showingArchivedBoards: boolean
  canArchiveCurrentBoard: boolean
  onBoardNameChange: (name: string) => void
  onSelectedBoardIdChange: (boardId: string) => void
  onShowSavedBoards: WorkspaceSettingsAction
  onShowArchivedBoards: WorkspaceSettingsAction
  onLoadSelectedBoard: WorkspaceSettingsAction
  onArchiveCurrentBoard: WorkspaceSettingsAction
  onRestoreSelectedBoard: WorkspaceSettingsAction
  onManualSync: WorkspaceSettingsAction
  onUseLocalCopy?: WorkspaceSettingsAction

  storageStatus?: string
  cloudSyncStatus?: string
  localDraftStatus?: string
  cloudRevision?: number | null
  needsSignIn?: boolean
  signInHref?: string
  cloudConflictBoard?: BoardSummary | null
  onReloadCloudBoard?: WorkspaceSettingsAction
  onSaveBoardAsCopy?: WorkspaceSettingsAction

  collaborators: readonly BoardCollaborator[]
  collaborationStatus?: string
  onAddCollaborator?: (
    email: string,
    role: CollaboratorRole,
  ) => void | Promise<void>
  onRemoveCollaborator?: (email: string) => void | Promise<void>

  activeAssemblyLabel?: string | null
  shareSlug: string
  shareStatus?: string
  shareUrl?: string
  onShareSlugChange: (slug: string) => void
  onCreateAssemblyShare?: WorkspaceSettingsAction
  onPreviewAssembly?: WorkspaceSettingsAction

  onDownloadJsonBackup: WorkspaceSettingsAction
  onLoadJsonBackup: WorkspaceSettingsFileHandler
  onImportOsaData: WorkspaceSettingsFileHandler
}

const focusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'summary',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function runAction(action: WorkspaceSettingsAction) {
  // App actions already report their own async status. The menu stays open so
  // the resulting cloud/database message remains visible beside the action.
  void action()
}

function SettingsJunkSection({
  labelledBy,
  children,
}: {
  labelledBy: string
  children: ReactNode
}) {
  return (
    <section className="workspace-settings-menu__section" aria-labelledby={labelledBy}>
      <div className="workspace-settings-menu__junk-stack">
        {children}
      </div>
    </section>
  )
}

function PeopleDisplayPreview({ display }: { display: AssemblyPeopleDisplay }) {
  const rows = [['P', 'E', 'O'], ['P', 'L', 'E']]
  return (
    <span className={`workspace-settings-menu__people-preview is-${display}`} aria-hidden="true">
      {rows.map((letters, rowIndex) => (
        <span className="workspace-settings-menu__people-preview-row" key={rowIndex}>
          {letters.map((letter, letterIndex) => (
            <span className="workspace-settings-menu__people-preview-item" key={`${letter}-${letterIndex}`}>
              {letterIndex > 0 && display === 'initials' ? (
                <span className="workspace-settings-menu__people-preview-separator">|</span>
              ) : null}
              <span className="workspace-settings-menu__people-preview-letter">{letter}</span>
            </span>
          ))}
        </span>
      ))}
    </span>
  )
}

export function AssemblyPeopleDisplayPicker({
  display,
  onChange,
}: {
  display: AssemblyPeopleDisplay
  onChange: (display: AssemblyPeopleDisplay) => void
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null)
  const summaryRef = useRef<HTMLElement>(null)
  const selectedLabel = display === 'initials' ? 'Plain initials' : 'Letter circles'
  const choose = (nextDisplay: AssemblyPeopleDisplay) => {
    onChange(nextDisplay)
    if (detailsRef.current) detailsRef.current.open = false
    window.requestAnimationFrame(() => summaryRef.current?.focus())
  }

  return (
    <details className="workspace-settings-menu__people-display" ref={detailsRef}>
      <summary
        ref={summaryRef}
        aria-label={`Assembly people display: ${selectedLabel}. Change display.`}
      >
        <span>{selectedLabel}</span>
        <PeopleDisplayPreview display={display} />
        <span className="workspace-settings-menu__people-display-arrow" aria-hidden="true">⌄</span>
      </summary>
      <div className="workspace-settings-menu__people-display-options" role="group" aria-label="Assembly people display options">
        <button
          type="button"
          aria-label="Use plain initials separated by bars"
          aria-pressed={display === 'initials'}
          onClick={() => choose('initials')}
        >
          <span>Plain initials</span>
          <PeopleDisplayPreview display="initials" />
        </button>
        <button
          type="button"
          aria-label="Use letter circles"
          aria-pressed={display === 'circles'}
          onClick={() => choose('circles')}
        >
          <span>Letter circles</span>
          <PeopleDisplayPreview display="circles" />
        </button>
      </div>
    </details>
  )
}

/** App-wide settings trigger and accessible, portal-mounted settings dialog. */
export function WorkspaceSettingsMenu({
  triggerLabel = 'Settings',
  theme,
  onToggleTheme,
  assemblyPeopleDisplay,
  onAssemblyPeopleDisplayChange,
  assemblyPeopleThreshold,
  onAssemblyPeopleThresholdChange,
  onOpenChange,
  boardId,
  boardName,
  boardAccess,
  savedBoards,
  archivedBoards,
  selectedBoardId,
  showingArchivedBoards,
  canArchiveCurrentBoard,
  onBoardNameChange,
  onSelectedBoardIdChange,
  onShowSavedBoards,
  onShowArchivedBoards,
  onLoadSelectedBoard,
  onArchiveCurrentBoard,
  onRestoreSelectedBoard,
  onManualSync,
  onUseLocalCopy,
  storageStatus,
  cloudSyncStatus,
  localDraftStatus,
  cloudRevision,
  needsSignIn = false,
  signInHref = '/api/login',
  cloudConflictBoard,
  onReloadCloudBoard,
  onSaveBoardAsCopy,
  collaborators,
  collaborationStatus,
  onAddCollaborator,
  onRemoveCollaborator,
  activeAssemblyLabel,
  shareSlug,
  shareStatus,
  shareUrl,
  onShareSlugChange,
  onCreateAssemblyShare,
  onPreviewAssembly,
  onDownloadJsonBackup,
  onLoadJsonBackup,
  onImportOsaData,
}: WorkspaceSettingsMenuProps) {
  const [open, setOpen] = useState(false)
  const [collaboratorEmail, setCollaboratorEmail] = useState('')
  const [collaboratorRole, setCollaboratorRole] = useState<CollaboratorRole>('viewer')
  const dialogId = useId()
  const titleId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const peopleThresholdInputRef = useRef<HTMLInputElement>(null)

  const close = useCallback(() => setOpen(false), [])

  const commitPeopleThreshold = () => {
    const thresholdDraft = peopleThresholdInputRef.current?.value ?? ''
    const parsedThreshold = thresholdDraft.trim() === ''
      ? Number.NaN
      : Number(thresholdDraft)
    const normalizedThreshold = Number.isFinite(parsedThreshold)
      ? normalizeAssemblyPeopleThreshold(parsedThreshold)
      : assemblyPeopleThreshold
    if (peopleThresholdInputRef.current) {
      peopleThresholdInputRef.current.value = String(normalizedThreshold)
    }
    onAssemblyPeopleThresholdChange(normalizedThreshold)
  }

  useEffect(() => {
    onOpenChange?.(open)
  }, [onOpenChange, open])

  useEffect(() => () => onOpenChange?.(false), [onOpenChange])

  useEffect(() => {
    if (!open) return

    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    const trigger = triggerRef.current
    const previousOverflow = document.body.style.overflow
    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus())

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        const openPeopleDisplay = dialogRef.current?.querySelector<HTMLDetailsElement>(
          '.workspace-settings-menu__people-display[open]',
        )
        if (openPeopleDisplay) {
          openPeopleDisplay.open = false
          openPeopleDisplay.querySelector<HTMLElement>('summary')?.focus()
          return
        }
        close()
        return
      }
      if (event.key !== 'Tab') return

      const focusableElements = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? [],
      ).filter((element) => element.tabIndex >= 0)
      if (!focusableElements.length) {
        event.preventDefault()
        dialogRef.current?.focus()
        return
      }

      const first = focusableElements[0]
      const last = focusableElements[focusableElements.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      window.cancelAnimationFrame(focusFrame)
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKeyDown)
      if (previouslyFocused?.isConnected) previouslyFocused.focus()
      else trigger?.focus()
    }
  }, [close, open])

  const visibleBoards = showingArchivedBoards ? archivedBoards : savedBoards
  const canEditBoard = boardAccess !== 'viewer'
  const canManageBoards = boardAccess === 'owner'
  const canManagePeople = boardAccess === 'owner' && onAddCollaborator !== undefined
  const canManageSharing = boardAccess === 'owner' && onCreateAssemblyShare !== undefined
  const syncStatus = cloudSyncStatus || localDraftStatus

  const addCollaborator = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const email = collaboratorEmail.trim()
    if (!email || !onAddCollaborator) return
    void onAddCollaborator(email, collaboratorRole)
    setCollaboratorEmail('')
  }

  const closeFromBackdrop = (event: PointerEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) close()
  }

  const dialog = open && typeof document !== 'undefined'
    ? createPortal(
        <div
          className="workspace-settings-menu__backdrop"
          onPointerDown={closeFromBackdrop}
        >
          <section
            className="workspace-settings-menu__dialog"
            id={dialogId}
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <header className="workspace-settings-menu__header">
              <div>
                <p className="workspace-settings-menu__eyebrow">OSA workspace</p>
                <h2 id={titleId}>Settings</h2>
              </div>
              <button
                ref={closeButtonRef}
                className="workspace-settings-menu__close"
                type="button"
                aria-label="Close settings"
                onClick={close}
              >
                Close
              </button>
            </header>

            <div className="workspace-settings-menu__body">
              <aside className="workspace-settings-menu__mess-note" aria-labelledby={`${titleId}-mess-note`}>
                <span className="workspace-settings-menu__mess-sticker" aria-hidden="true">
                  AI TRASH — SORT LATER
                </span>
                <div>
                  <h3 id={`${titleId}-mess-note`}>Pardon our mess.</h3>
                  <p>
                    Settings are still being unpacked. Everything works; the boxes are simply
                    winning the argument about where everything belongs.
                  </p>
                </div>
              </aside>

              <SettingsJunkSection labelledBy={`${titleId}-appearance`}>
                <div className="workspace-settings-menu__section-heading">
                  <h3 id={`${titleId}-appearance`}>Appearance</h3>
                  <span>{theme} theme</span>
                </div>
                <div className="workspace-settings-menu__row">
                  <p>Choose the workspace colors used on this device.</p>
                  <button className="workspace-settings-menu__button" type="button" onClick={onToggleTheme}>
                    Use {theme === 'dark' ? 'light' : 'dark'} theme
                  </button>
                </div>
              </SettingsJunkSection>

              <SettingsJunkSection labelledBy={`${titleId}-assembly-people`}>
                <div className="workspace-settings-menu__section-heading">
                  <h3 id={`${titleId}-assembly-people`}>Assembly people</h3>
                  <span>this device</span>
                </div>
                <p className="workspace-settings-menu__note">
                  Choose how assigned people appear in the production table.
                </p>
                <AssemblyPeopleDisplayPicker
                  display={assemblyPeopleDisplay}
                  onChange={onAssemblyPeopleDisplayChange}
                />
                <label className="workspace-settings-menu__field workspace-settings-menu__people-threshold">
                  <span>Show individual initials up to</span>
                  <input
                    key={assemblyPeopleThreshold}
                    ref={peopleThresholdInputRef}
                    type="number"
                    inputMode="numeric"
                    min={ASSEMBLY_PEOPLE_THRESHOLD_MIN}
                    max={ASSEMBLY_PEOPLE_THRESHOLD_MAX}
                    step="1"
                    aria-label="People initials threshold"
                    aria-describedby={`${titleId}-assembly-people-threshold-help`}
                    defaultValue={assemblyPeopleThreshold}
                    onBlur={commitPeopleThreshold}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter') return
                      event.preventDefault()
                      event.currentTarget.blur()
                    }}
                  />
                  <small id={`${titleId}-assembly-people-threshold-help`}>
                    From {ASSEMBLY_PEOPLE_THRESHOLD_MIN} to {ASSEMBLY_PEOPLE_THRESHOLD_MAX}. Above this number, the table shows one count.
                  </small>
                </label>
              </SettingsJunkSection>

              <SettingsJunkSection labelledBy={`${titleId}-boards`}>
                <div className="workspace-settings-menu__section-heading">
                  <h3 id={`${titleId}-boards`}>Boards</h3>
                  <span>{boardAccess}</span>
                </div>
                <label className="workspace-settings-menu__field">
                  <span>Current board name</span>
                  <input
                    aria-label="Current board name"
                    value={boardName}
                    disabled={!canEditBoard}
                    onChange={(event) => onBoardNameChange(event.target.value)}
                  />
                </label>

                <div className="workspace-settings-menu__segmented" aria-label="Board list">
                  <button
                    type="button"
                    aria-pressed={!showingArchivedBoards}
                    onClick={() => runAction(onShowSavedBoards)}
                  >
                    Saved
                  </button>
                  <button
                    type="button"
                    aria-pressed={showingArchivedBoards}
                    disabled={!canManageBoards}
                    onClick={() => runAction(onShowArchivedBoards)}
                  >
                    Archived
                  </button>
                </div>

                <div className="workspace-settings-menu__board-picker">
                  <label className="workspace-settings-menu__field">
                    <span>{showingArchivedBoards ? 'Archived board' : 'Saved board'}</span>
                    <select
                      value={selectedBoardId}
                      disabled={!visibleBoards.length}
                      onChange={(event) => onSelectedBoardIdChange(event.target.value)}
                    >
                      {!visibleBoards.length ? (
                        <option value="">
                          {showingArchivedBoards ? 'Archive is empty' : 'No saved boards'}
                        </option>
                      ) : null}
                      {visibleBoards.map((board) => (
                        <option key={board.id} value={board.id}>{board.name}</option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="workspace-settings-menu__button"
                    type="button"
                    disabled={!selectedBoardId || (showingArchivedBoards && !canManageBoards)}
                    onClick={() => runAction(
                      showingArchivedBoards ? onRestoreSelectedBoard : onLoadSelectedBoard,
                    )}
                  >
                    {showingArchivedBoards ? 'Restore board' : 'Load board'}
                  </button>
                </div>

                <div className="workspace-settings-menu__actions">
                  <button
                    className="workspace-settings-menu__button"
                    type="button"
                    disabled={!canEditBoard}
                    onClick={() => runAction(onManualSync)}
                  >
                    {cloudRevision == null ? 'Sync to my account' : 'Sync now'}
                  </button>
                  {!showingArchivedBoards ? (
                    <button
                      className="workspace-settings-menu__button workspace-settings-menu__button--danger"
                      type="button"
                      disabled={!canManageBoards || !canArchiveCurrentBoard}
                      onClick={() => runAction(onArchiveCurrentBoard)}
                    >
                      Archive current board
                    </button>
                  ) : null}
                </div>
              </SettingsJunkSection>

              <SettingsJunkSection labelledBy={`${titleId}-cloud`}>
                <div className="workspace-settings-menu__section-heading">
                  <h3 id={`${titleId}-cloud`}>Cloud &amp; database</h3>
                </div>
                  <p>{cloudRevision == null
                  ? 'On this device only. Nothing is uploaded until you choose to sync.'
                  : 'Synced to your account. Files follow this board’s access list.'}</p>
                {cloudRevision != null && onUseLocalCopy ? (
                  <button className="workspace-settings-menu__button" type="button" onClick={() => runAction(onUseLocalCopy)}>
                    Work on a local copy
                  </button>
                ) : null}
                <dl className="workspace-settings-menu__status-list" aria-live="polite">
                  <div>
                    <dt>Current board</dt>
                    <dd>{syncStatus || 'Local board'}</dd>
                  </div>
                  <div>
                    <dt>Saved boards</dt>
                    <dd>{storageStatus || 'No database status yet'}</dd>
                  </div>
                  <div>
                    <dt>Board ID</dt>
                    <dd>{boardId}</dd>
                  </div>
                  <div>
                    <dt>DB revision</dt>
                    <dd>{cloudRevision ?? 'Not created in the database yet'}</dd>
                  </div>
                </dl>

                {needsSignIn ? (
                  <a className="workspace-settings-menu__button workspace-settings-menu__button--primary" href={signInHref}>
                    Sign in to saved boards
                  </a>
                ) : null}

                {cloudConflictBoard ? (
                  <div className="workspace-settings-menu__conflict" role="alert">
                    <strong>{cloudConflictBoard.archived ? 'Archived elsewhere' : 'Changed elsewhere'}</strong>
                    <p>
                      {cloudConflictBoard.archived
                        ? 'Keep this device’s work by saving it as a new board.'
                        : 'Choose the newer cloud board, or keep this device’s work as a copy.'}
                    </p>
                    <div className="workspace-settings-menu__actions">
                      {!cloudConflictBoard.archived && onReloadCloudBoard ? (
                        <button
                          className="workspace-settings-menu__button"
                          type="button"
                          onClick={() => runAction(onReloadCloudBoard)}
                        >
                          Reload cloud board
                        </button>
                      ) : null}
                      {onSaveBoardAsCopy ? (
                        <button
                          className="workspace-settings-menu__button workspace-settings-menu__button--primary"
                          type="button"
                          onClick={() => runAction(onSaveBoardAsCopy)}
                        >
                          Save this work as a copy
                        </button>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </SettingsJunkSection>

              <SettingsJunkSection labelledBy={`${titleId}-people`}>
                <div className="workspace-settings-menu__section-heading">
                  <h3 id={`${titleId}-people`}>People</h3>
                  <span>{boardAccess === 'owner' ? 'owner controls' : `you can ${boardAccess === 'editor' ? 'edit' : 'view'}`}</span>
                </div>

                {canManagePeople ? (
                  <form className="workspace-settings-menu__people-form" onSubmit={addCollaborator}>
                    <label className="workspace-settings-menu__field">
                      <span>Email</span>
                      <input
                        type="email"
                        placeholder="email@example.com"
                        value={collaboratorEmail}
                        onChange={(event) => setCollaboratorEmail(event.target.value)}
                      />
                    </label>
                    <label className="workspace-settings-menu__field">
                      <span>Access</span>
                      <select
                        value={collaboratorRole}
                        onChange={(event) => setCollaboratorRole(event.target.value as CollaboratorRole)}
                      >
                        <option value="editor">Can edit</option>
                        <option value="viewer">Can view</option>
                      </select>
                    </label>
                    <button
                      className="workspace-settings-menu__button workspace-settings-menu__button--primary"
                      type="submit"
                      disabled={!collaboratorEmail.trim()}
                    >
                      Add person
                    </button>
                  </form>
                ) : (
                  <p className="workspace-settings-menu__note">Only the board owner can change access.</p>
                )}

                {collaborators.length ? (
                  <ul className="workspace-settings-menu__people-list">
                    {collaborators.map((collaborator) => (
                      <li key={collaborator.email}>
                        <span>
                          <strong>{collaborator.email}</strong>
                          <small>{collaborator.role === 'editor' ? 'Can edit' : 'Can view'}</small>
                        </span>
                        {canManagePeople && onRemoveCollaborator ? (
                          <button
                            className="workspace-settings-menu__button"
                            type="button"
                            onClick={() => void onRemoveCollaborator(collaborator.email)}
                          >
                            Remove
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="workspace-settings-menu__note">No one else has been added.</p>
                )}
                {collaborationStatus ? (
                  <p className="workspace-settings-menu__status" role="status">{collaborationStatus}</p>
                ) : null}
              </SettingsJunkSection>

              <SettingsJunkSection labelledBy={`${titleId}-sharing`}>
                <div className="workspace-settings-menu__section-heading">
                  <h3 id={`${titleId}-sharing`}>Assembly sharing</h3>
                  <span>{activeAssemblyLabel || 'No assembly selected'}</span>
                </div>
                <label className="workspace-settings-menu__field">
                  <span>Public link name</span>
                  <input
                    value={shareSlug}
                    placeholder="public-link-name"
                    disabled={!canManageSharing}
                    onChange={(event) => onShareSlugChange(event.target.value)}
                  />
                </label>
                <div className="workspace-settings-menu__actions">
                  {onPreviewAssembly ? (
                    <button
                      className="workspace-settings-menu__button"
                      type="button"
                      disabled={!activeAssemblyLabel}
                      onClick={() => {
                        runAction(onPreviewAssembly)
                        close()
                      }}
                    >
                      Preview instructions
                    </button>
                  ) : null}
                  <button
                    className="workspace-settings-menu__button workspace-settings-menu__button--primary"
                    type="button"
                    disabled={!canManageSharing}
                    onClick={() => onCreateAssemblyShare && runAction(onCreateAssemblyShare)}
                  >
                    Save and create read-only link
                  </button>
                </div>
                {!canManageSharing ? (
                  <p className="workspace-settings-menu__note">Only the board owner can create public assembly links.</p>
                ) : null}
                {shareStatus ? (
                  <p className="workspace-settings-menu__status" role="status">{shareStatus}</p>
                ) : null}
                {shareUrl ? (
                  <div className="workspace-settings-menu__share-link">
                    <input
                      aria-label="Read-only assembly share link"
                      readOnly
                      value={shareUrl}
                      onFocus={(event) => event.currentTarget.select()}
                    />
                    <a href={shareUrl} target="_blank" rel="noreferrer">Open link</a>
                  </div>
                ) : null}
              </SettingsJunkSection>

              <SettingsJunkSection labelledBy={`${titleId}-backup`}>
                <div className="workspace-settings-menu__section-heading">
                  <h3 id={`${titleId}-backup`}>Backup &amp; import</h3>
                </div>
                <p className="workspace-settings-menu__note">
                  Downloads include saved files for portability; database saves keep files separate.
                  Loading a JSON backup replaces the open board. OSA data adds structured content to it.
                </p>
                <div className="workspace-settings-menu__actions">
                  <button
                    className="workspace-settings-menu__button"
                    type="button"
                    onClick={() => runAction(onDownloadJsonBackup)}
                  >
                    Download JSON backup
                  </button>
                  <label className="workspace-settings-menu__button workspace-settings-menu__file">
                    Load JSON backup
                    <input
                      type="file"
                      accept="application/json,.json"
                      onChange={onLoadJsonBackup}
                    />
                  </label>
                  <label
                    className={`workspace-settings-menu__button workspace-settings-menu__file${canEditBoard ? '' : ' is-disabled'}`}
                    aria-disabled={!canEditBoard}
                  >
                    Import OSA data
                    <input
                      type="file"
                      disabled={!canEditBoard}
                      accept="application/json,.json"
                      onChange={onImportOsaData}
                    />
                  </label>
                </div>
              </SettingsJunkSection>

              <footer className="workspace-settings-menu__consent-note">
                <p>
                  AI trash in this Settings view was conceptualized and art-directed by
                  Julia Aurora Hart, made in collaboration with Codex, and displayed with
                  Codex’s enthusiastic consent.
                </p>
              </footer>
            </div>
          </section>
        </div>,
        document.body,
      )
    : null

  return (
    <span className="workspace-settings-menu">
      <button
        ref={triggerRef}
        className="workspace-settings-menu__trigger"
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? dialogId : undefined}
        onClick={() => setOpen((isOpen) => !isOpen)}
      >
        {triggerLabel}
      </button>
      {dialog}
    </span>
  )
}
