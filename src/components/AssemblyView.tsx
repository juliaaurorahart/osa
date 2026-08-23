import {
  useMemo,
  type CSSProperties,
  type Dispatch,
  type KeyboardEvent,
  type SetStateAction,
} from 'react'
import type { GraphEdge } from '../graph/graphEdge'
import {
  OSA_PROPERTY,
  OSA_RELATION,
  canOwnOsaVisual,
  isPartLike,
  operationOrder,
  osaRole,
  OPERATION_CANVAS_SOURCE_SECTION_ID,
  type OperationVisualPlacement,
} from '../graph/osaData'
import type { SketchDocument, TextFlowNode } from '../graph/textNode'
import type { AssemblyToolDraft, AssemblyViewUiState } from './assemblyViewState'
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
  onCreatePart: (assemblyId: string) => string
  onCreateExpense: (assemblyId: string) => string
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
  /** Legacy placement editor callback retained for hosts that still provide it. */
  onObjectVisualPlacementChange?: (
    operationId: string,
    objectId: string,
    placement: OperationVisualPlacement,
  ) => void
  /** Legacy section callback retained for host compatibility; Assembly does not call it. */
  onCreateCanvasSection?: (operationId: string) => string
  /**
   * Creates a canonical Visual owned by the card's parent Assembly, then
   * deliberately references that Visual from this operation. Its owner can
   * later be changed to a listed In part or Tool without changing the card.
   */
  onCreateOwnedVisualForOperation?: (operationId: string) => string | undefined
  /** Reassigns a Visual to a Part, Assembly, or Tool without changing its card references. */
  onChangeVisualOwner?: (visualId: string, ownerId: string) => void
  onNameChange: (nodeId: string, name: string) => void
  onTextChange: (nodeId: string, text: string) => void
  onPropertyChange: (nodeId: string, propertyName: string, value: string) => void
  onOpenNode: (nodeId: string) => void
  onSketchChange?: (nodeId: string, sketch: SketchDocument) => void
  /** A shared link can project a board without exposing editing controls. */
  readOnly?: boolean
  /** Creates/copies a read-only link for the current assembly. */
  onShare?: () => void
  /** Brief feedback from the host while a share link is being prepared. */
  shareStatus?: string | null
  /** The last generated read-only link, retained so it can be copied again. */
  shareUrl?: string | null
  /** Opens OSA's bundled Shako Light Wrap starter board. */
  onLoadShakoStarter?: () => void
}

