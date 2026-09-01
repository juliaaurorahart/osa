import type { GraphEdge } from '../graph/graphEdge'
import { OSA_PROPERTY } from '../graph/osaData'
import type { SketchAnnotationTarget, TextFlowNode } from '../graph/textNode'
import { AssemblyInstructionVisuals } from './AssemblyInstructionVisuals'
import { AssemblyOperationStatus } from './AssemblyOperationStatus'
import { AssemblyPartsAndTools } from './AssemblyPartsAndTools'
import {
  nodeTitle,
  operationCompletedCount,
  type InstructionVisual,
} from './assemblyProjection'
import {
  cardFocusStyle,
  cardKeyDown,
  cardShell,
  transparentInput,
} from './assemblyViewPresentation'
import type { AssemblyViewActions } from './assemblyViewTypes'
import type { AssemblyToolDraft } from './assemblyViewState'
import './AssemblyOperationCard.css'

type AssemblyOperationCardProps = {
  operation: TextFlowNode
  description: string
  instructionVisuals: InstructionVisual[]
  nodes: TextFlowNode[]
  edges: GraphEdge[]
  inputParts: TextFlowNode[]
  tools: TextFlowNode[]
  availableParts: TextFlowNode[]
  toolInventory: TextFlowNode[]
  annotationTargets: SketchAnnotationTarget[]
  focused: boolean
  isOpen: boolean
  readOnly: boolean
  operationPosition: number
  operationCount: number
  toolDraft: string
  toolDraftFor: AssemblyToolDraft | null
  actions: AssemblyViewActions
  onInspectNode: (nodeId: string) => void
  onOpen: () => void
  onClose: () => void
  onPrevious: (() => void) | null
  onNext: (() => void) | null
  onFocusCard: () => void
  onEditVisual: (visualId: string) => void
  onToolDraftChange: (value: string) => void
  onToolDraftForChange: (value: AssemblyToolDraft | null) => void
}

/** One instruction: title, description, Before/After pictures, and its resources. */
export function AssemblyOperationCard({
  operation,
  description,
  instructionVisuals,
  nodes,
  edges,
  inputParts,
  tools,
  availableParts,
  toolInventory,
  annotationTargets,
  focused,
  isOpen,
  readOnly,
  operationPosition,
  operationCount,
  toolDraft,
  toolDraftFor,
  actions,
  onInspectNode,
  onOpen,
  onClose,
  onPrevious,
  onNext,
  onFocusCard,
  onEditVisual,
  onToolDraftChange,
  onToolDraftForChange,
}: AssemblyOperationCardProps) {
  const completedCount = operationCompletedCount(operation)
  const title = nodeTitle(operation)

  return (
    <article
      className={`assembly-card assembly-operation-card${isOpen ? ' is-focused is-open' : ' is-summary'}`}
      style={isOpen
        ? undefined
        : { ...cardShell, padding: 0, ...cardFocusStyle(false) }}
      tabIndex={0}
      aria-label={`${title} card`}
      onClick={() => {
        if (!isOpen) onOpen()
      }}
      onKeyDown={(event) => cardKeyDown(event, onOpen)}
    >
      {isOpen ? (
        <>
          <header className="assembly-operation-card__header">
            <input
              className="assembly-card__title"
              aria-label={`${title} title`}
              placeholder="instruction title"
              value={operation.data.name}
              readOnly={readOnly}
              onFocus={onFocusCard}
              onChange={(event) => {
                if (!readOnly) actions.onNameChange(operation.id, event.target.value)
              }}
              style={transparentInput}
            />
            <div className="assembly-card__focus-controls">
              <AssemblyOperationStatus
                operation={operation}
                onChange={!readOnly && actions.onPropertyChange
                  ? (status) => actions.onPropertyChange?.(
                      operation.id,
                      OSA_PROPERTY.operationStatus,
                      status,
                    )
                  : undefined}
              />
              {!readOnly ? (
                <label
                  className="assembly-operation-card__complete-count"
                  onClick={(event) => event.stopPropagation()}
                >
                  <span># complete</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min="0"
                    step="1"
                    aria-label={`${title} number complete`}
                    value={completedCount}
                    onChange={(event) => {
                      const requestedCount = event.currentTarget.valueAsNumber
                      const nextCount = Number.isFinite(requestedCount)
                        ? Math.max(0, Math.floor(requestedCount))
                        : 0
                      actions.onPropertyChange?.(
                        operation.id,
                        OSA_PROPERTY.operationCompletedCount,
                        String(nextCount),
                      )
                    }}
                  />
                </label>
              ) : (
                <span className="assembly-operation-card__status">
                  <b>{completedCount}</b> complete
                </span>
              )}
              <button
                className="assembly-card__close-button"
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  onClose()
                }}
              >
                Done
              </button>
            </div>
          </header>

          <div className="assembly-card__details">
            <label className="assembly-operation-card__description">
              <span>Description</span>
              <textarea
                aria-label={`${title} description`}
                placeholder="describe this instruction."
                value={description}
                readOnly={readOnly}
                onFocus={onFocusCard}
                onChange={(event) => {
                  if (readOnly) return
                  actions.onTextChange(operation.id, event.currentTarget.value)
                  actions.onPropertyChange?.(
                    operation.id,
                    OSA_PROPERTY.operationInstructionMode,
                    'single',
                  )
                }}
                style={transparentInput}
              />
            </label>

            <AssemblyInstructionVisuals
              operationId={operation.id}
              operationTitle={title}
              visuals={instructionVisuals}
              nodes={nodes}
              edges={edges}
              annotationTargets={annotationTargets}
              readOnly={readOnly}
              actions={actions}
              onEditVisual={onEditVisual}
            />

            <div className="assembly-operation-card__resources">
              <AssemblyPartsAndTools
                operation={operation}
                inputParts={inputParts}
                tools={tools}
                availableParts={availableParts}
                toolInventory={toolInventory}
                focused={focused}
                readOnly={readOnly}
                toolDraft={toolDraft}
                toolDraftFor={toolDraftFor}
                onInspectNode={onInspectNode}
                onLinkPart={actions.onLinkPart}
                onLinkPartInput={actions.onLinkPartInput}
                onUnlinkPartInput={actions.onUnlinkPartInput}
                onCreatePartForOperation={actions.onCreatePartForOperation}
                onCreateTool={actions.onCreateTool}
                onLinkTool={actions.onLinkTool}
                onUnlinkTool={actions.onUnlinkTool}
                onToolDraftChange={onToolDraftChange}
                onToolDraftForChange={onToolDraftForChange}
              />
            </div>
          </div>

          <nav className="assembly-operation-card__navigation" aria-label="Instruction navigation">
            <button type="button" disabled={!onPrevious} onClick={() => onPrevious?.()}>
              ← Previous
            </button>
            <button type="button" onClick={onClose}>
              All instructions
            </button>
            <span>{operationPosition} of {operationCount}</span>
            <button type="button" disabled={!onNext} onClick={() => onNext?.()}>
              Next →
            </button>
          </nav>
        </>
      ) : (
        <button
          className="assembly-card__summary"
          type="button"
          aria-label={`Open ${title} details`}
          aria-expanded={false}
          onClick={onOpen}
        >
          <span className="assembly-card__summary-heading">
            <strong className="assembly-card__summary-title">{title}</strong>
            <AssemblyOperationStatus operation={operation} />
          </span>
          {description.trim() ? (
            <span className="assembly-card__summary-notes">{description}</span>
          ) : null}
        </button>
      )}
    </article>
  )
}
