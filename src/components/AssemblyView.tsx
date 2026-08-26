import {
  useMemo,
  useState,
  type CSSProperties,
  type Dispatch,
  type KeyboardEvent,
  type SetStateAction,
} from 'react'
import type { GraphEdge } from '../graph/graphEdge'
import {
  appearanceAccentColor,
  OSA_PROPERTY,
  OSA_RELATION,
  isPartLike,
  osaRole,
  type OperationVisualPlacement,
} from '../graph/osaData'
import type { TextFlowNode } from '../graph/textNode'
import { annotationTargetsForNodes } from '../graph/sketchAnnotation'
import {
  visualEmbedsForCanvas,
} from '../graph/visualEmbed'
import type { AssemblyToolDraft, AssemblyViewUiState } from './assemblyViewState'
import {
  canvasOwnedByStep,
  connectedTargets,
  nodeTitle,
  operationsForAssembly,
  stepsForOperation,
  visualHasInstructionContent,
} from './assemblyProjection'
import { VisualCanvasPreview } from './VisualCanvas'
import './AssemblyView.css'

const INDEX_CARD_ID = 'assembly-index'

type AssemblyViewProps = {
  assemblies: TextFlowNode[]
  nodes: TextFlowNode[]
  operations: TextFlowNode[]
  edges: GraphEdge[]
  /**
   * Screen-only Assembly state owned by the workspace host. Keeping it above
   * this component means a view switch does not discard the card someone was
   * reading, editing, drawing in, or deliberately locking.
   */
  uiState: AssemblyViewUiState
  onUiStateChange: Dispatch<SetStateAction<AssemblyViewUiState>>
  /** Shared tool inventory. Omit it to derive tools from the ordinary node list. */
  tools?: TextFlowNode[]
  selectedAssemblyId: string | null
  onSelectAssembly: (assemblyId: string) => void
  onCreateAssembly: (title: string) => string
  onCreateOperation: (assemblyId: string, title: string) => string
  /** Moves one card in the durable Assembly instruction sequence. */
  onReorderOperation: (assemblyId: string, operationId: string, direction: 'up' | 'down') => void
  /** Removes one card from this Assembly without deleting its project objects. */
  onRemoveOperation: (operationId: string) => void
  /** Adds one named, ordered durable step beneath an instruction card. */
  onCreateStep: (operationId: string) => string
  /** Moves one durable step without rewriting the rest of the card text. */
  onReorderStep: (operationId: string, stepId: string, direction: 'up' | 'down') => void
  /** Returns the one canvas owned by a step, creating it only when needed. */
  onEnsureStepCanvas: (stepId: string) => string
  onCreatePart: (assemblyId: string) => string
  onCreateExpense: (assemblyId: string) => string
  /** Removes one Part from this Assembly's shared inventory only. */
  onUnlinkAssemblyPart: (assemblyId: string, partId: string) => void
  /** Removes one Expense from this Assembly's shared inventory only. */
  onUnlinkAssemblyExpense: (assemblyId: string, expenseId: string) => void
  onCreateTool: (
    operationId: string,
    name: string,
    options?: { placeholder?: boolean },
  ) => string
  /**
   * Legacy input-only relation. It remains as a compatibility fallback while
   * existing boards use `operation-item`; new hosts should pass the explicit
   * input/output callbacks below.
   */
  onLinkPart: (operationId: string, partId: string) => void
  /** Links an existing canonical part as something this operation needs. */
  onLinkPartInput?: (operationId: string, partId: string) => void
  /** Unlinks one part or assembly from this instruction's In list only. */
  onUnlinkPartInput?: (operationId: string, partId: string) => void
  /** Sets the one part or subassembly represented by an instruction card. */
  onSetPrimaryOutput?: (operationId: string, partId: string) => void
  /**
   * Creates one canonical placeholder part and links it to the operation in
   * the supplied direction. The host also owns linking it into the assembly's
   * shared parts list, so it becomes available everywhere immediately.
   */
  onCreatePartForOperation?: (
    operationId: string,
    direction: OperationPartDirection,
    /** Optional deliberate name for a legacy-card primary-output repair. */
    requestedName?: string,
  ) => string
  onLinkTool?: (operationId: string, toolId: string) => void
  /** Unlinks one tool from this instruction without deleting the tool record. */
  onUnlinkTool?: (operationId: string, toolId: string) => void
  /** Places an existing reusable Visual in this card without copying it. */
  onLinkObjectVisual?: (operationId: string, objectId: string, sectionId: string) => void
  /** Removes only this card's View link; the object's reusable visual remains. */
  onUnlinkObjectVisual?: (operationId: string, objectId: string) => void
  /** Moves one editable canvas up or down in this card's visual column. */
  onReorderOperationVisual?: (
    operationId: string,
    visualId: string,
    direction: 'up' | 'down',
  ) => void
  /** Legacy placement editor callback retained for hosts that still provide it. */
  onObjectVisualPlacementChange?: (
    operationId: string,
    objectId: string,
    placement: OperationVisualPlacement,
  ) => void
  /** Legacy section callback retained for host compatibility; Assembly does not call it. */
  onCreateCanvasSection?: (operationId: string) => string
  /**
   * Creates one generic canvas owned by the card's represented part (with a
   * parent-Assembly fallback), then references it from this operation. The
   * canvas chooses its own permanent identity only after it is opened.
   */
  onCreateOwnedVisualForOperation?: (
    operationId: string,
    initialIdentity?: 'osa-draw' | 'untyped',
  ) => string | undefined
  /** Reassigns a Visual to a Part, Assembly, or Tool without changing its card references. */
  onChangeVisualOwner?: (visualId: string, ownerId: string) => void
  onNameChange: (nodeId: string, name: string) => void
  onTextChange: (nodeId: string, text: string) => void
  /** Updates durable Visual metadata chosen inside the canvas editor. */
  onPropertyChange?: (nodeId: string, propertyName: string, value: string) => void
  onOpenNode: (nodeId: string) => void
  /** A shared link can project a board without exposing editing controls. */
  readOnly?: boolean
  /** Creates/copies a read-only link for the current assembly. */
  onShare?: () => void
  /** The compact public path segment placed beside the Share button. */
  shareSlug?: string
  onShareSlugChange?: (slug: string) => void
  /** Opens the team-facing instructions projection locally without sharing it. */
  onPreviewInstructions?: () => void
  /** Brief feedback from the host while a share link is being prepared. */
  shareStatus?: string | null
  /** The last generated read-only link, retained so it can be copied again. */
  shareUrl?: string | null
  /** Opens OSA's bundled Shako Light Wrap starter board. */
  onLoadShakoStarter?: () => void
  /** Saves the current durable board before another device opens it. */
  onSaveBoard?: () => void
  /** Server-derived role; viewers may inspect this Assembly but cannot edit it. */
  boardAccess?: 'owner' | 'editor' | 'viewer'
  /** The owner-managed people explicitly invited to this saved board. */
  collaborators?: Array<{ email: string; role: 'editor' | 'viewer' }>
  onAddCollaborator?: (email: string, role: 'editor' | 'viewer') => void
  onRemoveCollaborator?: (email: string) => void
  collaborationStatus?: string
}

