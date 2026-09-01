import {
  useMemo,
  type Dispatch,
  type SetStateAction,
} from 'react'
import type { GraphEdge } from '../graph/graphEdge'
import {
  OSA_PROPERTY,
  OSA_RELATION,
  osaRole,
} from '../graph/osaData'
import type { TextFlowNode } from '../graph/textNode'
import { annotationTargetsForNodes } from '../graph/sketchAnnotation'
import { visualEmbedsForCanvas } from '../graph/visualEmbed'
import {
  AssemblyIndexCard,
  type AssemblyInstructionSummary,
} from './AssemblyIndexCard'
import { AssemblyOperationCard } from './AssemblyOperationCard'
import { AssemblyViewControls } from './AssemblyViewControls'
import type { AssemblyToolDraft, AssemblyViewUiState } from './assemblyViewState'
import {
  canvasOwnedByStep,
  connectedTargets,
  nodeTitle,
  operationCompletedCount,
  operationsForAssembly,
  stepsForOperation,
  visualHasInstructionContent,
} from './assemblyProjection'
import {
  ASSEMBLY_INDEX_CARD_ID,
  uniqueNodes,
} from './assemblyViewPresentation'
import type { AssemblyStepCanvas, AssemblyViewActions } from './assemblyViewTypes'
import './AssemblyView.css'

// Preserve the public type API used by App while keeping component types in a
// small dependency-free module that extracted Assembly components can share.
export type {
  AssemblyViewActions,
  OperationPartDirection,
} from './assemblyViewTypes'

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
  /** Durable graph mutations are grouped separately from view/navigation props. */
  actions: AssemblyViewActions
  onInspectNode: (nodeId: string) => void
  /** A shared link can project a board without exposing editing controls. */
  readOnly?: boolean
  /** Optional project starter presented when building an Assembly. */
  starterAction?: {
    label: string
    onLoad: () => void
  }
}

