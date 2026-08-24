import {
  useMemo,
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
  canOwnOsaVisual,
  isImmutableVisual,
  isPartLike,
  operationVisualDisplayOrder,
  osaRole,
  type OperationVisualPlacement,
} from '../graph/osaData'
import type { SketchDocument, TextFlowNode } from '../graph/textNode'
import {
  isVisualNode,
  visualAccentColor,
  visualOwnerFor,
  visualDraftEmbedsForCanvas,
  visualEmbedsForCanvas,
  type VisualEmbedInstance,
} from '../graph/visualEmbed'
import type { AssemblyToolDraft, AssemblyViewUiState } from './assemblyViewState'
import {
  canvasOwnedByStep,
  connectedTargets,
  nodeTitle,
  operationsForAssembly,
  stepsForOperation,
} from './assemblyProjection'
import { VisualCanvasEditor, VisualCanvasPreview } from './VisualCanvas'
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
  /** Publishes direct canvas -> Visual placements when the editor locks. */
  onEmbeddedVisualsChange?: (parentVisualId: string, embeds: VisualEmbedInstance[]) => void
  /** Saves an editable canvas record without changing the card-visible official version. */
  onSaveVisualDraftVersion?: (visualId: string) => void
  /** Makes the canvas's current draft the one version cards display. */
  onMakeVisualOfficialVersion?: (visualId: string) => void
  /** Opens one saved visual record as the canvas's current editable draft. */
  onRestoreVisualVersion?: (visualId: string, versionId: string) => void
  /** Clones an OSA drawing into an independently editable canonical Visual. */
  onCreateIndependentVisualCopy?: (sourceVisualId: string) => TextFlowNode | null
  onNameChange: (nodeId: string, name: string) => void
  onTextChange: (nodeId: string, text: string) => void
  /** Updates durable Visual metadata chosen inside the canvas editor. */
  onPropertyChange?: (nodeId: string, propertyName: string, value: string) => void
  onOpenNode: (nodeId: string) => void
  onSketchChange?: (nodeId: string, sketch: SketchDocument) => void
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
}

/** An object owns its reusable visual; an instruction only links to it. */
function objectImageSource(node: TextFlowNode | undefined) {
  return node?.data.properties[OSA_PROPERTY.assetImage]?.trim() ?? ''
}

function objectImageAlt(node: TextFlowNode | undefined) {
  return node?.data.properties[OSA_PROPERTY.assetImageAlt]?.trim()
    || (node ? nodeTitle(node) : '')
}

/**
 * Card-linked Visuals have an explicit relationship order once a person
 * changes it. Older boards have no order value, so their existing edge order
 * remains their visible order until then.
 */