/** Preserves the first relationship order while avoiding duplicate chips. */
function uniqueNodes(...groups: TextFlowNode[][]) {
  const unique = new Map<string, TextFlowNode>()
  groups.flat().forEach((node) => {
    if (!unique.has(node.id)) unique.set(node.id, node)
  })
  return [...unique.values()]
}

function cardKeyDown(event: KeyboardEvent<HTMLElement>, onFocus: () => void) {
  if (event.target !== event.currentTarget) return
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    onFocus()
  }
}

const cardShell: CSSProperties = {
  boxSizing: 'border-box',
  width: '100%',
  minWidth: 0,
  padding: 'clamp(16px, 3vw, 34px)',
  // A card is an instruction document, not a fixed-height viewport. Let it
  // grow with its criteria, visual, and steps so the browser page is the only
  // place someone needs to scroll.
  overflow: 'visible',
  border: '1px solid var(--osa-border)',
  borderRadius: 4,
  background: 'var(--osa-surface)',
  color: 'var(--osa-text)',
  boxShadow: '0 8px 22px rgb(0 0 0 / 7%)',
}

const transparentInput: CSSProperties = {
  boxSizing: 'border-box',
  width: '100%',
  minWidth: 0,
  padding: 0,
  border: 0,
  outline: 0,
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
}

const fieldLabel: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(72px, 0.26fr) minmax(0, 1fr)',
  alignItems: 'start',
  gap: 8,
  minWidth: 0,
  fontSize: 'clamp(0.62rem, 1.15vw, 0.9rem)',
  lineHeight: 1.3,
}

const NEW_TOOL_OPTION = '__new-tool__'
const PLACEHOLDER_TOOL_OPTION = '__placeholder-tool__'
const NEW_PART_OPTION = '__new-part__'

export type OperationPartDirection = 'input' | 'output'

/** A small, derived view hint that never rewrites the canonical object. */
function semanticAccentStyleFromColor(accent: string | undefined): CSSProperties | undefined {
  // Use a direct text color as well as the shared CSS variable. The direct
  // value keeps the in/tools labels reliable even when another style layer
  // supplies a default button color.
  return accent
    ? { '--osa-semantic-accent': accent, color: accent } as CSSProperties
    : undefined
}

function semanticAccentStyle(node: TextFlowNode | undefined) {
  return semanticAccentStyleFromColor(appearanceAccentColor(node))
}

type AssemblySemanticItem = {
  node: TextFlowNode
  kind: 'part' | 'tool'
}

/**
 * The Assembly overview is the project-facing place to designate semantic
 * information. This list is derived from the Assembly's real relationships;
 * it never creates a second, manually maintained inventory just for the view.
 */
function semanticItemsForAssembly(
  assemblyParts: TextFlowNode[],
  assemblyOperations: TextFlowNode[],
  nodes: TextFlowNode[],
  edges: GraphEdge[],
): AssemblySemanticItem[] {
  const items = new Map<string, AssemblySemanticItem>()
  const add = (node: TextFlowNode, kind: AssemblySemanticItem['kind']) => {
    if (!items.has(node.id)) items.set(node.id, { node, kind })
  }

  assemblyParts.filter(isPartLike).forEach((part) => add(part, 'part'))

  assemblyOperations.forEach((operation) => {
    const operationTools = connectedTargets(
      operation.id,
      nodes,
      edges,
      OSA_RELATION.operationTool,
      /\b(tool|tools)\b/i,
    )
    operationTools.forEach((tool) => add(tool, 'tool'))

    const legacyInputs = connectedTargets(
      operation.id,
      nodes,
      edges,
      OSA_RELATION.operationItem,
      /\b(part|parts|material|materials|component|components)\b/i,
    ).filter(isPartLike)
    const structuredInputs = connectedTargets(
      operation.id,
      nodes,
      edges,
      OSA_RELATION.operationInput,
      /\b(parts? in|input|inputs|requires?|needs?)\b/i,
    ).filter(isPartLike)
    const outputs = uniqueNodes(
      connectedTargets(
        operation.id,
        nodes,
        edges,
        OSA_RELATION.operationPrimaryOutput,
        /\b(represents?|primary output)\b/i,
      ).filter(isPartLike),
      connectedTargets(
        operation.id,
        nodes,
        edges,
        OSA_RELATION.operationOutput,
        /\b(produces?|parts? out|output)\b/i,
      ).filter(isPartLike),
    )

    // Structured In is authoritative once it exists, matching the card view.
    ;(structuredInputs.length ? structuredInputs : legacyInputs)
      .forEach((part) => add(part, 'part'))
    outputs.forEach((part) => add(part, 'part'))
  })

  return [...items.values()].sort((left, right) => (
    left.kind.localeCompare(right.kind)
      || nodeTitle(left.node).localeCompare(nodeTitle(right.node))
  ))
}