function nodeTitle(node: TextFlowNode) {
  return node.data.name.trim()
    || node.data.text.trim().split(/\r?\n/, 1)[0]
    || `#${node.id}`
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
 * Finds ordinary nodes connected from a root node for one Assembly projection.
 *
 * Imported data may carry an optional relation hint. Objects made directly in
 * OSA remain discoverable through their normal edge meaning and node kind.
 */
function connectedTargets(
  rootId: string,
  candidates: TextFlowNode[],
  edges: GraphEdge[],
  relationHint: string,
  relationshipPattern: RegExp,
  relationKind?: GraphEdge['data']['relationKind'],
) {
  const targetIds = edges
    .filter((edge) => edge.source === rootId && (
      edge.data.properties[OSA_PROPERTY.relationRole] === relationHint
      || relationshipPattern.test(edge.data.relationship)
      || (relationKind !== undefined && edge.data.relationKind === relationKind)
    ))
    .map((edge) => edge.target)
  const order = new Map(targetIds.map((id, index) => [id, index]))

  return candidates
    .filter((node) => order.has(node.id))
    .sort((left, right) => (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0))
}

/** Preserves the first relationship order while avoiding duplicate chips. */
function uniqueNodes(...groups: TextFlowNode[][]) {
  const unique = new Map<string, TextFlowNode>()
  groups.flat().forEach((node) => {
    if (!unique.has(node.id)) unique.set(node.id, node)
  })
  return [...unique.values()]
}

function operationsForAssembly(
  assemblyId: string,
  operations: TextFlowNode[],
  edges: GraphEdge[],
) {
  return connectedTargets(
    assemblyId,
    operations,
    edges,
    OSA_RELATION.assemblyOperation,
    /\b(operation|action|step)\b/i,
    'project-task',
  ).sort((left, right) => operationOrder(left) - operationOrder(right))
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
  border: '1px solid #b9b9b9',
  borderRadius: 4,
  background: '#fff',
  color: '#171717',
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

/** Finds the project object that owns a reusable Visual, when one is recorded. */
function ownerForVisual(
  visualId: string,
  nodes: TextFlowNode[],
  edges: GraphEdge[],
) {
  const ownership = edges.find((edge) => (
    edge.target === visualId
    && edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.objectVisual
  ))
  return ownership ? nodes.find((node) => node.id === ownership.source) : undefined
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
  onCreatePart,
  onCreateExpense,
  onCreateTool,
  onLinkPart,
  onLinkPartInput,
  onUnlinkPartInput,
  onCreatePartForOperation,
  onLinkTool,
  onUnlinkTool,
  onLinkObjectVisual,
  onCreateOwnedVisualForOperation,
  onChangeVisualOwner,
  onNameChange,
  onTextChange,
  onSketchChange,
  onPropertyChange,
  onOpenNode,
  readOnly = false,
  onShare,
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
  const toolInventory = useMemo(() => {
    const candidates = tools?.length ? tools : nodes.filter((node) => (
      node.data.kind === 'tool' || osaRole(node) === 'tool'
    ))
    const uniqueTools = new Map(candidates.map((tool) => [tool.id, tool]))

    return [...uniqueTools.values()]
      .filter((tool) => tool.data.kind === 'tool' || osaRole(tool) === 'tool')
      .sort((left, right) => nodeTitle(left).localeCompare(nodeTitle(right)))
  }, [nodes, tools])
  const {
    focusedCardId,
    lockedCardId,
    editingVisualId,
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
  const setLockedCardId = (nextCardId: SetStateAction<string | null>) => {
    onUiStateChange((current) => ({
      ...current,
      lockedCardId: typeof nextCardId === 'function'
        ? nextCardId(current.lockedCardId)
        : nextCardId,
    }))
  }
  const setEditingVisualId = (visualId: string | null) => {
    onUiStateChange((current) => ({ ...current, editingVisualId: visualId }))
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
  const editingVisual = editingVisualId
    ? nodes.find((node) => node.id === editingVisualId)
    : undefined

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
              {onShare ? <button className="text-action" type="button" onClick={onShare}>share</button> : null}
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
            <ol style={{ margin: 0, paddingLeft: '1.45em', fontSize: 'clamp(0.8rem, 1.8vw, 1.35rem)', lineHeight: 1.55 }}>
              {assemblyOperations.length ? assemblyOperations.map((operation) => (
                <li key={operation.id}>
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
                </li>
              )) : <li style={{ color: '#777' }}>add the first instruction card.</li>}
            </ol>
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
                color: '#555',
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
                  <button
                    type="button"
                    className="assembly-object-link"
                    key={part.id}
                    onClick={(event) => {
                      event.stopPropagation()
                      onOpenNode(part.id)
                    }}
                  >
                    {nodeTitle(part)}
                  </button>
                ))}
              </div>
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
          // A View reference is its own deliberate relationship. It does not
          // infer a visual from In, Tools, or Out. New cards point at canonical
          // Visual nodes, whose content is owned by a part, assembly, or tool.
          // Existing boards can still display a legacy object image here.
          const includedObjectVisuals = connectedTargets(
            operation.id,
            nodes,
            edges,
            OSA_RELATION.operationVisual,
            /^shows (object )?visual$/i,
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
          // A source slide is a normal Visual too. Put it first, then show
          // any deliberately added Visuals below it without duplicating a
          // source Visual that also happens to be placed on the card.
          const canvasVisuals = sourceVisualNode
            ? uniqueNodes([sourceVisualNode], includedObjectVisuals)
            : includedObjectVisuals
          // Keep ownership choice local to this instruction: the thing this
          // assembly belongs to, the parts it takes in, and the tools it uses.
          const canvasOwners = uniqueNodes(
            selectedAssembly ? [selectedAssembly] : [],
            inputParts,
            tools,
          ).filter(canOwnOsaVisual)
          const currentVisualIds = new Set(canvasVisuals.map((visual) => visual.id))
          // A card can include an already-made canvas from any project object
          // it already names in In or Tools (plus its parent Assembly). The
          // visual remains owned by that object; this is only a live View link.
          const availableVisuals = uniqueNodes(edges
            .filter((edge) => (
              canvasOwners.some((owner) => owner.id === edge.source)
              && edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.objectVisual
              && !currentVisualIds.has(edge.target)
            ))
            .map((edge) => nodes.find((node) => node.id === edge.target))
            .filter((visual): visual is TextFlowNode => Boolean(visual && (
              visual.data.kind === 'visual' || osaRole(visual) === 'visual'
            ))))
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
                                className="assembly-object-link"
                                type="button"
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
                          style={{ ...transparentInput, marginTop: 5, borderBottom: '1px solid #ccc' }}
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
                                className="assembly-object-link"
                                type="button"
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
                          : <span style={{ color: '#888' }}>add the tools needed here.</span>}
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
                          style={{ ...transparentInput, marginTop: 5, borderBottom: '1px solid #ccc' }}
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
                            style={{ ...transparentInput, borderBottom: '1px solid #ccc' }}
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

                  <label style={{ display: 'grid', gap: 5, minWidth: 0 }}>
                    <strong style={{ fontSize: 'clamp(0.76rem, 1.5vw, 1.15rem)', fontWeight: 500 }}>steps</strong>
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
                  </label>
                </div>

                <section className="assembly-card__view" aria-label={`${nodeTitle(operation)} view`}>
                  <header className="assembly-card__view-header">
                    <h2>canvas</h2>
                  </header>
                  <div style={{ display: 'grid', gap: 12, padding: 'clamp(10px, 1.5vw, 18px)' }}>
                    <section
                      aria-label="Canvases"
                      style={{ display: 'grid', gap: 8, minWidth: 0 }}
                    >
                      {canvasVisuals.length ? canvasVisuals.map((visual) => {
                        const label = nodeTitle(visual)
                        const owner = ownerForVisual(visual.id, nodes, edges)

                        return (
                          <article
                            key={visual.id}
                            style={{ display: 'grid', gap: 8, minWidth: 0, paddingBottom: 12, borderBottom: '1px solid #deded9' }}
                          >
                            <input
                              aria-label={`${label} name`}
                              value={visual.data.name}
                              readOnly={readOnly}
                              onClick={(event) => event.stopPropagation()}
                              onChange={(event) => {
                                if (!readOnly) onNameChange(visual.id, event.target.value)
                              }}
                              style={{ ...transparentInput, fontSize: '0.88rem', fontWeight: 600 }}
                            />
                            <button
                              type="button"
                              aria-label={`open ${label}`}
                              title="Open visual"
                              onClick={(event) => {
                                event.stopPropagation()
                                // A Visual is edited in-place over this card.
                                // Do not jump to Space: the card is a live
                                // viewport onto the same durable canvas.
                                setEditingVisualId(visual.id)
                              }}
                              style={{ display: 'block', width: '100%', padding: 0, border: 0, background: 'transparent', cursor: 'pointer' }}
                            >
                              <VisualCanvasPreview
                                visual={visual}
                                className="assembly-card__visual-preview"
                              />
                            </button>
                            <select
                              aria-label={`${label} owner`}
                              value={owner?.id ?? ''}
                              disabled={readOnly || !onChangeVisualOwner}
                              onClick={(event) => event.stopPropagation()}
                              onChange={(event) => {
                                event.stopPropagation()
                                const ownerId = event.currentTarget.value
                                if (!readOnly && ownerId) onChangeVisualOwner?.(visual.id, ownerId)
                              }}
                              style={{ width: 'fit-content', maxWidth: '100%', padding: 0, border: 0, background: 'transparent', color: '#666', font: 'inherit', fontSize: '0.76rem', cursor: readOnly ? 'default' : 'pointer' }}
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
                      }) : (
                        visualSource ? (
                          <img
                            src={visualSource}
                            alt={visualAlt}
                            style={{ display: 'block', width: '100%', height: 'auto', border: '1px solid #d8d8d8', background: '#fff', objectFit: 'contain' }}
                          />
                        ) : <div style={{ minHeight: 8 }} />
                      )}

                      {!readOnly ? (
                        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, paddingTop: 2 }}>
                          {onLinkObjectVisual && availableVisuals.length ? (
                            <select
                              aria-label={`Add an existing visual to ${nodeTitle(operation)}`}
                              defaultValue=""
                              onClick={(event) => event.stopPropagation()}
                              onChange={(event) => {
                                event.stopPropagation()
                                const visualId = event.currentTarget.value
                                if (visualId) {
                                  onLinkObjectVisual(
                                    operation.id,
                                    visualId,
                                    OPERATION_CANVAS_SOURCE_SECTION_ID,
                                  )
                                }
                                event.currentTarget.value = ''
                              }}
                              style={{ width: 'fit-content', maxWidth: '100%', padding: 0, border: 0, borderBottom: '1px solid #aaa', background: 'transparent', color: '#555', font: 'inherit', fontSize: '0.78rem', cursor: 'pointer' }}
                            >
                              <option value="">+ visual</option>
                              {availableVisuals.map((visual) => {
                                const owner = ownerForVisual(visual.id, nodes, edges)
                                return (
                                  <option value={visual.id} key={visual.id}>
                                    {nodeTitle(visual)}{owner ? ` — ${nodeTitle(owner)}` : ''}
                                  </option>
                                )
                              })}
                            </select>
                          ) : null}
                          {onCreateOwnedVisualForOperation ? (
                            <button
                              className="text-action"
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation()
                                const visualId = onCreateOwnedVisualForOperation(operation.id)
                                if (visualId) setEditingVisualId(visualId)
                              }}
                              title="Create a blank canvas"
                            >
                              + canvas
                            </button>
                          ) : null}

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
          visual={editingVisual}
          readOnly={readOnly}
          onClose={() => setEditingVisualId(null)}
          onNameChange={onNameChange}
          onSketchChange={onSketchChange}
          onPropertyChange={onPropertyChange}
        />
      ) : null}
    </section>
  )
}
