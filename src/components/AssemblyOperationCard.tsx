import type { SketchAnnotationTarget, TextFlowNode } from '../graph/textNode'
import type { AssemblyToolDraft } from './assemblyViewState'
import { AssemblyOperationSteps } from './AssemblyOperationSteps'
import { AssemblyPartsAndTools } from './AssemblyPartsAndTools'
import { nodeTitle } from './assemblyProjection'
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
  isLocked: boolean
  readOnly: boolean
  toolDraft: string
  toolDraftFor: AssemblyToolDraft | null
  actions: AssemblyViewActions
  onInspectNode: (nodeId: string) => void
  onOpen: () => void
  onClose: () => void
  onToggleLock: () => void
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
  isLocked,
  readOnly,
  toolDraft,
  toolDraftFor,
  actions,
  onInspectNode,
  onOpen,
  onClose,
  onToggleLock,
  onFocusCard,
  onEditVisual,
  onToolDraftChange,
  onToolDraftForChange,
}: AssemblyOperationCardProps) {
  const publishedCanvasByStepId = new Map(
    stepCanvases.map((stepCanvas) => [stepCanvas.step.id, stepCanvas]),
  )

  return (
    <article
      className={`assembly-card assembly-operation-card${isOpen ? ' is-focused is-open' : ' is-summary'}`}
      style={{ ...cardShell, ...(isOpen ? {} : { padding: 0 }), ...cardFocusStyle(isOpen) }}
      tabIndex={0}
      aria-label={`${nodeTitle(operation)} card`}
      onClick={() => {
        if (!isOpen) onOpen()
      }}
      onKeyDown={(event) => cardKeyDown(event, onOpen)}
    >
      {isOpen ? (
        <>
          <div className="assembly-card__focus-controls">
            <button
              className="assembly-card__close-button"
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                onClose()
              }}
            >
              close details
            </button>
            <button
              className="assembly-card__lock-button"
              type="button"
              aria-pressed={isLocked}
              aria-label={isLocked
                ? `unlock ${nodeTitle(operation)} and show all cards`
                : `lock ${nodeTitle(operation)} in a single-card view`}
              onClick={(event) => {
                event.stopPropagation()
                onToggleLock()
              }}
            >
              {isLocked ? 'unlock card view' : 'lock this card'}
            </button>
          </div>

          <div className="assembly-card__columns">
            <div className="assembly-card__details">
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
                style={{
                  ...transparentInput,
                  fontSize: 'clamp(1.4rem, 2.4vw, 2.3rem)',
                  lineHeight: 1.05,
                }}
              />

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
            <strong className="assembly-card__summary-title">{nodeTitle(operation)}</strong>
            <span className="assembly-card__summary-parts-tools">
              <b>parts &amp; tools</b>
              <span className="assembly-card__summary-fields">
                {inputParts.length ? (
                  <span>
                    <b>parts in</b>
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