/** A printable card board projected from the ordinary objects in one Space. */
export function AssemblyView({
  assemblies,
  nodes,
  operations,
  edges,
  uiState,
  onUiStateChange,
  tools,
  selectedAssemblyId,
  onSelectAssembly,
  onCreateAssembly,
  onCreateOperation,
  onReorderOperation,
  onRemoveOperation,
  onCreateStep,
  onReorderStep,
  onEnsureStepCanvas,
  onCreatePart,
  onCreateExpense,
  onUnlinkAssemblyPart,
  onUnlinkAssemblyExpense,
  onCreateTool,
  onLinkPart,
  onLinkPartInput,
  onUnlinkPartInput,
  onCreatePartForOperation,
  onLinkTool,
  onUnlinkTool,
  onNameChange,
  onTextChange,
  onPropertyChange,
  onOpenNode,
  readOnly = false,
  onShare,
  shareSlug,
  onShareSlugChange,
  onPreviewInstructions,
  shareStatus,
  shareUrl,
  onLoadShakoStarter,
  onSaveBoard,
  boardAccess = 'owner',
  collaborators = [],
  onAddCollaborator,
  onRemoveCollaborator,
  collaborationStatus,
}: AssemblyViewProps) {
  const selectedAssembly = assemblies.find((assembly) => assembly.id === selectedAssemblyId)
    ?? assemblies[0]
  const [peopleOpen, setPeopleOpen] = useState(false)
  const [collaboratorEmail, setCollaboratorEmail] = useState('')
  const [collaboratorRole, setCollaboratorRole] = useState<'editor' | 'viewer'>('editor')
  // Every card and its open canvas resolve annotation references from the
  // canonical project graph rather than from just that card's local objects.
  const annotationTargets = useMemo(() => annotationTargetsForNodes(nodes), [nodes])
  const assemblyOperations = useMemo(() => selectedAssembly
    ? operationsForAssembly(selectedAssembly.id, operations, edges)
    : [], [edges, operations, selectedAssembly])
  // The Assembly card is the overview of the actual instruction sequence.
  // Keep its step list derived from the same Step objects as each card rather
  // than maintaining a second hand-written summary.
  const assemblyCardSteps = useMemo(() => assemblyOperations.flatMap((operation) => (
    stepsForOperation(operation.id, nodes, edges).map((step, index) => ({
      operation,
      step,
      index,
    }))
  )), [assemblyOperations, edges, nodes])
  const assemblyParts = useMemo(() => selectedAssembly
    ? connectedTargets(
      selectedAssembly.id,
      nodes,
      edges,
      OSA_RELATION.assemblyItem,
      /\b(part|parts|material|materials|component|components)\b/i,
    )
    : [], [edges, nodes, selectedAssembly])
  const assemblyExpenses = useMemo(() => selectedAssembly
    ? connectedTargets(
      selectedAssembly.id,
      nodes,
      edges,
      OSA_RELATION.assemblyExpense,
      /\b(expense|expenses|cost|costs)\b/i,
    )
    : [], [edges, nodes, selectedAssembly])
  const assemblyPartIds = useMemo(
    () => new Set(assemblyParts.map((part) => part.id)),
    [assemblyParts],
  )
  const toolInventory = useMemo(() => {
    const candidates = tools?.length ? tools : nodes.filter((node) => (
      node.data.kind === 'tool' || osaRole(node) === 'tool'
    ))
    const uniqueTools = new Map(candidates.map((tool) => [tool.id, tool]))

    return [...uniqueTools.values()]
      .filter((tool) => tool.data.kind === 'tool' || osaRole(tool) === 'tool')
      .sort((left, right) => nodeTitle(left).localeCompare(nodeTitle(right)))
  }, [nodes, tools])
  const assemblySemanticItems = useMemo(() => semanticItemsForAssembly(
    assemblyParts,
    assemblyOperations,
    nodes,
    edges,
  ), [assemblyOperations, assemblyParts, edges, nodes])
  const {
    focusedCardId,
    // Older in-memory state can survive a hot reload. A missing open card is
    // simply the normal compact Assembly document.
    openCardId = null,
    lockedCardId,
    toolDraft,
    toolDraftFor,
  } = uiState
  // These small setters keep the card code readable while routing every
  // presentation change through App. App stays mounted when Assembly is
  // hidden, so this state comes back intact after Assembly -> another view ->
  // Assembly. It is intentionally not part of the saved graph.
  const setFocusedCardId = (nextCardId: string) => {
    onUiStateChange((current) => ({ ...current, focusedCardId: nextCardId }))
  }
  const setOpenCardId = (nextCardId: string | null) => {
    onUiStateChange((current) => ({ ...current, openCardId: nextCardId }))
  }
  const setLockedCardId = (nextCardId: SetStateAction<string | null>) => {
    onUiStateChange((current) => ({
      ...current,
      lockedCardId: typeof nextCardId === 'function'
        ? nextCardId(current.lockedCardId)
        : nextCardId,
    }))
  }
  const setEditingVisual = (visualId: string | null, operationId: string | null = null) => {
    onUiStateChange((current) => ({
      ...current,
      editingVisualId: visualId,
      editingOperationId: visualId ? operationId : null,
    }))
  }
  const setToolDraft = (nextDraft: string) => {
    onUiStateChange((current) => ({ ...current, toolDraft: nextDraft }))
  }
  const setToolDraftFor = (nextDraft: AssemblyToolDraft | null) => {
    onUiStateChange((current) => ({ ...current, toolDraftFor: nextDraft }))
  }
  const activeFocusedCardId = focusedCardId === INDEX_CARD_ID
    || assemblyOperations.some((operation) => operation.id === focusedCardId)
    ? focusedCardId
    : INDEX_CARD_ID
  // Opening a card is a presentational choice, just like focus and lock. A
  // stale card ID must never leave the author with a blank page after a card
  // has been removed or the selected Assembly changes.
  const activeOpenCardId = openCardId === INDEX_CARD_ID
    || assemblyOperations.some((operation) => operation.id === openCardId)
    ? openCardId
    : null
  // A card can disappear when its source data changes or the selected
  // assembly changes. In that case, quietly fall back to the normal board
  // rather than leaving the builder with an empty locked pane.
  const activeLockedCardId = lockedCardId === INDEX_CARD_ID
    || assemblyOperations.some((operation) => operation.id === lockedCardId)
    ? lockedCardId
    : null
  const toggleCardLock = (cardId: string) => {
    setLockedCardId((currentCardId) => currentCardId === cardId ? null : cardId)
  }
  const openCard = (cardId: string) => {
    setFocusedCardId(cardId)
    setOpenCardId(cardId)
  }
  const closeCard = () => setOpenCardId(null)
  const createAssembly = () => {
    if (readOnly) return
    const assemblyId = onCreateAssembly(`Assembly ${assemblies.length + 1}`)
    onSelectAssembly(assemblyId)
    openCard(INDEX_CARD_ID)
  }

  const canManagePeople = !readOnly && boardAccess === 'owner' && onAddCollaborator !== undefined
  const addCollaborator = () => {
    const email = collaboratorEmail.trim()
    if (!email || !onAddCollaborator) return
    onAddCollaborator(email, collaboratorRole)
    setCollaboratorEmail('')
  }

  if (!selectedAssembly) {
    return (
      <section className="work-view assembly-view" aria-labelledby="assembly-view-title">
        <header className="work-view__header">
          <div>
            <h1 id="assembly-view-title">Assembly</h1>
          </div>
          {readOnly ? <span className="assembly-view__shared-label">shared assembly · read-only</span> : null}
        </header>
        <div className="assembly-view__empty-state">
          <p className="work-view__empty">there is no assembly board open yet.</p>
          {readOnly ? (
            <p>this shared link does not include an assembly.</p>
          ) : (
            <div className="assembly-view__empty-actions">
              <button className="text-action" type="button" onClick={createAssembly}>create assembly</button>
              {onLoadShakoStarter ? (
                <button className="text-action" type="button" onClick={onLoadShakoStarter}>
                  open Shako Light Wrap starter
                </button>
              ) : null}
            </div>
          )}
        </div>
      </section>
    )
  }

  const addCard = () => {
    if (readOnly) return
    const cardId = onCreateOperation(
      selectedAssembly.id,
      `Instruction ${assemblyOperations.length + 1}`,
    )
    openCard(cardId)
  }

  const cardFocusStyle = (focused: boolean): CSSProperties => focused
    ? {
        gridColumn: '1 / -1',
        outline: '3px solid rgb(91 206 250 / 58%)',
        outlineOffset: 4,
      }
    : { cursor: 'pointer' }
  const isIndexOpen = activeOpenCardId === INDEX_CARD_ID

  return (
    <section className="work-view assembly-view" aria-labelledby="assembly-view-title">
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
              <button className="text-action" type="button" onClick={createAssembly}>new assembly</button>
              {onLoadShakoStarter ? (
                <button className="text-action" type="button" onClick={onLoadShakoStarter}>
                  open Shako starter
                </button>
              ) : null}
              <button className="text-action" type="button" onClick={addCard}>add card</button>
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
            onClick={() => setLockedCardId(null)}
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

      <div
        className={`assembly-card-board${activeLockedCardId ? ' is-locked' : ''}`}
        style={{
          display: 'grid',
          // Assembly instructions are read and performed in sequence. Keep
          // every card on its own row instead of turning the instructions
          // into a dashboard-style grid at wider screen sizes.
          gridTemplateColumns: 'minmax(0, 1fr)',
          alignItems: 'start',
          gap: 'clamp(22px, 4vw, 42px)',
        }}
      >
        {!activeLockedCardId || activeLockedCardId === INDEX_CARD_ID ? <article
          className={`assembly-card assembly-index-card${isIndexOpen ? ' is-focused is-open' : ' is-summary'}`}
          style={{ ...cardShell, ...(isIndexOpen ? {} : { padding: 0 }), ...cardFocusStyle(isIndexOpen) }}
          tabIndex={0}
          aria-label="assembly index card"
          onClick={() => {
            if (!isIndexOpen) openCard(INDEX_CARD_ID)
          }}
          onKeyDown={(event) => cardKeyDown(event, () => openCard(INDEX_CARD_ID))}
        >
          {isIndexOpen ? (
            <>
            <div className="assembly-card__focus-controls">
              <button
                className="assembly-card__lock-button"
                type="button"
                aria-pressed={activeLockedCardId === INDEX_CARD_ID}
                aria-label={activeLockedCardId === INDEX_CARD_ID
                  ? 'unlock Assembly index and show all cards'
                  : 'lock Assembly index in a single-card view'}
                onClick={(event) => {
                  event.stopPropagation()
                  toggleCardLock(INDEX_CARD_ID)
                }}
              >
                {activeLockedCardId === INDEX_CARD_ID ? 'unlock card view' : 'lock this card'}
              </button>
              <button
                className="assembly-card__close-button"
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  closeCard()
                }}
              >
                close details
              </button>
            </div>

          <input
            aria-label="assembly title"
            placeholder="assembly title"
            value={selectedAssembly.data.name}
            readOnly={readOnly}
            onFocus={() => setFocusedCardId(INDEX_CARD_ID)}
            onChange={(event) => {
              if (!readOnly) onNameChange(selectedAssembly.id, event.target.value)
            }}
            style={{
              ...transparentInput,
              marginBottom: 'clamp(18px, 3vw, 34px)',
              fontSize: 'clamp(1.5rem, 4vw, 3.1rem)',
              lineHeight: 1.08,
            }}
          />
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.3fr) minmax(180px, 0.7fr)', gap: '6%' }}>
            <div style={{ display: 'grid', alignContent: 'start', gap: 8 }}>
              <ol style={{ margin: 0, paddingLeft: '1.45em', fontSize: 'clamp(0.8rem, 1.8vw, 1.35rem)', lineHeight: 1.55 }}>
                {assemblyOperations.length ? assemblyOperations.map((operation, operationIndex) => (
                  <li key={operation.id}>
                    {readOnly ? (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation()
                          setFocusedCardId(operation.id)
                        }}
                        style={{ padding: 0, border: 0, background: 'transparent', color: 'inherit', font: 'inherit', textAlign: 'left', cursor: 'pointer' }}
                      >
                        {nodeTitle(operation)}
                      </button>
                    ) : (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, width: '100%', minWidth: 0 }}>
                        <input
                          aria-label={`Card ${nodeTitle(operation)} name`}
                          value={operation.data.name}
                          placeholder="card name"
                          onClick={(event) => event.stopPropagation()}
                          onFocus={() => setFocusedCardId(operation.id)}
                          onChange={(event) => onNameChange(operation.id, event.target.value)}
                          style={{ ...transparentInput, flex: '1 1 auto', minWidth: 0, font: 'inherit' }}
                        />
                        <span style={{ display: 'inline-flex', gap: 2 }}>
                          <button
                            className="text-action"
                            type="button"
                            aria-label={`move ${nodeTitle(operation)} card up`}
                            title="Move card up"
                            disabled={operationIndex === 0}
                            onClick={(event) => {
                              event.stopPropagation()
                              onReorderOperation(selectedAssembly.id, operation.id, 'up')
                            }}
                          >
                            ↑
                          </button>
                          <button
                            className="text-action"
                            type="button"
                            aria-label={`move ${nodeTitle(operation)} card down`}
                            title="Move card down"
                            disabled={operationIndex === assemblyOperations.length - 1}
                            onClick={(event) => {
                              event.stopPropagation()
                              onReorderOperation(selectedAssembly.id, operation.id, 'down')
                            }}
                          >
                            ↓
                          </button>
                        </span>
                        <button
                          className="text-action"
                          type="button"
                          aria-label={`remove ${nodeTitle(operation)} card`}
                          title="Remove card"
                          onClick={(event) => {
                            event.stopPropagation()
                            onRemoveOperation(operation.id)
                          }}
                          style={{ paddingInline: 4 }}
                        >
                          ×
                        </button>
                      </span>
                    )}
                  </li>
                )) : <li style={{ color: 'var(--osa-muted)' }}>add the first instruction card.</li>}
              </ol>
              {!readOnly ? (
                <button
                  className="text-action"
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    addCard()
                  }}
                  style={{ justifySelf: 'start' }}
                >
                  + card
                </button>
              ) : null}
            </div>
            <textarea
              aria-label="assembly overview"
              placeholder="purpose, assumptions, or notes for this assembly"
              value={selectedAssembly.data.text}
              readOnly={readOnly}
              onFocus={() => setFocusedCardId(INDEX_CARD_ID)}
              onChange={(event) => {
                if (!readOnly) onTextChange(selectedAssembly.id, event.target.value)
              }}
              style={{
                ...transparentInput,
                minHeight: 120,
                resize: 'none',
                color: 'var(--osa-muted)',
                fontSize: 'clamp(0.72rem, 1.35vw, 1rem)',
                lineHeight: 1.45,
              }}
            />
          </div>
          {assemblyCardSteps.length ? (
            <section className="assembly-index-card__steps" aria-label="instruction steps">
              <strong>steps</strong>
              <ol>
                {assemblyCardSteps.map(({ operation, step, index }) => (
                  <li key={step.id}>
                    <span>{nodeTitle(operation)} · Step {index + 1}</span>
                    <strong>{nodeTitle(step)}</strong>
                    {step.data.text.trim() ? <p>{step.data.text}</p> : null}
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
          {assemblyParts.length ? (
            <section className="assembly-index-card__objects" aria-label="parts and materials in this assembly">
              <strong>parts &amp; subassemblies</strong>
              <div>
                {assemblyParts.map((part) => (
                  <span className="assembly-object-chip" key={part.id}>
                    <button
                      type="button"
                      className={appearanceAccentColor(part)
                        ? 'assembly-object-link assembly-object-link--accented'
                        : 'assembly-object-link'}
                      style={semanticAccentStyle(part)}
                      onClick={(event) => {
                        event.stopPropagation()
                        onOpenNode(part.id)
                      }}
                    >
                      {nodeTitle(part)}
                    </button>
                    {!readOnly ? (
                      <button
                        className="assembly-object-unlink"
                        type="button"
                        aria-label={`remove ${nodeTitle(part)} from this Assembly`}
                        onClick={(event) => {
                          event.stopPropagation()
                          onUnlinkAssemblyPart(selectedAssembly.id, part.id)
                        }}
                      >
                        <span aria-hidden="true">×</span> remove
                      </button>
                    ) : null}
                  </span>
                ))}
              </div>
            </section>
          ) : null}
          {assemblyExpenses.length ? (
            <section className="assembly-index-card__objects" aria-label="expenses in this assembly">
              <strong>expenses</strong>
              <div>
                {assemblyExpenses.map((expense) => (
                  <span className="assembly-object-chip" key={expense.id}>
                    <button
                      type="button"
                      className="assembly-object-link"
                      onClick={(event) => {
                        event.stopPropagation()
                        onOpenNode(expense.id)
                      }}
                    >
                      {nodeTitle(expense)}
                    </button>
                    {!readOnly ? (
                      <button
                        className="assembly-object-unlink"
                        type="button"
                        aria-label={`remove ${nodeTitle(expense)} from this Assembly`}
                        onClick={(event) => {
                          event.stopPropagation()
                          onUnlinkAssemblyExpense(selectedAssembly.id, expense.id)
                        }}
                      >
                        <span aria-hidden="true">×</span> remove
                      </button>
                    ) : null}
                  </span>
                ))}
              </div>
            </section>
          ) : null}
          {assemblySemanticItems.length ? (
            <section className="assembly-semantic-table" aria-label="semantic information">
              <strong>semantic information</strong>
              <table>
                <thead>
                  <tr>
                    <th scope="col">item</th>
                    <th scope="col">kind</th>
                    <th scope="col">color</th>
                    {!readOnly ? <th scope="col">remove</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {assemblySemanticItems.map(({ node, kind }) => {
                    const accent = appearanceAccentColor(node)
                    const canEditColor = !readOnly && Boolean(onPropertyChange)
                    return (
                      <tr key={node.id}>
                        <td>
                          <button
                            type="button"
                            className={accent
                              ? 'assembly-object-link assembly-object-link--accented'
                              : 'assembly-object-link'}
                            style={semanticAccentStyle(node)}
                            onClick={(event) => {
                              event.stopPropagation()
                              onOpenNode(node.id)
                            }}
                          >
                            {nodeTitle(node)}
                          </button>
                        </td>
                        <td>{kind}</td>
                        <td>
                          <span className="assembly-semantic-table__color-control">
                            <input
                              type="color"
                              aria-label={`Set semantic color for ${nodeTitle(node)}`}
                              value={accent ?? '#d6d6d6'}
                              disabled={!canEditColor}
                              onClick={(event) => event.stopPropagation()}
                              onChange={(event) => onPropertyChange?.(
                                node.id,
                                OSA_PROPERTY.appearanceAccentColor,
                                event.target.value,
                              )}
                            />
                            <output>{accent ?? 'default'}</output>
                            {canEditColor ? (
                              <button
                                className="assembly-semantic-table__default"
                                type="button"
                                aria-label={`Use the default color for ${nodeTitle(node)}`}
                                aria-pressed={!accent}
                                onClick={(event) => {
                                  event.stopPropagation()
                                  onPropertyChange?.(node.id, OSA_PROPERTY.appearanceAccentColor, '')
                                }}
                              >
                                default
                              </button>
                            ) : null}
                          </span>
                        </td>
                        {!readOnly ? (
                          <td>
                            {kind === 'part' && assemblyPartIds.has(node.id) ? (
                              <button
                                className="assembly-object-unlink"
                                type="button"
                                aria-label={`remove ${nodeTitle(node)} from this Assembly`}
                                onClick={(event) => {
                                  event.stopPropagation()
                                  onUnlinkAssemblyPart(selectedAssembly.id, node.id)
                                }}
                              >
                                <span aria-hidden="true">×</span> remove
                              </button>
                            ) : null}
                          </td>
                        ) : null}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </section>
          ) : null}
          {!readOnly ? (
            <div className="assembly-index-card__create-actions">
              <button
                className="text-action"
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  onOpenNode(onCreatePart(selectedAssembly.id))
                }}
              >
                add part
              </button>
              <button
                className="text-action"
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  onOpenNode(onCreateExpense(selectedAssembly.id))
                }}
              >
                add expense
              </button>
            </div>
          ) : null}
            </>
          ) : (
            <button
              className="assembly-card__summary"
              type="button"
              aria-label={`Open ${nodeTitle(selectedAssembly)} details`}
              aria-expanded={false}
              onClick={() => openCard(INDEX_CARD_ID)}
            >
              <strong className="assembly-card__summary-title">{nodeTitle(selectedAssembly)}</strong>
              {assemblyOperations.length ? (
                <ol className="assembly-index-card__summary-index" aria-label="instruction cards">
                  {assemblyOperations.map((operation) => (
                    <li key={operation.id}>{nodeTitle(operation)}</li>
                  ))}
                </ol>
              ) : null}
            </button>
          )}
        </article> : null}

        {assemblyOperations.map((operation, operationIndex) => {
          if (activeLockedCardId && activeLockedCardId !== operation.id) return null
          const focused = activeFocusedCardId === operation.id
          const tools = connectedTargets(
            operation.id,
            nodes,
            edges,
            OSA_RELATION.operationTool,
            /\b(tool|tools)\b/i,
          )
          const steps = stepsForOperation(operation.id, nodes, edges)
          // Compact Assembly cards use precisely the same visual contract as
          // the team-facing instructions: a Step contributes its one
          // deliberately published canvas. Source slides and other
          // authoring-only Visual links stay out of the instruction.
          const stepCanvases = steps.flatMap((step) => {
            const canvas = canvasOwnedByStep(step.id, nodes, edges)
            // A team-facing instruction is intentionally opt-in. Authoring
            // canvases, source slides, and empty work surfaces stay in the
            // Assembly workbench until the author chooses to publish a
            // finished, non-empty Step canvas.
            return canvas
              && canvas.data.properties[OSA_PROPERTY.visualIncludeInInstructions] === 'true'
              && visualHasInstructionContent(canvas, nodes, edges)
              ? [{ step, canvas }]
              : []
          })
          // The authoring card shows each non-empty Step canvas, whether or
          // not it has been checked for the team-facing instruction packet.
          // That keeps an unfinished draft visible without accidentally
          // publishing it. A source slide or a part/tool library image never
          // appears here merely because it exists elsewhere in the project.
          const stepVisuals = steps.flatMap((step) => {
            const canvas = canvasOwnedByStep(step.id, nodes, edges)
            return canvas && visualHasInstructionContent(canvas, nodes, edges)
              ? [{ step, canvas }]
              : []
          })
          // Older OSA boards used one undirected "operation item" relation.
          // Treat those as inputs so opening an existing board does not make
          // its parts disappear alongside the newer structured in/out edges.
          const legacyInputParts = connectedTargets(
            operation.id,
            nodes,
            edges,
            OSA_RELATION.operationItem,
            /\b(part|parts|material|materials|component|components)\b/i,
          ).filter((node) => node.data.kind !== 'tool' && osaRole(node) !== 'tool')
          const structuredInputParts = connectedTargets(
            operation.id,
            nodes,
            edges,
            OSA_RELATION.operationInput,
            /\b(parts? in|input|inputs|requires?|needs?)\b/i,
          )
          // Once an operation has an explicit In list, it is authoritative.
          // Keep old `operation-item` links as a display fallback only for
          // boards that have not yet gained any structured input data.
          const inputParts = structuredInputParts.length
            ? structuredInputParts
            : legacyInputParts
          const availableParts = uniqueNodes(
            // An Assembly is a part-like object too. Keep the current parent
            // in the picker so someone can explicitly use it as an input or
            // output when that is the real relationship for their work.
            [selectedAssembly],
            assemblyParts,
            nodes.filter(isPartLike),
          )
          const toolDraftForOperation = toolDraftFor?.operationId === operation.id
            ? toolDraftFor
            : null
          const isOpen = activeOpenCardId === operation.id
          const focusCard = () => {
            setFocusedCardId(operation.id)
          }
          const openOperation = () => openCard(operation.id)

          return (
            <article
              className={`assembly-card assembly-operation-card${isOpen ? ' is-focused is-open' : ' is-summary'}`}
              style={{ ...cardShell, ...(isOpen ? {} : { padding: 0 }), ...cardFocusStyle(isOpen) }}
              tabIndex={0}
              key={operation.id}
              aria-label={`instruction card ${operationIndex + 1}: ${nodeTitle(operation)}`}
              onClick={() => {
                if (!isOpen) openOperation()
              }}
              onKeyDown={(event) => cardKeyDown(event, openOperation)}
            >
              {isOpen ? (
                <>
                <div className="assembly-card__focus-controls">
                  <button
                    className="assembly-card__close-button"
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation()
                      closeCard()
                    }}
                  >
                    close details
                  </button>
                  <button
                    className="assembly-card__lock-button"
                    type="button"
                    aria-pressed={activeLockedCardId === operation.id}
                    aria-label={activeLockedCardId === operation.id
                      ? `unlock ${nodeTitle(operation)} and show all cards`
                      : `lock ${nodeTitle(operation)} in a single-card view`}
                    onClick={(event) => {
                      event.stopPropagation()
                      toggleCardLock(operation.id)
                    }}
                  >
                    {activeLockedCardId === operation.id ? 'unlock card view' : 'lock this card'}
                  </button>
                </div>

              <div className="assembly-card__columns">
                <div className="assembly-card__details">
                  <input
                    className="assembly-card__title"
                    aria-label={`instruction ${operationIndex + 1} title`}
                    placeholder={`instruction ${operationIndex + 1} title`}
                    value={operation.data.name}
                    readOnly={readOnly}
                    onFocus={focusCard}
                    onChange={(event) => {
                      if (!readOnly) onNameChange(operation.id, event.target.value)
                    }}
                    style={{
                      ...transparentInput,
                      // The View intentionally receives more width than the
                      // editable facts column. Keep ordinary operation titles
                      // fully legible in that narrower column instead of
                      // letting a large display size clip their final words.
                      fontSize: 'clamp(1.15rem, 2.25vw, 2.1rem)',
                      lineHeight: 1.05,
                    }}
                  />
                  <section
                    aria-label={`${nodeTitle(operation)} parts and tools`}
                    style={{ display: 'grid', gap: 8, minWidth: 0 }}
                  >
                    <strong style={{ fontSize: 'clamp(0.76rem, 1.5vw, 1.15rem)', fontWeight: 500 }}>
                      parts &amp; tools
                    </strong>

                  <div style={fieldLabel}>
                    <span>parts in</span>
                    <div style={{ minWidth: 0 }}>
                      <div className="assembly-linked-object-list" style={{ minHeight: '1.3em' }}>
                        {inputParts.length
                          ? inputParts.map((part, index) => (
                            <span className="assembly-object-chip" key={part.id}>
                              {index ? <span aria-hidden="true"> · </span> : null}
                              <button
                                className={appearanceAccentColor(part)
                                  ? 'assembly-object-link assembly-object-link--accented'
                                  : 'assembly-object-link'}
                                type="button"
                                style={semanticAccentStyle(part)}
                                onClick={(event) => {
                                  event.stopPropagation()
                                  onOpenNode(part.id)
                                }}
                              >
                                {nodeTitle(part)}
                              </button>
                              {focused && !readOnly && onUnlinkPartInput ? (
                                <button
                                  className="assembly-object-unlink"
                                  type="button"
                                  title="remove from this instruction's in list"
                                  aria-label={`remove ${nodeTitle(part)} from this instruction's in list`}
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    onUnlinkPartInput(operation.id, part.id)
                                  }}
                                >
                                  <span aria-hidden="true">×</span> remove
                                </button>
                              ) : null}
                            </span>
                          ))
                          : <span className="assembly-card__empty-link-list">link the parts or assemblies needed.</span>}
                      </div>
                      {focused && !readOnly ? (
                        <select
                          aria-label="link or add a part coming into this instruction"
                          defaultValue=""
                          onChange={(event) => {
                            const partId = event.currentTarget.value
                            event.currentTarget.value = ''
                            if (partId === NEW_PART_OPTION) {
                              onCreatePartForOperation?.(operation.id, 'input')
                              return
                            }
                            if (partId) (onLinkPartInput ?? onLinkPart)(operation.id, partId)
                          }}
                          style={{ ...transparentInput, marginTop: 5, borderBottom: '1px solid var(--osa-border)' }}
                        >
                          <option value="">link or add a part or assembly…</option>
                          {availableParts.map((part) => {
                            const isLinked = inputParts.some((linkedPart) => linkedPart.id === part.id)
                            return (
                              <option value={part.id} disabled={isLinked} key={part.id}>
                                {isLinked
                                  ? `${nodeTitle(part)} · already in this instruction`
                                  : nodeTitle(part)}
                              </option>
                            )
                          })}
                          {onCreatePartForOperation ? (
                            <optgroup label="create">
                              <option value={NEW_PART_OPTION}>+ add a part placeholder…</option>
                            </optgroup>
                          ) : null}
                        </select>
                      ) : null}
                    </div>
                  </div>

                  <div style={fieldLabel}>
                    <span>tools</span>
                    <div style={{ minWidth: 0 }}>
                      <div className="assembly-linked-object-list" style={{ minHeight: '1.3em' }}>
                        {tools.length
                          ? tools.map((tool, index) => (
                            <span className="assembly-object-chip" key={tool.id}>
                              {index ? <span aria-hidden="true"> · </span> : null}
                              <button
                                className={appearanceAccentColor(tool)
                                  ? 'assembly-object-link assembly-object-link--accented'
                                  : 'assembly-object-link'}
                                type="button"
                                style={semanticAccentStyle(tool)}
                                onClick={(event) => {
                                  event.stopPropagation()
                                  onOpenNode(tool.id)
                                }}
                              >
                                {nodeTitle(tool)}
                              </button>
                              {focused && !readOnly && onUnlinkTool ? (
                                <button
                                  className="assembly-object-unlink"
                                  type="button"
                                  title="remove from this instruction's tools list"
                                  aria-label={`remove ${nodeTitle(tool)} from this instruction's tools list`}
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    onUnlinkTool(operation.id, tool.id)
                                  }}
                                >
                                  <span aria-hidden="true">×</span> remove
                                </button>
                              ) : null}
                            </span>
                          ))
                          : <span style={{ color: 'var(--osa-muted)' }}>add the tools needed here.</span>}
                      </div>
                      {focused && !readOnly ? (
                        <select
                          aria-label="link or add a tool for this instruction"
                          defaultValue=""
                          onChange={(event) => {
                            const selectedValue = event.currentTarget.value
                            event.currentTarget.value = ''
                            if (selectedValue === NEW_TOOL_OPTION || selectedValue === PLACEHOLDER_TOOL_OPTION) {
                              setToolDraftFor({
                                operationId: operation.id,
                                placeholder: selectedValue === PLACEHOLDER_TOOL_OPTION,
                              })
                              setToolDraft('')
                              return
                            }
                            if (selectedValue) onLinkTool?.(operation.id, selectedValue)
                          }}
                          style={{ ...transparentInput, marginTop: 5, borderBottom: '1px solid var(--osa-border)' }}
                        >
                          <option value="">link or add a tool…</option>
                          {toolInventory.length ? (
                            <optgroup label="tool inventory">
                              {toolInventory.map((tool) => {
                                const isLinked = tools.some((linkedTool) => linkedTool.id === tool.id)
                                return (
                                  <option value={tool.id} disabled={isLinked} key={tool.id}>
                                    {isLinked ? `${nodeTitle(tool)} · already in this instruction` : nodeTitle(tool)}
                                  </option>
                                )
                              })}
                            </optgroup>
                          ) : null}
                          <optgroup label="create">
                            <option value={NEW_TOOL_OPTION}>+ add a tool…</option>
                            <option value={PLACEHOLDER_TOOL_OPTION}>+ placeholder tool…</option>
                          </optgroup>
                        </select>
                      ) : null}
                      {toolDraftForOperation && !readOnly ? (
                        <form
                          style={{ display: 'flex', gap: 8, marginTop: 5 }}
                          onSubmit={(event) => {
                            event.preventDefault()
                            const name = toolDraft.trim()
                            if (!name) return
                            onCreateTool(operation.id, name, {
                              placeholder: toolDraftForOperation.placeholder,
                            })
                            setToolDraft('')
                            setToolDraftFor(null)
                          }}
                        >
                          <input
                            aria-label={toolDraftForOperation.placeholder ? 'new tool placeholder' : 'new linked tool'}
                            placeholder={toolDraftForOperation.placeholder ? 'tool to determine' : 'tool name'}
                            value={toolDraft}
                            onChange={(event) => setToolDraft(event.target.value)}
                            style={{ ...transparentInput, borderBottom: '1px solid var(--osa-border)' }}
                          />
                          <button className="text-action" type="submit">add</button>
                          <button
                            className="text-action"
                            type="button"
                            onClick={() => {
                              setToolDraft('')
                              setToolDraftFor(null)
                            }}
                          >
                            cancel
                          </button>
                        </form>
                      ) : null}
                    </div>
                  </div>
                  </section>

                  <section style={{ display: 'grid', gap: 5, minWidth: 0 }} aria-label={`${nodeTitle(operation)} steps`}>
                    <strong style={{ fontSize: 'clamp(0.76rem, 1.5vw, 1.15rem)', fontWeight: 500 }}>steps</strong>
                    {steps.length === 0 ? (
                      <textarea
                        aria-label={`${nodeTitle(operation)} steps`}
                        placeholder="write the first instruction here."
                        rows={focused ? 6 : 3}
                        value={operation.data.text}
                        readOnly={readOnly}
                        onFocus={focusCard}
                        onChange={(event) => {
                          if (!readOnly) onTextChange(operation.id, event.target.value)
                        }}
                        style={{ ...transparentInput, minHeight: focused ? '7.5em' : '3.9em', resize: 'none', lineHeight: 1.35 }}
                      />
                    ) : null}
                    {steps.length ? (
                      <ol style={{ display: 'grid', gap: 14, margin: 0, padding: 0, listStyle: 'none' }}>
                        {steps.map((step, stepIndex) => {
                          const stepCanvas = canvasOwnedByStep(step.id, nodes, edges)
                          const includeStepCanvas = stepCanvas?.data.properties[
                            OSA_PROPERTY.visualIncludeInInstructions
                          ] === 'true'
                          return (
                            <li key={step.id} style={{ display: 'grid', gap: 7, minWidth: 0 }}>
                              <div style={{ display: 'grid', gap: 4, minWidth: 0 }}>
                                <span style={{ color: 'var(--osa-muted)', fontSize: '0.76rem', fontWeight: 600 }}>
                                  Step {stepIndex + 1}
                                </span>
                                <input
                                  aria-label={`Step ${stepIndex + 1} name`}
                                  value={step.data.name}
                                  readOnly={readOnly}
                                  onClick={(event) => event.stopPropagation()}
                                  onFocus={focusCard}
                                  onChange={(event) => {
                                    if (!readOnly) onNameChange(step.id, event.target.value)
                                  }}
                                  style={{ ...transparentInput, width: '100%', fontSize: '1rem', fontWeight: 600 }}
                                />
                              </div>
                              {!readOnly ? (
                                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, minWidth: 0 }}>
                                  <span style={{ display: 'inline-flex', gap: 2 }}>
                                    <button
                                      className="text-action"
                                      type="button"
                                      aria-label={`move ${nodeTitle(step)} up`}
                                      title="Move up"
                                      disabled={stepIndex === 0}
                                      onClick={(event) => {
                                        event.stopPropagation()
                                        onReorderStep(operation.id, step.id, 'up')
                                      }}
                                    >
                                      ↑
                                    </button>
                                    <button
                                      className="text-action"
                                      type="button"
                                      aria-label={`move ${nodeTitle(step)} down`}
                                      title="Move down"
                                      disabled={stepIndex === steps.length - 1}
                                      onClick={(event) => {
                                        event.stopPropagation()
                                        onReorderStep(operation.id, step.id, 'down')
                                      }}
                                    >
                                      ↓
                                    </button>
                                  </span>
                                  <button
                                    className="text-action"
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation()
                                      const visualId = onEnsureStepCanvas(step.id)
                                      if (visualId) setEditingVisual(visualId, operation.id)
                                    }}
                                  >
                                    {stepCanvas ? 'canvas' : '+ canvas'}
                                  </button>
                                  {stepCanvas && onPropertyChange ? (
                                    <label
                                      style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: '0.72rem', whiteSpace: 'nowrap' }}
                                      onClick={(event) => event.stopPropagation()}
                                    >
                                      <input
                                        type="checkbox"
                                        aria-label={`Show ${nodeTitle(step)} canvas in Assembly Instructions`}
                                        checked={includeStepCanvas}
                                        onChange={(event) => onPropertyChange(
                                          stepCanvas.id,
                                          OSA_PROPERTY.visualIncludeInInstructions,
                                          event.currentTarget.checked ? 'true' : 'false',
                                        )}
                                      />
                                      show
                                    </label>
                                  ) : null}
                                </div>
                              ) : null}
                              <textarea
                                aria-label={`${nodeTitle(step)} instructions`}
                                placeholder="describe this step."
                                rows={focused ? 3 : 2}
                                value={step.data.text}
                                readOnly={readOnly}
                                onClick={(event) => event.stopPropagation()}
                                onFocus={focusCard}
                                onChange={(event) => {
                                  if (!readOnly) onTextChange(step.id, event.target.value)
                                }}
                                style={{
                                  ...transparentInput,
                                  minHeight: focused ? '3.9em' : '2.7em',
                                  resize: 'none',
                                  color: 'var(--osa-text)',
                                  fontSize: '0.95rem',
                                  lineHeight: 1.45,
                                }}
                              />
                            </li>
                          )
                        })}
                      </ol>
                    ) : null}
                    {focused && !readOnly ? (
                      <button
                        className="text-action"
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation()
                          onCreateStep(operation.id)
                        }}
                        style={{ justifySelf: 'start' }}
                      >
                        add step
                      </button>
                    ) : null}
                  </section>
                </div>

                <section className="assembly-card__view" aria-label={`${nodeTitle(operation)} visuals`}>
                  <header className="assembly-card__view-header">
                    <h2>visuals</h2>
                  </header>
                  {stepVisuals.length ? (
                    <div className="assembly-instructions-view__canvas-list">
                      {stepVisuals.map(({ step, canvas }, index) => (
                        <figure className="assembly-instructions-view__step-canvas" key={canvas.id}>
                          <figcaption>
                            <strong>Step {index + 1}</strong>
                            <span>{nodeTitle(step)}</span>
                          </figcaption>
                          <button
                            className="assembly-instructions-view__open-canvas"
                            type="button"
                            aria-label={`open ${nodeTitle(step)} visual`}
                            title="Open visual"
                            onClick={(event) => {
                              event.stopPropagation()
                              setEditingVisual(canvas.id, operation.id)
                            }}
                          >
                            <VisualCanvasPreview
                              visual={canvas}
                              embeddedVisuals={visualEmbedsForCanvas(canvas.id, nodes, edges)}
                              annotationTargets={annotationTargets}
                              className="assembly-card__visual-preview"
                            />
                          </button>
                        </figure>
                      ))}
                    </div>
                  ) : (
                    <p className="assembly-card__empty-link-list">no step visual yet.</p>
                  )}
                </section>
              </div>
                </>
              ) : (
                <button
                  className={stepCanvases.length
                    ? 'assembly-card__summary assembly-card__summary--with-canvases'
                    : 'assembly-card__summary'}
                  type="button"
                  aria-label={`Open ${nodeTitle(operation)} details`}
                  aria-expanded={false}
                  onClick={openOperation}
                >
                  <span className="assembly-card__summary-content">
                    <span className="assembly-card__summary-kicker">instruction {operationIndex + 1}</span>
                    <strong className="assembly-card__summary-title">{nodeTitle(operation)}</strong>
                    <span className="assembly-card__summary-fields">
                      <span>
                        <b>parts in</b>
                        {inputParts.length ? inputParts.map(nodeTitle).join(' · ') : 'no parts linked'}
                      </span>
                      <span>
                        <b>tools</b>
                        {tools.length ? tools.map(nodeTitle).join(' · ') : 'no tools linked'}
                      </span>
                    </span>
                    {steps.length ? (
                      <span className="assembly-card__summary-steps">
                        <b>steps</b>
                        {steps.map((step, stepIndex) => (
                          <span className="assembly-card__summary-step" key={step.id}>
                            <strong>Step {stepIndex + 1} · {nodeTitle(step)}</strong>
                            {step.data.text.trim() ? <span>{step.data.text}</span> : null}
                          </span>
                        ))}
                      </span>
                    ) : (
                      <span className="assembly-card__summary-steps">
                        <b>steps</b>
                        <span className="assembly-card__summary-notes">
                          {operation.data.text.trim() || 'no steps yet'}
                        </span>
                      </span>
                    )}
                  </span>
                  {stepCanvases.length ? (
                    <span
                      className="assembly-card__summary-view"
                      aria-label={`${nodeTitle(operation)} step canvases`}
                    >
                      <span className="assembly-card__summary-view-header">step canvases</span>
                      <span className="assembly-card__summary-canvas-list">
                        {stepCanvases.map(({ step, canvas }, stepCanvasIndex) => (
                          <span className="assembly-card__summary-step-canvas" key={canvas.id}>
                            <span className="assembly-card__summary-step-canvas-label">
                              <b>Step {stepCanvasIndex + 1}</b>
                              <span>{nodeTitle(step)}</span>
                            </span>
                            <VisualCanvasPreview
                              visual={canvas}
                              embeddedVisuals={visualEmbedsForCanvas(canvas.id, nodes, edges)}
                              annotationTargets={annotationTargets}
                              className="assembly-card__visual-preview assembly-card__summary-canvas-preview"
                            />
                          </span>
                        ))}
                      </span>
                    </span>
                  ) : null}
                </button>
              )}
            </article>
          )
        })}
      </div>
    </section>
  )
}
