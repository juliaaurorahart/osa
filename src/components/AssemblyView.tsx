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
  isPartLike,
  operationOrder,
  osaRole,
  type OperationVisualPlacement,
} from '../graph/osaData'
import type { SketchDocument, TextFlowNode } from '../graph/textNode'
import type { AssemblyToolDraft, AssemblyViewUiState } from './assemblyViewState'
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
  /**
   * Compatibility callback for placing an existing visual in this card.
   *
   * `sectionId` belongs to the legacy placement record; Assembly no longer
   * creates or owns canvas sections through it.
   */
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
   * Creates a canonical Visual owned by this card's primary output, then
   * deliberately references that Visual from this operation. It never fires
   * from ordinary In, Tools, or Out editing.
   */
  onCreateOwnedVisualForOperation?: (operationId: string) => string | undefined
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

/**
 * A name match is only a compatibility hint for an older card that has no
 * explicit output relation. The actual relationship is still created only
 * after the person chooses the visible repair action.
 */
function normalizedNodeName(node: TextFlowNode) {
  return node.data.name.trim().toLocaleLowerCase()
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

/** Canonical reusable Visual nodes can be owned by parts, assemblies, or tools. */
function isCanonicalVisual(node: TextFlowNode) {
  return osaRole(node) === 'visual' || node.data.kind === 'visual'
}

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

/** Keeps legacy object images understandable while new boards use Visual nodes. */
function visualReferenceLabel(
  visual: TextFlowNode,
  nodes: TextFlowNode[],
  edges: GraphEdge[],
) {
  const owner = ownerForVisual(visual.id, nodes, edges)
  return owner ? `${nodeTitle(owner)} visual` : nodeTitle(visual)
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
  onSetPrimaryOutput,
  onCreatePartForOperation,
  onLinkTool,
  onUnlinkTool,
  onLinkObjectVisual,
  onUnlinkObjectVisual,
  onCreateOwnedVisualForOperation,
  onNameChange,
  onTextChange,
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
          // A modern card explicitly records the one project object it
          // represents. Older boards may only have a generic Out relation.
          // A single ordinary output is safe to *show* as the likely object,
          // but we do not quietly rewrite saved data: the visible repair
          // action below makes that decision durable.
          const explicitPrimaryOutput = connectedTargets(
            operation.id,
            nodes,
            edges,
            OSA_RELATION.operationPrimaryOutput,
            /^represents primary output$/i,
          ).find(isPartLike)
          const ordinaryOutputs = connectedTargets(
            operation.id,
            nodes,
            edges,
            OSA_RELATION.operationOutput,
            /^produces? (part|assembly)$/i,
          ).filter(isPartLike)
          // Some early boards stored the card title (for example,
          // "Connector Box Drilled") and its Part independently, but never
          // connected them. An exact name match is a useful *suggestion* in
          // that narrow legacy case. It is not automatically saved as a
          // relationship: the action below asks the person to confirm it.
          const operationName = normalizedNodeName(operation)
          const titleMatchedPart = !explicitPrimaryOutput && operationName
            ? nodes.find((node) => isPartLike(node) && normalizedNodeName(node) === operationName)
            : undefined
          const inferredPrimaryOutput = !explicitPrimaryOutput
            ? titleMatchedPart ?? (ordinaryOutputs.length === 1 ? ordinaryOutputs[0] : undefined)
            : undefined
          const inferredPrimaryOutputFromTitle = inferredPrimaryOutput?.id === titleMatchedPart?.id
          // Use this value for explanatory display only. Creation still waits
          // for an explicit, durable `operation-primary-output` relation.
          const effectivePrimaryOutput = explicitPrimaryOutput ?? inferredPrimaryOutput
          const effectivePrimaryOutputLabel = effectivePrimaryOutput
            ? nodeTitle(effectivePrimaryOutput)
            : ''
          const namedOutputCandidate = operation.data.name.trim()
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
          const includedVisualIds = new Set(includedObjectVisuals.map((visual) => visual.id))
          const availableOwnedVisuals = nodes
            .filter(isCanonicalVisual)
            .filter((visual) => Boolean(ownerForVisual(visual.id, nodes, edges)))
            // A blank Visual is still a real reusable canvas. It must be
            // available before a person has added an image, photo, or drawing
            // to it—otherwise a canvas made in one project view could not be
            // deliberately included from another.
            .filter((visual) => !includedVisualIds.has(visual.id))
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
                    <h2>visual canvases</h2>
                    <p>PowerPoint source and reusable visuals owned by project objects.</p>
                  </header>
                  <div style={{ display: 'grid', gap: 12, padding: 'clamp(10px, 1.5vw, 18px)' }}>
                    <section
                      aria-label="PowerPoint source slide"
                      style={{ display: 'grid', gap: 8, minWidth: 0 }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, color: '#555', fontSize: '0.78rem' }}>
                        <strong>source slide</strong>
                        <span>PowerPoint provenance</span>
                      </div>
                      {visualSource ? (
                        <img
                          src={visualSource}
                          alt={visualAlt}
                          style={{ display: 'block', width: '100%', height: 'auto', border: '1px solid #d8d8d8', background: '#fff', objectFit: 'contain' }}
                        />
                      ) : (
                        <p style={{ margin: 0, color: '#777', fontSize: '0.82rem', lineHeight: 1.45 }}>
                          no PowerPoint/source image is attached to this instruction yet.
                        </p>
                      )}
                    </section>

                    <section
                      aria-label="Reusable visual canvases"
                      style={{ display: 'grid', gap: 8, minWidth: 0, borderTop: '1px solid #deded9', paddingTop: 12 }}
                    >
                      <div style={{ display: 'grid', gap: 3 }}>
                        <strong style={{ fontSize: '0.9rem' }}>reusable visual canvases</strong>
                        <span style={{ color: '#666', fontSize: '0.76rem', lineHeight: 1.35 }}>
                          Create one for this card’s represented part, or reference a canvas that already belongs to a project object.
                        </span>
                      </div>

                      {includedObjectVisuals.length ? includedObjectVisuals.map((visual) => {
                        const owner = ownerForVisual(visual.id, nodes, edges)
                        const imageSource = objectImageSource(visual)
                        const label = visualReferenceLabel(visual, nodes, edges)

                        return (
                          <article
                            key={visual.id}
                            style={{ display: 'grid', gap: 8, minWidth: 0, padding: 9, border: '1px solid #d8d8d8', background: '#fff' }}
                          >
                            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: '3px 8px' }}>
                              <strong style={{ fontSize: '0.88rem' }}>{label}</strong>
                              <span style={{ color: '#666', fontSize: '0.72rem' }}>
                                {owner ? `owned by ${nodeTitle(owner)}` : 'legacy object image'}
                              </span>
                            </div>
                            {imageSource ? (
                              <img
                                src={imageSource}
                                alt={objectImageAlt(visual)}
                                style={{ display: 'block', width: '100%', height: 'auto', maxHeight: 300, objectFit: 'contain' }}
                              />
                            ) : (
                              <p style={{ margin: 0, padding: 12, border: '1px dashed #bbb', color: '#666', fontSize: '0.8rem', lineHeight: 1.4 }}>
                                This Visual is ready for a drawing, image, or diagram. Its future content remains owned by {owner ? nodeTitle(owner) : 'this project object'}.
                              </p>
                            )}
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                              <button
                                className="text-action"
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation()
                                  onOpenNode(visual.id)
                                }}
                              >
                                open visual
                              </button>
                              {focused && !readOnly && onUnlinkObjectVisual ? (
                                <button
                                  className="text-action"
                                  type="button"
                                  title="remove this card's reference only; keep the reusable Visual"
                                  aria-label={`remove ${label} from this card only`}
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    onUnlinkObjectVisual(operation.id, visual.id)
                                  }}
                                >
                                  remove from card
                                </button>
                              ) : null}
                            </div>
                          </article>
                        )
                      }) : (
                        <p style={{ margin: 0, color: '#777', fontSize: '0.82rem', lineHeight: 1.45 }}>
                          this instruction does not reference any reusable visual canvases yet.
                        </p>
                      )}

                      {!readOnly ? (
                        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, borderTop: '1px solid #e5e5e2', paddingTop: 10 }}>
                          {explicitPrimaryOutput ? (
                            onCreateOwnedVisualForOperation ? (
                              <button
                                className="text-action"
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation()
                                  onCreateOwnedVisualForOperation(operation.id)
                                }}
                                title={`Create a reusable visual canvas owned by ${effectivePrimaryOutputLabel}`}
                              >
                                + create visual canvas for {effectivePrimaryOutputLabel}
                              </button>
                            ) : (
                              <span style={{ color: '#666', fontSize: '0.76rem' }}>
                                a host visual creator is not connected yet.
                              </span>
                            )
                          ) : inferredPrimaryOutput ? (
                            <>
                              <span style={{ color: '#666', fontSize: '0.76rem', lineHeight: 1.35 }}>
                                {inferredPrimaryOutputFromTitle
                                  ? `this project already has a part named ${effectivePrimaryOutputLabel}.`
                                  : `this card already produces ${effectivePrimaryOutputLabel}.`}
                              </span>
                              {onSetPrimaryOutput ? (
                                <button
                                  className="text-action"
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    // Turn the visible legacy suggestion into
                                    // the card's durable, singular
                                    // representation before a Visual can be
                                    // created from it.
                                    onSetPrimaryOutput(operation.id, inferredPrimaryOutput.id)
                                  }}
                                >
                                  use {nodeTitle(inferredPrimaryOutput)} as this card’s represented part
                                </button>
                              ) : (
                                <span style={{ color: '#666', fontSize: '0.76rem' }}>
                                  choose this card’s represented part in Space first.
                                </span>
                              )}
                            </>
                          ) : (
                            <>
                              {onSetPrimaryOutput ? (
                                <select
                                  aria-label={`choose a represented part for ${nodeTitle(operation)}`}
                                  defaultValue=""
                                  onChange={(event) => {
                                    const partId = event.currentTarget.value
                                    event.currentTarget.value = ''
                                    if (partId) onSetPrimaryOutput(operation.id, partId)
                                  }}
                                  style={{ minWidth: 0, flex: '1 1 210px', border: 0, borderBottom: '1px solid #bbb', background: 'transparent', color: 'inherit', font: 'inherit', fontSize: '0.8rem' }}
                                >
                                  <option value="">choose this card’s represented part…</option>
                                  {availableParts.map((part) => (
                                    <option value={part.id} key={part.id}>{nodeTitle(part)}</option>
                                  ))}
                                </select>
                              ) : (
                                <span style={{ color: '#666', fontSize: '0.76rem' }}>
                                  choose this card’s represented part in Space first.
                                </span>
                              )}
                              {onCreatePartForOperation && namedOutputCandidate ? (
                                <button
                                  className="text-action"
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    onCreatePartForOperation(
                                      operation.id,
                                      'output',
                                      namedOutputCandidate,
                                    )
                                  }}
                                >
                                  create “{namedOutputCandidate}” as this card’s represented part
                                </button>
                              ) : null}
                            </>
                          )}

                          {onLinkObjectVisual && availableOwnedVisuals.length ? (
                            <select
                              aria-label={`add an existing owned visual to ${nodeTitle(operation)}`}
                              defaultValue=""
                              onChange={(event) => {
                                const visualId = event.currentTarget.value
                                event.currentTarget.value = ''
                                // The compatibility host currently requires a
                                // placement scope. This does not create an
                                // operation-owned canvas or a new section.
                                if (visualId) onLinkObjectVisual(operation.id, visualId, 'source')
                              }}
                              style={{ minWidth: 0, flex: '1 1 210px', border: 0, borderBottom: '1px solid #bbb', background: 'transparent', color: 'inherit', font: 'inherit', fontSize: '0.8rem' }}
                            >
                              <option value="">add an existing visual canvas…</option>
                              {availableOwnedVisuals.map((visual) => (
                                <option value={visual.id} key={visual.id}>
                                  {visualReferenceLabel(visual, nodes, edges)}{objectImageSource(visual) ? '' : ' (blank canvas)'}
                                </option>
                              ))}
                            </select>
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
    </section>
  )
}
