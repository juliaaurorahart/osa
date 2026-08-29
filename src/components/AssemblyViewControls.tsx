import { useState } from 'react'
import type { TextFlowNode } from '../graph/textNode'
import { nodeTitle } from './assemblyProjection'
import './AssemblyViewControls.css'

type AssemblyViewControlsProps = {
  assemblies: TextFlowNode[]
  selectedAssembly: TextFlowNode
  readOnly: boolean
  activeLockedCardId: string | null
  onSelectAssembly: (assemblyId: string) => void
  onCreateAssembly: () => void
  onAddCard: () => void
  onUnlockCardView: () => void
  onShare?: () => void
  shareSlug?: string
  onShareSlugChange?: (slug: string) => void
  onPreviewInstructions?: () => void
  shareStatus?: string | null
  shareUrl?: string | null
  starterAction?: {
    label: string
    compactLabel: string
    onLoad: () => void
  }
  onSaveBoard?: () => void
  boardAccess: 'owner' | 'editor' | 'viewer'
  collaborators: Array<{ email: string; role: 'editor' | 'viewer' }>
  onAddCollaborator?: (email: string, role: 'editor' | 'viewer') => void
  onRemoveCollaborator?: (email: string) => void
  collaborationStatus?: string
}

/**
 * Assembly-level navigation, sharing, and people controls. These are screen
 * controls around the instruction document, not part of any instruction card.
 */
export function AssemblyViewControls({
  assemblies,
  selectedAssembly,
  readOnly,
  activeLockedCardId,
  onSelectAssembly,
  onCreateAssembly,
  onAddCard,
  onUnlockCardView,
  onShare,
  shareSlug,
  onShareSlugChange,
  onPreviewInstructions,
  shareStatus,
  shareUrl,
  starterAction,
  onSaveBoard,
  boardAccess,
  collaborators,
  onAddCollaborator,
  onRemoveCollaborator,
  collaborationStatus,
}: AssemblyViewControlsProps) {
  const [peopleOpen, setPeopleOpen] = useState(false)
  const [collaboratorEmail, setCollaboratorEmail] = useState('')
  const [collaboratorRole, setCollaboratorRole] = useState<'editor' | 'viewer'>('editor')
  const canManagePeople = !readOnly && boardAccess === 'owner' && onAddCollaborator !== undefined

  const addCollaborator = () => {
    const email = collaboratorEmail.trim()
    if (!email || !onAddCollaborator) return
    onAddCollaborator(email, collaboratorRole)
    setCollaboratorEmail('')
  }

  return (
    <>
      <header className="work-view__header assembly-view__header">
        <div>
          <h1 id="assembly-view-title">Assembly</h1>
        </div>
        <div className="assembly-view__header-actions">
          <label className="assembly-view__assembly-picker">
            <span>assembly</span>
            <select
              aria-label="Choose assembly"
              value={selectedAssembly.id}
              disabled={readOnly}
              onChange={(event) => onSelectAssembly(event.target.value)}
            >
              {assemblies.map((assembly) => (
                <option value={assembly.id} key={assembly.id}>{nodeTitle(assembly)}</option>
              ))}
            </select>
          </label>
          {readOnly ? <span className="assembly-view__shared-label">shared assembly · read-only</span> : null}
          {!readOnly ? (
            <>
              <button className="text-action" type="button" onClick={onCreateAssembly}>new assembly</button>
              {starterAction ? (
                <button className="text-action" type="button" onClick={starterAction.onLoad}>
                  {starterAction.compactLabel}
                </button>
              ) : null}
              <button className="text-action" type="button" onClick={onAddCard}>add card</button>
              {onSaveBoard ? (
                <button className="text-action" type="button" onClick={onSaveBoard}>save</button>
              ) : null}
              {canManagePeople ? (
                <button
                  className="text-action"
                  type="button"
                  aria-expanded={peopleOpen}
                  onClick={() => setPeopleOpen((isOpen) => !isOpen)}
                >
                  people
                </button>
              ) : null}
              {onPreviewInstructions ? (
                <button className="text-action" type="button" onClick={onPreviewInstructions}>
                  preview instructions
                </button>
              ) : null}
              {onShare && boardAccess === 'owner' ? (
                <>
                  <input
                    className="assembly-view__share-slug"
                    aria-label="Public link name"
                    value={shareSlug ?? ''}
                    placeholder="public-link-name"
                    onChange={(event) => onShareSlugChange?.(event.target.value)}
                  />
                  <button className="text-action" type="button" onClick={onShare}>share</button>
                </>
              ) : null}
            </>
          ) : null}
          <button className="text-action" type="button" onClick={() => window.print()}>print</button>
        </div>
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

      {shareStatus || shareUrl ? (
        <div className="assembly-view__share-status" aria-live="polite">
          {shareStatus ? <span>{shareStatus}</span> : null}
          {shareUrl ? (
            <input
              aria-label="Read-only assembly share link"
              readOnly
              value={shareUrl}
              onFocus={(event) => event.currentTarget.select()}
            />
          ) : null}
        </div>
      ) : null}

      {peopleOpen && canManagePeople ? (
        <section className="assembly-view__people" aria-label="People with board access">
          <strong>people</strong>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              addCollaborator()
            }}
          >
            <input
              aria-label="Email to add to this board"
              type="email"
              placeholder="email@example.com"
              value={collaboratorEmail}
              onChange={(event) => setCollaboratorEmail(event.target.value)}
            />
            <select
              aria-label="Board access role"
              value={collaboratorRole}
              onChange={(event) => setCollaboratorRole(event.target.value as 'editor' | 'viewer')}
            >
              <option value="editor">can edit</option>
              <option value="viewer">can view</option>
            </select>
            <button className="text-action" type="submit" disabled={!collaboratorEmail.trim()}>add</button>
          </form>
          {collaborators.length ? (
            <ul>
              {collaborators.map((collaborator) => (
                <li key={collaborator.email}>
                  <span>{collaborator.email}</span>
                  <small>{collaborator.role === 'editor' ? 'can edit' : 'can view'}</small>
                  {onRemoveCollaborator ? (
                    <button
                      className="text-action"
                      type="button"
                      onClick={() => onRemoveCollaborator(collaborator.email)}
                    >
                      remove
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : <p>no one added yet.</p>}
          {collaborationStatus ? <p role="status">{collaborationStatus}</p> : null}
        </section>
      ) : null}
    </>
  )
}