/**
 * Projects one Assembly from the canonical graph, then delegates each visible
 * document region to a focused component. Durable graph state remains owned by
 * App and all relationship queries remain here at the projection boundary.
 */
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
  actions,
  onInspectNode,
  readOnly = false,
  starterAction,
}: AssemblyViewProps) {
  const selectedAssembly = assemblies.find((assembly) => assembly.id === selectedAssemblyId)
    ?? assemblies[0]
  // Every card and its open canvas resolve annotation references from the
  // canonical project graph rather than from just that card's local objects.
  const annotationTargets = useMemo(() => annotationTargetsForNodes(nodes), [nodes])
  const assemblyOperations = useMemo(() => selectedAssembly
    ? operationsForAssembly(selectedAssembly.id, operations, edges)
    : [], [edges, operations, selectedAssembly])
  const instructionSummaries = useMemo(() => assemblyOperations.map((operation): AssemblyInstructionSummary => {
    // Older boards used one undirected operation-item relationship. Structured
    // inputs take precedence whenever the operation has them.
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
    const primaryOutputId = edges.find((edge) => (
      edge.source === operation.id
      && edge.data.properties[OSA_PROPERTY.relationRole] === OSA_RELATION.operationPrimaryOutput
    ))?.target
    const operationTools = connectedTargets(
      operation.id,
      nodes,
      edges,
      OSA_RELATION.operationTool,
      /\b(tool|tools)\b/i,
    )

    return {
      operation,
      before: structuredInputParts.length ? structuredInputParts : legacyInputParts,
      after: nodes.find((node) => node.id === primaryOutputId) ?? null,
      stepCount: stepsForOperation(operation.id, nodes, edges).length,
      toolCount: new Set(operationTools.map((tool) => tool.id)).size,
      completedCount: operationCompletedCount(operation),
    }
  }), [assemblyOperations, edges, nodes])
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
    // Older in-memory state can survive a hot reload. A missing open card is
    // simply the normal compact Assembly document.
    openCardId = null,
    lockedCardId,
    toolDraft,
    toolDraftFor,
  } = uiState

  // These small setters keep presentation changes routed through App. App
  // stays mounted when Assembly is hidden, so the state comes back intact.
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

  const activeFocusedCardId = focusedCardId === ASSEMBLY_INDEX_CARD_ID
    || assemblyOperations.some((operation) => operation.id === focusedCardId)
    ? focusedCardId
    : ASSEMBLY_INDEX_CARD_ID
  const activeOpenCardId = openCardId === ASSEMBLY_INDEX_CARD_ID
    || assemblyOperations.some((operation) => operation.id === openCardId)
    ? openCardId
    : null
  const activeLockedCardId = lockedCardId === ASSEMBLY_INDEX_CARD_ID
    || assemblyOperations.some((operation) => operation.id === lockedCardId)
    ? lockedCardId
    : null
  const visibleCardId = activeOpenCardId ?? activeLockedCardId
  const isSummarySurface = visibleCardId === null
  const openCard = (cardId: string) => {
    setFocusedCardId(cardId)
    setOpenCardId(cardId)
  }
  const closeCard = () => setOpenCardId(null)
  const createAssembly = () => {
    if (readOnly) return
    const assemblyId = actions.onCreateAssembly(`Assembly ${assemblies.length + 1}`)
    onSelectAssembly(assemblyId)
    openCard(ASSEMBLY_INDEX_CARD_ID)
  }

  if (!selectedAssembly) {
    return (
      <section className="work-view assembly-view" aria-label="Assembly">
        {readOnly ? (
          <div className="assembly-view__access-status">
            <span className="assembly-view__shared-label">shared assembly · read-only</span>
          </div>
        ) : null}
        <div className="assembly-view__empty-state">
          <p className="work-view__empty">there is no assembly board open yet.</p>
          {readOnly ? (
            <p>this shared link does not include an assembly.</p>
          ) : (
            <div className="assembly-view__empty-actions">
              <button className="text-action" type="button" onClick={createAssembly}>create assembly</button>
              {starterAction ? (
                <button className="text-action" type="button" onClick={starterAction.onLoad}>
                  {starterAction.label}
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
    const cardId = actions.onCreateOperation(
      selectedAssembly.id,
      `Instruction ${assemblyOperations.length + 1}`,
    )
    openCard(cardId)
  }

  return (
    <section
      className={`work-view assembly-view${isSummarySurface ? ' is-summary-surface' : ' is-detail-surface'}`}
      aria-label="Assembly"
    >
      <AssemblyViewControls
        readOnly={readOnly}
        activeLockedCardId={activeLockedCardId}
        onUnlockCardView={() => setLockedCardId(null)}
      />

      <div
        className={`assembly-card-board${isSummarySurface ? ' is-summary-surface' : ' is-detail-surface'}${activeLockedCardId ? ' is-locked' : ''}${activeOpenCardId ? ' is-editing' : ''}`}
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr)',
          alignItems: 'start',
          gap: 'clamp(12px, 2vw, 22px)',
        }}
      >
        {!visibleCardId || visibleCardId === ASSEMBLY_INDEX_CARD_ID ? (
          <AssemblyIndexCard
            assembly={selectedAssembly}
            instructionSummaries={instructionSummaries}
            readOnly={readOnly}
            isOpen={activeOpenCardId === ASSEMBLY_INDEX_CARD_ID}
            onOpen={() => openCard(ASSEMBLY_INDEX_CARD_ID)}
            onClose={closeCard}
            onFocusCard={setFocusedCardId}
            onOpenOperation={openCard}
            onNameChange={actions.onNameChange}
            onMoveOperation={(operationId, position) => (
              actions.onMoveOperation(selectedAssembly.id, operationId, position)
            )}
            onRemoveOperation={actions.onRemoveOperation}
            onAddCard={addCard}
          />
        ) : null}

        {assemblyOperations.map((operation) => {
          // The Assembly summary is the only default card. Selecting one
          // instruction replaces it with that instruction's editor.
          if (visibleCardId !== operation.id) return null

          const operationTools = connectedTargets(
            operation.id,
            nodes,
            edges,
            OSA_RELATION.operationTool,
            /\b(tool|tools)\b/i,
          )
          const steps = stepsForOperation(operation.id, nodes, edges)
          const stepCanvasByStepId = new Map(steps.map((step) => [
            step.id,
            canvasOwnedByStep(step.id, nodes, edges),
          ]))
          // Compact Assembly cards use the same deliberately published Step
          // canvas contract as the team-facing instructions.
          const stepCanvases = steps.flatMap((step): AssemblyStepCanvas[] => {
            const canvas = stepCanvasByStepId.get(step.id)
            return canvas
              && canvas.data.properties[OSA_PROPERTY.visualIncludeInInstructions] === 'true'
              && visualHasInstructionContent(canvas, nodes, edges)
              ? [{
                  step,
                  canvas,
                  embeddedVisuals: visualEmbedsForCanvas(canvas.id, nodes, edges),
                }]
              : []
          })
          // Older boards used one undirected operation-item relationship.
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
          const inputParts = structuredInputParts.length
            ? structuredInputParts
            : legacyInputParts
          const availableParts = uniqueNodes(
            [selectedAssembly],
            assemblyParts,
          )
          const toolDraftForOperation = toolDraftFor?.operationId === operation.id
            ? toolDraftFor
            : null

          return (
            <AssemblyOperationCard
              key={operation.id}
              operation={operation}
              inputParts={inputParts}
              tools={operationTools}
              availableParts={availableParts}
              toolInventory={toolInventory}
              steps={steps}
              stepCanvasByStepId={stepCanvasByStepId}
              stepCanvases={stepCanvases}
              annotationTargets={annotationTargets}
              focused={activeFocusedCardId === operation.id}
              isOpen={activeOpenCardId === operation.id}
              readOnly={readOnly}
              toolDraft={toolDraft}
              toolDraftFor={toolDraftForOperation}
              actions={actions}
              onInspectNode={onInspectNode}
              onOpen={() => openCard(operation.id)}
              onClose={closeCard}
              onFocusCard={() => setFocusedCardId(operation.id)}
              onEditVisual={(visualId) => setEditingVisual(visualId, operation.id)}
              onToolDraftChange={setToolDraft}
              onToolDraftForChange={setToolDraftFor}
            />
          )
        })}
      </div>
    </section>
  )
}