function orderedOperationVisualTargets(
  operationId: string,
  candidates: TextFlowNode[],
  edges: GraphEdge[],
) {
  const nodesById = new Map(candidates.map((node) => [node.id, node]))
  return edges
    .map((edge, edgeIndex) => ({ edge, edgeIndex }))
    .filter(({ edge }) => (
      edge.source === operationId
      && edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.operationVisual
      && nodesById.has(edge.target)
    ))
    .sort((left, right) => (
      operationVisualDisplayOrder(
        left.edge.data.properties[OSA_PROPERTY.operationVisualOrder],
        left.edgeIndex,
      )
      - operationVisualDisplayOrder(
        right.edge.data.properties[OSA_PROPERTY.operationVisualOrder],
        right.edgeIndex,
      )
      || left.edgeIndex - right.edgeIndex
    ))
    .map(({ edge }) => nodesById.get(edge.target)!)
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

/**
 * The canvas picker stays deliberately local to the card being edited:
 * source slide, current canvases, and Visuals owned by its in/tools/out
 * objects. Broader project-wide filtering is a later view concern.
 */
function visualCandidatesForOperation(
  operationId: string,
  nodes: TextFlowNode[],
  edges: GraphEdge[],
) {
  const stepIds = new Set(edges
    .filter((edge) => (
      edge.source === operationId
      && edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.operationStep
    ))
    .map((edge) => edge.target))
  const contextObjectIds = new Set(edges
    .filter((edge) => {
      if (edge.source === operationId) {
        const role = edge.data.properties[OSA_PROPERTY.relationRole]
        return role === OSA_RELATION.operationInput
          || role === OSA_RELATION.operationOutput
          || role === OSA_RELATION.operationPrimaryOutput
          || role === OSA_RELATION.operationTool
      }
      return edge.target === operationId
        && (
          edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.assemblyOperation
          || edge.data.relationKind === 'project-task'
        )
    })
    .map((edge) => edge.source === operationId ? edge.target : edge.source))

  const directVisualIds = edges
    .filter((edge) => (
      edge.source === operationId
      && (
        edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.operationVisual
        || edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.operationSourceVisual
      )
    ))
    .map((edge) => edge.target)
  const ownedVisualIds = edges
    .filter((edge) => (
      (contextObjectIds.has(edge.source) || stepIds.has(edge.source))
      && edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.objectVisual
    ))
    .map((edge) => edge.target)

  return uniqueNodes(nodes.filter((node) => (
    (directVisualIds.includes(node.id) || ownedVisualIds.includes(node.id))
    && isVisualNode(node)
  )))
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
  onUnlinkObjectVisual,
  onReorderOperationVisual,
  onCreateOwnedVisualForOperation,
  onChangeVisualOwner,
  onEmbeddedVisualsChange,
  onSaveVisualDraftVersion,
  onMakeVisualOfficialVersion,
  onRestoreVisualVersion,
  onCreateIndependentVisualCopy,
  onNameChange,
  onTextChange,
  onPropertyChange,
  onSketchChange,
  onOpenNode,
  readOnly = false,
  onShare,
  shareSlug,
  onShareSlugChange,
  onPreviewInstructions,
  shareStatus,
  shareUrl,
  onLoadShakoStarter,
}: AssemblyViewProps) {
  const selectedAssembly = assemblies.find((assembly) => assembly.id === selectedAssemblyId)
    ?? assemblies[0]
  const assemblyOperations = useMemo(() => selectedAssembly
    ? operationsForAssembly(selectedAssembly.id, operations, edges)
    : [], [edges, operations, selectedAssembly])
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
    lockedCardId,
    editingVisualId,
    editingOperationId,
    toolDraft,
    toolDraftFor,
    // Older in-memory UI state can survive a hot reload. Treat a missing
    // filter map as the normal "show everything" state.
    hiddenVisualOwnerIdsByOperation = {},
  } = uiState
  // These small setters keep the card code readable while routing every
  // presentation change through App. App stays mounted when Assembly is
  // hidden, so this state comes back intact after Assembly -> another view ->
  // Assembly. It is intentionally not part of the saved graph.
  const setFocusedCardId = (nextCardId: string) => {
    onUiStateChange((current) => ({ ...current, focusedCardId: nextCardId }))
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
  /** Hides an owner's canvases from one card without touching the graph. */
  const setVisualOwnerVisible = (
    operationId: string,
    ownerId: string,
    isVisible: boolean,
  ) => {
    onUiStateChange((current) => {
      const hiddenByOperation = current.hiddenVisualOwnerIdsByOperation ?? {}
      const hiddenOwnerIds = new Set(hiddenByOperation[operationId] ?? [])
      if (isVisible) hiddenOwnerIds.delete(ownerId)
      else hiddenOwnerIds.add(ownerId)

      const nextHiddenByOperation = { ...hiddenByOperation }
      if (hiddenOwnerIds.size) nextHiddenByOperation[operationId] = [...hiddenOwnerIds]
      else delete nextHiddenByOperation[operationId]

      return {
        ...current,
        hiddenVisualOwnerIdsByOperation: nextHiddenByOperation,
      }
    })
  }
  const activeFocusedCardId = focusedCardId === INDEX_CARD_ID
    || assemblyOperations.some((operation) => operation.id === focusedCardId)
    ? focusedCardId
    : INDEX_CARD_ID
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
  const editingVisualCandidate = editingVisualId
    ? nodes.find((node) => node.id === editingVisualId)
    : undefined
  // A card can deliberately reference either a reusable Visual or an
  // ordinary Part/Tool photo. Only a real Visual opens the canvas editor.
  const editingVisual = isVisualNode(editingVisualCandidate)
    ? editingVisualCandidate
    : undefined
  const editingVisualOwner = editingVisual
    ? visualOwnerFor(editingVisual.id, nodes, edges)
    : undefined
  const editingVisualNameIsInherited = editingVisualOwner !== undefined
    && osaRole(editingVisualOwner) === 'step'
  const canRemoveEditingVisualFromCard = editingVisual !== undefined
    && editingOperationId !== null
    && onUnlinkObjectVisual !== undefined
    && edges.some((edge) => (
      edge.source === editingOperationId
      && edge.target === editingVisual.id
      && edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.operationVisual
    ))
  const editingVisualEmbeds = editingVisual
    ? visualDraftEmbedsForCanvas(editingVisual.id, nodes, edges)
    : []
  const editingVisualCandidates = editingOperationId
    ? visualCandidatesForOperation(editingOperationId, nodes, edges)
    : []

  const createAssembly = () => {
    if (readOnly) return
    const assemblyId = onCreateAssembly(`Assembly ${assemblies.length + 1}`)
    onSelectAssembly(assemblyId)
    setFocusedCardId(INDEX_CARD_ID)
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
    setFocusedCardId(cardId)
  }

  const cardFocusStyle = (focused: boolean): CSSProperties => focused
    ? {
        gridColumn: '1 / -1',
        outline: '3px solid rgb(91 206 250 / 58%)',
        outlineOffset: 4,
      }
    : { cursor: 'pointer' }

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
              {onPreviewInstructions ? (
                <button className="text-action" type="button" onClick={onPreviewInstructions}>
                  preview instructions
                </button>
              ) : null}
              {onShare ? (
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
          className={`assembly-card assembly-index-card${activeFocusedCardId === INDEX_CARD_ID ? ' is-focused' : ''}`}
          style={{ ...cardShell, ...cardFocusStyle(activeFocusedCardId === INDEX_CARD_ID) }}
          tabIndex={0}
          aria-label="assembly index card"
          onClick={() => setFocusedCardId(INDEX_CARD_ID)}
          onKeyDown={(event) => cardKeyDown(event, () => setFocusedCardId(INDEX_CARD_ID))}
        >
          {activeFocusedCardId === INDEX_CARD_ID ? (
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
            </div>
          ) : null}
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
                {assemblyOperations.length ? assemblyOperations.map((operation) => (
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
          // A card's represented part is its primary output. Other outputs
          // are legitimate project objects too, so retain both in the owner
          // picker. A canvas can belong to the thing this card creates.
          const primaryOutputParts = connectedTargets(
            operation.id,
            nodes,
            edges,
            OSA_RELATION.operationPrimaryOutput,
            /\b(represents?|primary output)\b/i,
          )
          const outputParts = connectedTargets(
            operation.id,
            nodes,
            edges,
            OSA_RELATION.operationOutput,
            /\b(produces?|parts? out|output)\b/i,
          )
          // A View reference is its own deliberate relationship. It does not
          // infer a visual from In, Tools, or Out. New cards point at canonical
          // Visual nodes, whose content is owned by a part, assembly, or tool.
          // Existing boards can still display a legacy object image here.
          const includedObjectVisuals = orderedOperationVisualTargets(
            operation.id,
            nodes,
            edges,
          )
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
          const visualReference = operation.data.properties[OSA_PROPERTY.instructionVisual]?.trim() ?? ''
          const linkedSourceVisual = edges.find((edge) => (
            edge.source === operation.id
            && edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.operationSourceVisual
          ))
          const linkedSourceVisualNode = linkedSourceVisual
            ? nodes.find((node) => node.id === linkedSourceVisual.target)
            : undefined
          const referencedVisualNode = nodes.find((node) => node.id === visualReference)
          // New canonical Visual nodes are connected by operation-source-visual
          // and own `asset:image`. Older imports may still point to a source
          // node or a raw URL through instruction:visual, so retain both
          // fallbacks while the existing Shako data remains usable.
          const sourceVisualNode = linkedSourceVisualNode ?? referencedVisualNode
          const visualSource = objectImageSource(sourceVisualNode)
            || sourceVisualNode?.data.properties[OSA_PROPERTY.instructionVisual]?.trim()
            || visualReference
          const visualAlt = operation.data.properties[OSA_PROPERTY.instructionVisualAlt]?.trim()
            || (sourceVisualNode ? objectImageAlt(sourceVisualNode) : '')
            || 'Instruction visual'
          // An instruction can reference two different kinds of visual
          // material: canonical Visual nodes (editable canvases or immutable
          // image Visuals) and a direct primary photo attached to an ordinary
          // Part/Tool. The latter is not a canvas and must not be sent to the
          // canvas editor just because it appears on this card.
          const includedCanvasVisuals = includedObjectVisuals.filter((node) => isVisualNode(node))
          const includedPhotoObjects = includedObjectVisuals.filter((node) => !isVisualNode(node))
          // A source slide is a normal Visual too. Put it first, then show
          // any deliberately added Visuals below it without duplicating a
          // source Visual that also happens to be placed on the card.
          const linkedVisuals = sourceVisualNode
            ? uniqueNodes([sourceVisualNode], includedCanvasVisuals)
            : includedCanvasVisuals
          // The source visual is the instruction's provenance record and
          // remains first. Every directly linked canvas below it, including
          // photo canvases, can be reordered with its operation-to-Visual
          // relationship.
          const reorderableCardVisuals = linkedVisuals.filter((visual) => (
            visual.id !== sourceVisualNode?.id
            && includedCanvasVisuals.some((candidate) => candidate.id === visual.id)
          ))
          // A board saved before source slides became first-class Visual
          // objects keeps its slide as a raw `instruction:visual` URL. It is
          // still the first canvas. Do not let the presence of a later blank
          // reusable Visual hide that source slide.
          const legacySourceImage = sourceVisualNode ? '' : visualSource
          // Keep ownership choice local to this instruction: the parent
          // Assembly, its represented/produced parts, its inputs, tools, and
          // its named Steps. A Step is a real owner, not a hidden UI wrapper.
          const canvasObjectOwners = uniqueNodes(
            selectedAssembly ? [selectedAssembly] : [],
            primaryOutputParts,
            outputParts,
            inputParts,
            tools,
          ).filter(canOwnOsaVisual)
          const canvasOwners = uniqueNodes(canvasObjectOwners, steps)
            .filter(canOwnOsaVisual)
          const hiddenVisualOwnerIds = new Set(
            hiddenVisualOwnerIdsByOperation[operation.id] ?? [],
          )
          // The source slide is provenance and remains visible. Every other
          // object-owned canvas/photo can be hidden by its owner without
          // deleting it or changing a card link.
          const filterableVisualOwners = uniqueNodes(
            linkedVisuals
              .filter((visual) => visual.id !== sourceVisualNode?.id)
              .map((visual) => visualOwnerFor(visual.id, nodes, edges))
              .filter((owner): owner is TextFlowNode => owner !== undefined),
            includedPhotoObjects,
          )
          const visibleLinkedVisuals = linkedVisuals.filter((visual) => {
            if (visual.id === sourceVisualNode?.id) return true
            const owner = visualOwnerFor(visual.id, nodes, edges)
            return !owner || !hiddenVisualOwnerIds.has(owner.id)
          })
          const visibleIncludedPhotoObjects = includedPhotoObjects.filter((object) => (
            !hiddenVisualOwnerIds.has(object.id)
          ))
          const focusCard = () => {
            setFocusedCardId(operation.id)
          }

          return (
            <article
              className={`assembly-card assembly-operation-card${focused ? ' is-focused' : ''}`}
              style={{ ...cardShell, ...cardFocusStyle(focused) }}
              tabIndex={0}
              key={operation.id}
              aria-label={`instruction card ${operationIndex + 1}: ${nodeTitle(operation)}`}
              onClick={focusCard}
              onKeyDown={(event) => cardKeyDown(event, focusCard)}
            >
              {focused ? (
                <div className="assembly-card__focus-controls">
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
              ) : null}
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
                  <strong style={{ fontSize: 'clamp(0.76rem, 1.5vw, 1.15rem)', fontWeight: 500 }}>criteria</strong>

                  <div style={fieldLabel}>
                    <span>in</span>
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

                  <section style={{ display: 'grid', gap: 5, minWidth: 0 }} aria-label={`${nodeTitle(operation)} steps`}>
                    <strong style={{ fontSize: 'clamp(0.76rem, 1.5vw, 1.15rem)', fontWeight: 500 }}>steps</strong>
                    {operation.data.text.trim() || steps.length === 0 ? (
                      <textarea
                        aria-label={`${nodeTitle(operation)} steps`}
                        placeholder="write the complete instructions here."
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
                      <ol style={{ display: 'grid', gap: 8, margin: 0, paddingLeft: '1.35em' }}>
                        {steps.map((step, stepIndex) => {
                          const stepCanvas = canvasOwnedByStep(step.id, nodes, edges)
                          return (
                            <li key={step.id} style={{ display: 'grid', gap: 4, minWidth: 0 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
                                <input
                                  aria-label={`Step ${stepIndex + 1} name`}
                                  value={step.data.name}
                                  readOnly={readOnly}
                                  onClick={(event) => event.stopPropagation()}
                                  onFocus={focusCard}
                                  onChange={(event) => {
                                    if (!readOnly) onNameChange(step.id, event.target.value)
                                  }}
                                  style={{ ...transparentInput, flex: '1 1 auto', fontWeight: 600 }}
                                />
                                {!readOnly ? (
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
                                ) : null}
                                {!readOnly ? (
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
                                ) : null}
                              </div>
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
                                style={{ ...transparentInput, minHeight: focused ? '3.9em' : '2.7em', resize: 'none', lineHeight: 1.35 }}
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

                <section className="assembly-card__view" aria-label={`${nodeTitle(operation)} view`}>
                  <header className="assembly-card__view-header">
                    <h2>visuals</h2>
                    {filterableVisualOwners.length ? (
                      <details
                        className="assembly-card__visual-filter"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <summary>filter</summary>
                        <div className="assembly-card__visual-filter-options">
                          {filterableVisualOwners.map((owner) => (
                            <label key={owner.id}>
                              <input
                                type="checkbox"
                                checked={!hiddenVisualOwnerIds.has(owner.id)}
                                onChange={(event) => {
                                  setVisualOwnerVisible(
                                    operation.id,
                                    owner.id,
                                    event.currentTarget.checked,
                                  )
                                }}
                              />
                              {nodeTitle(owner)}
                            </label>
                          ))}
                        </div>
                      </details>
                    ) : null}
                  </header>
                  <div style={{ display: 'grid', gap: 12, padding: 'clamp(10px, 1.5vw, 18px)' }}>
                    <section
                      aria-label="Visuals"
                      style={{ display: 'grid', gap: 8, minWidth: 0 }}
                    >
                      {legacySourceImage ? (
                        <article
                          aria-label={`${nodeTitle(operation)} source slide`}
                          style={{ display: 'grid', gap: 8, minWidth: 0, paddingBottom: 12, borderBottom: '1px solid var(--osa-border-subtle)' }}
                        >
                          <img
                            src={legacySourceImage}
                            alt={visualAlt}
                            style={{ display: 'block', width: '100%', height: 'auto', border: '1px solid #d8d8d8', background: '#fff', objectFit: 'contain' }}
                          />
                        </article>
                      ) : null}

                      {visibleIncludedPhotoObjects.map((object) => {
                        const image = objectImageSource(object)
                        const label = nodeTitle(object)
                        const accent = appearanceAccentColor(object)
                        return (
                          <figure
                            className={accent
                              ? 'assembly-card__direct-photo assembly-card__visual-accent'
                              : 'assembly-card__direct-photo'}
                            key={object.id}
                            style={semanticAccentStyleFromColor(accent)}
                          >
                            <figcaption className="assembly-card__direct-photo-header">
                              <button
                                className={accent
                                  ? 'assembly-object-link assembly-object-link--accented'
                                  : 'assembly-object-link'}
                                type="button"
                                style={semanticAccentStyleFromColor(accent)}
                                onClick={(event) => {
                                  event.stopPropagation()
                                  onOpenNode(object.id)
                                }}
                              >
                                {label}
                              </button>
                              {focused && !readOnly && onUnlinkObjectVisual ? (
                                <button
                                  className="assembly-object-unlink"
                                  type="button"
                                  title="remove this photo from the instruction"
                                  aria-label={`remove ${label} photo from this instruction`}
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    onUnlinkObjectVisual(operation.id, object.id)
                                  }}
                                >
                                  <span aria-hidden="true">×</span> remove
                                </button>
                              ) : null}
                            </figcaption>
                            {image ? (
                              <img
                                className="assembly-card__direct-photo-image"
                                src={image}
                                alt={objectImageAlt(object)}
                              />
                            ) : (
                              <div className="assembly-card__photo-unavailable">
                                photo unavailable
                              </div>
                            )}
                          </figure>
                        )
                      })}

                      {visibleLinkedVisuals.map((visual) => {
                        const label = nodeTitle(visual)
                        const owner = visualOwnerFor(visual.id, nodes, edges)
                        const accent = visualAccentColor(visual, nodes, edges)
                        const immutableVisual = isImmutableVisual(visual)
                        const visualEmbeds = visualEmbedsForCanvas(visual.id, nodes, edges)
                        const reorderIndex = reorderableCardVisuals.findIndex((candidate) => (
                          candidate.id === visual.id
                        ))
                        // Source-slide provenance remains a static first item.
                        // Every Visual explicitly linked to this card opens in
                        // the same canvas dialog, including a photo canvas.
                        const canOpenVisual = reorderIndex >= 0
                        const canMoveUp = reorderIndex > 0
                        const canMoveDown = reorderIndex >= 0
                          && reorderIndex < reorderableCardVisuals.length - 1
                        return (
                          <article
                            className={accent ? 'assembly-card__visual-accent' : undefined}
                            key={visual.id}
                            style={{
                              display: 'grid',
                              gap: 8,
                              minWidth: 0,
                              paddingBottom: 12,
                              borderBottom: '1px solid var(--osa-border-subtle)',
                              ...semanticAccentStyleFromColor(accent),
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
                              <input
                                aria-label={`${label} name`}
                                value={visual.data.name}
                                readOnly={readOnly || immutableVisual}
                                onClick={(event) => event.stopPropagation()}
                                onChange={(event) => {
                                  if (!readOnly && !immutableVisual) onNameChange(visual.id, event.target.value)
                                }}
                                style={{
                                  ...transparentInput,
                                  flex: '1 1 auto',
                                  fontSize: '0.88rem',
                                  fontWeight: 600,
                                  ...(accent ? { color: accent } : {}),
                                }}
                              />
                              {!readOnly && onReorderOperationVisual && reorderIndex >= 0 ? (
                                <span style={{ display: 'inline-flex', gap: 2 }}>
                                  <button
                                    type="button"
                                    aria-label={`move ${label} up`}
                                    title="Move up"
                                    disabled={!canMoveUp}
                                    onClick={(event) => {
                                      event.stopPropagation()
                                      onReorderOperationVisual(operation.id, visual.id, 'up')
                                    }}
                                    style={{ padding: '0 4px', minWidth: 24 }}
                                  >
                                    ↑
                                  </button>
                                  <button
                                    type="button"
                                    aria-label={`move ${label} down`}
                                    title="Move down"
                                    disabled={!canMoveDown}
                                    onClick={(event) => {
                                      event.stopPropagation()
                                      onReorderOperationVisual(operation.id, visual.id, 'down')
                                    }}
                                    style={{ padding: '0 4px', minWidth: 24 }}
                                  >
                                    ↓
                                  </button>
                                </span>
                              ) : null}
                            </div>
                            {canOpenVisual ? (
                              <button
                                type="button"
                                aria-label={`open ${label}`}
                                title="Open visual"
                                onClick={(event) => {
                                  event.stopPropagation()
                                  // A Visual is edited in-place over this card.
                                  // Do not jump to Space: the card is a live
                                  // viewport onto the same durable canvas.
                                  setEditingVisual(visual.id, operation.id)
                                }}
                                style={{ display: 'block', width: '100%', padding: 0, border: 0, background: 'transparent', cursor: 'pointer' }}
                              >
                                <VisualCanvasPreview
                                  visual={visual}
                                  embeddedVisuals={visualEmbeds}
                                  className="assembly-card__visual-preview"
                                />
                              </button>
                            ) : (
                              <VisualCanvasPreview
                                visual={visual}
                                embeddedVisuals={visualEmbeds}
                                className="assembly-card__visual-preview"
                              />
                            )}
                            <select
                              aria-label={`${label} owner`}
                              value={owner?.id ?? ''}
                              // The owner is an edge relationship rather than
                              // part of the photo/image itself. Keep it
                              // editable for every Visual type.
                              disabled={readOnly || !onChangeVisualOwner}
                              onClick={(event) => event.stopPropagation()}
                              onChange={(event) => {
                                event.stopPropagation()
                                const ownerId = event.currentTarget.value
                                if (!readOnly && ownerId) onChangeVisualOwner?.(visual.id, ownerId)
                              }}
                              style={{ width: 'fit-content', maxWidth: '100%', padding: 0, border: 0, background: 'transparent', color: accent ?? 'var(--osa-muted)', font: 'inherit', fontSize: '0.76rem', cursor: readOnly ? 'default' : 'pointer' }}
                            >
                              <option value="" disabled>owner</option>
                              {canvasOwners.map((candidate) => (
                                <option value={candidate.id} key={candidate.id}>
                                  {nodeTitle(candidate)}
                                </option>
                              ))}
                            </select>
                          </article>
                        )
                      })}

                      {!legacySourceImage && !linkedVisuals.length && !includedPhotoObjects.length ? (
                        <div style={{ minHeight: 8 }} />
                      ) : null}

                      {!readOnly && onCreateOwnedVisualForOperation ? (
                        <div className="assembly-card__canvas-create">
                          <button
                            className="text-action"
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation()
                              // A card only creates a blank canvas record.
                              // The canvas itself chooses its permanent type
                              // (photo, OSA draw, Draw.io, or Konva) on first open.
                              onCreateOwnedVisualForOperation(operation.id, 'untyped')
                            }}
                          >
                            + canvas
                          </button>
                        </div>
                      ) : null}
                    </section>
                  </div>
                </section>
              </div>
            </article>
          )
        })}
      </div>
      {editingVisual && onSketchChange ? (
        <VisualCanvasEditor
          key={editingVisual.id}
          visual={editingVisual}
          embeddedVisuals={editingVisualEmbeds}
          availableVisuals={editingVisualCandidates}
          readOnly={readOnly}
          onClose={() => setEditingVisual(null)}
          onRemoveFromCard={canRemoveEditingVisualFromCard ? () => {
            onUnlinkObjectVisual?.(editingOperationId!, editingVisual.id)
            setEditingVisual(null)
          } : undefined}
          onNameChange={onNameChange}
          nameReadOnly={editingVisualNameIsInherited}
          onSketchChange={onSketchChange}
          onPropertyChange={onPropertyChange}
          onEmbeddedVisualsChange={onEmbeddedVisualsChange}
          graphNodes={nodes}
          graphEdges={edges}
          onSaveDraftVersion={onSaveVisualDraftVersion}
          onMakeOfficialVersion={onMakeVisualOfficialVersion}
          onRestoreVisualVersion={onRestoreVisualVersion}
          onCreateIndependentVisualCopy={onCreateIndependentVisualCopy}
        />
      ) : null}
    </section>
  )
}
