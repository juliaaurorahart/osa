import type { SketchAnnotationTarget, TextFlowNode } from '../graph/textNode'
import type { AssemblyToolDraft } from './assemblyViewState'
import { AssemblyOperationSteps } from './AssemblyOperationSteps'
import { AssemblyPartsAndTools } from './AssemblyPartsAndTools'
import { OSA_PROPERTY } from '../graph/osaData'
import { nodeTitle, operationCompletedCount } from './assemblyProjection'
import {
  cardFocusStyle,
  cardKeyDown,
  cardShell,
  transparentInput,
} from './assemblyViewPresentation'
import { AssemblyStepVisualSummary } from './AssemblyStepVisuals'
import type { AssemblyStepCanvas, AssemblyViewActions } from './assemblyViewTypes'
import './AssemblyOperationCard.css'

type AssemblyOperationCardProps = {
  operation: TextFlowNode
  inputParts: TextFlowNode[]
  tools: TextFlowNode[]
  availableParts: TextFlowNode[]
  toolInventory: TextFlowNode[]
  steps: TextFlowNode[]
  stepCanvasByStepId: ReadonlyMap<string, TextFlowNode | undefined>
  stepCanvases: AssemblyStepCanvas[]
  annotationTargets: SketchAnnotationTarget[]
  focused: boolean
  isOpen: boolean
  readOnly: boolean
  toolDraft: string
  toolDraftFor: AssemblyToolDraft | null
  actions: AssemblyViewActions
  onInspectNode: (nodeId: string) => void
  onOpen: () => void
  onClose: () => void
  onFocusCard: () => void
  onEditVisual: (visualId: string) => void
  onToolDraftChange: (value: string) => void
  onToolDraftForChange: (value: AssemblyToolDraft | null) => void
}

/** One instruction card in either compact document or expanded authoring mode. */
export function AssemblyOperationCard({
  operation,
  inputParts,
  tools,
  availableParts,
  toolInventory,
  steps,
  stepCanvasByStepId,
  stepCanvases,
  annotationTargets,
  focused,
  isOpen,
  readOnly,
  toolDraft,
  toolDraftFor,
  actions,
  onInspectNode,
  onOpen,
  onClose,
  onFocusCard,
  onEditVisual,
  onToolDraftChange,
  onToolDraftForChange,
}: AssemblyOperationCardProps) {
  const publishedCanvasByStepId = new Map(
    stepCanvases.map((stepCanvas) => [stepCanvas.step.id, stepCanvas]),
  )
  const completedCount = operationCompletedCount(operation)

  return (
    <article
      className={`assembly-card assembly-operation-card${isOpen ? ' is-focused is-open' : ' is-summary'}`}
      style={isOpen
        ? undefined
        : { ...cardShell, padding: 0, ...cardFocusStyle(false) }}
      tabIndex={0}
      aria-label={`${nodeTitle(operation)} card`}
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
              aria-label={`${nodeTitle(operation)} title`}
              placeholder="card title"
              value={operation.data.name}
              readOnly={readOnly}
              onFocus={onFocusCard}
              onChange={(event) => {
                if (!readOnly) actions.onNameChange(operation.id, event.target.value)
              }}
              style={transparentInput}
            />
            <div className="assembly-card__focus-controls">
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
                    aria-label={`${nodeTitle(operation)} number complete`}
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

          <div className="assembly-card__columns">
            <div className="assembly-card__details">
              <AssemblyOperationSteps
                operation={operation}
                steps={steps}
                stepCanvasByStepId={stepCanvasByStepId}
                stepCanvases={stepCanvases}
                annotationTargets={annotationTargets}
                focused={focused}
                readOnly={readOnly}
                onFocusCard={onFocusCard}
                onNameChange={actions.onNameChange}
                onTextChange={actions.onTextChange}
                onCreateStep={() => actions.onCreateStep(operation.id)}
                onReorderStep={(stepId, direction) => actions.onReorderStep(operation.id, stepId, direction)}
                onRemoveStep={(stepId) => actions.onRemoveStep(operation.id, stepId)}
                onEnsureStepCanvas={actions.onEnsureStepCanvas}
                onEditVisual={onEditVisual}
                onPropertyChange={actions.onPropertyChange}
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
          </div>
        </>
      ) : (
        <button
          className="assembly-card__summary"
          type="button"
          aria-label={`Open ${nodeTitle(operation)} details`}
          aria-expanded={false}
          onClick={onOpen}
        >
          <span className="assembly-card__summary-content">
            <span className="assembly-card__summary-heading">
              <strong className="assembly-card__summary-title">{nodeTitle(operation)}</strong>
              <span className="assembly-operation-card__status">
                <b>{completedCount}</b> complete
              </span>
            </span>
            <span className="assembly-card__summary-parts-tools">
              <b>parts &amp; tools</b>
              <span className="assembly-card__summary-fields">
                {inputParts.length ? (
                  <span>
                    <b>parts</b>
                    {inputParts.map(nodeTitle).join(' · ')}
                  </span>
                ) : null}
                {tools.length ? (
                  <span>
                    <b>tools</b>
                    {tools.map(nodeTitle).join(' · ')}
                  </span>
                ) : null}
              </span>
            </span>
            {steps.length ? (
              <span className="assembly-card__summary-steps">
                <b>steps</b>
                {steps.map((step) => {
                  const stepCanvas = publishedCanvasByStepId.get(step.id)

                  return (
                    <span className="assembly-card__summary-step" key={step.id}>
                      <strong>{nodeTitle(step)}</strong>
                      {step.data.text.trim() ? <span>{step.data.text}</span> : null}
                      {stepCanvas ? (
                        <AssemblyStepVisualSummary
                          stepCanvas={stepCanvas}
                          annotationTargets={annotationTargets}
                        />
                      ) : null}
                    </span>
                  )
                })}
              </span>
            ) : operation.data.text.trim() ? (
              <span className="assembly-card__summary-steps">
                <b>steps</b>
                <span className="assembly-card__summary-notes">
                  {operation.data.text}
                </span>
              </span>
            ) : null}
          </span>
        </button>
      )}
    </article>
  )
}
