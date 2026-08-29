import { OSA_PROPERTY } from '../graph/osaData'
import type { SketchAnnotationTarget, TextFlowNode } from '../graph/textNode'
import { nodeTitle } from './assemblyProjection'
import { transparentInput } from './assemblyViewPresentation'
import type { AssemblyStepCanvas } from './assemblyViewTypes'
import { VisualCanvasPreview } from './VisualCanvas'
import './AssemblyOperationSteps.css'

type AssemblyOperationStepsProps = {
  operation: TextFlowNode
  steps: TextFlowNode[]
  stepCanvasByStepId: ReadonlyMap<string, TextFlowNode | undefined>
  stepCanvases: AssemblyStepCanvas[]
  annotationTargets: SketchAnnotationTarget[]
  focused: boolean
  readOnly: boolean
  onFocusCard: () => void
  onNameChange: (nodeId: string, name: string) => void
  onTextChange: (nodeId: string, text: string) => void
  onCreateStep: () => void
  onReorderStep: (stepId: string, direction: 'up' | 'down') => void
  onRemoveStep: (stepId: string) => void
  onEnsureStepCanvas: (stepId: string) => string
  onEditVisual: (visualId: string) => void
  onPropertyChange?: (nodeId: string, propertyName: string, value: string) => void
}

/** Ordered instruction text and Step-owned canvas controls for one card. */
export function AssemblyOperationSteps({
  operation,
  steps,
  stepCanvasByStepId,
  stepCanvases,
  annotationTargets,
  focused,
  readOnly,
  onFocusCard,
  onNameChange,
  onTextChange,
  onCreateStep,
  onReorderStep,
  onRemoveStep,
  onEnsureStepCanvas,
  onEditVisual,
  onPropertyChange,
}: AssemblyOperationStepsProps) {
  // All Step canvases drive authoring controls. Only deliberately published
  // canvases have a preview in the instruction card.
  const publishedCanvasByStepId = new Map(
    stepCanvases.map((stepCanvas) => [stepCanvas.step.id, stepCanvas]),
  )

  return (
    <section className="assembly-operation-steps" aria-label={`${nodeTitle(operation)} steps`}>
      <strong className="assembly-operation-steps__label">steps</strong>
      {steps.length === 0 ? (
        <textarea
          aria-label={`${nodeTitle(operation)} steps`}
          placeholder="write the first instruction here."
          rows={focused ? 6 : 3}
          value={operation.data.text}
          readOnly={readOnly}
          onFocus={onFocusCard}
          onChange={(event) => {
            if (!readOnly) onTextChange(operation.id, event.target.value)
          }}
          style={{ ...transparentInput, minHeight: focused ? '7.5em' : '3.9em', resize: 'none', lineHeight: 1.35 }}
        />
      ) : null}
      {steps.length ? (
        <ol className="assembly-operation-steps__list">
          {steps.map((step, stepIndex) => {
            const stepCanvas = stepCanvasByStepId.get(step.id)
            const publishedCanvas = publishedCanvasByStepId.get(step.id)
            const includeStepCanvas = stepCanvas?.data.properties[
              OSA_PROPERTY.visualIncludeInInstructions
            ] === 'true'
            return (
              <li className="assembly-operation-step" key={step.id}>
                <div className="assembly-operation-step__heading">
                  <input
                    className="assembly-operation-step__name"
                    aria-label={`Step ${stepIndex + 1} name`}
                    value={step.data.name}
                    readOnly={readOnly}
                    onClick={(event) => event.stopPropagation()}
                    onFocus={onFocusCard}
                    onChange={(event) => {
                      if (!readOnly) onNameChange(step.id, event.target.value)
                    }}
                  />
                  {!readOnly ? (
                    <span className="assembly-operation-step__reorder">
                      <button
                        className="text-action"
                        type="button"
                        aria-label={`move ${nodeTitle(step)} up`}
                        title="Move up"
                        disabled={stepIndex === 0}
                        onClick={(event) => {
                          event.stopPropagation()
                          onReorderStep(step.id, 'up')
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
                          onReorderStep(step.id, 'down')
                        }}
                      >
                        ↓
                      </button>
                    </span>
                  ) : null}
                </div>
                <textarea
                  aria-label={`${nodeTitle(step)} instructions`}
                  placeholder="describe this step."
                  rows={focused ? 3 : 2}
                  value={step.data.text}
                  readOnly={readOnly}
                  onClick={(event) => event.stopPropagation()}
                  onFocus={onFocusCard}
                  onChange={(event) => {
                    if (!readOnly) onTextChange(step.id, event.target.value)
                  }}
                  style={{
                    ...transparentInput,
                    minHeight: focused ? '3.9em' : '2.7em',
                    resize: 'none',
                    color: 'var(--osa-text)',
                    fontSize: '1.08rem',
                    lineHeight: 1.45,
                  }}
                />

                <div className="assembly-operation-step__canvas">
                  <div className="assembly-operation-step__canvas-header">
                    <strong>canvas</strong>
                    {!readOnly ? (
                      <div className="assembly-operation-step__canvas-actions">
                        <button
                          className="text-action assembly-operation-step__canvas-action"
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation()
                            const visualId = onEnsureStepCanvas(step.id)
                            if (visualId) onEditVisual(visualId)
                          }}
                        >
                          {stepCanvas ? 'open canvas' : 'add canvas'}
                        </button>
                        {stepCanvas && onPropertyChange ? (
                          <label onClick={(event) => event.stopPropagation()}>
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
                        <button
                          className="text-action assembly-operation-step__canvas-action is-remove"
                          type="button"
                          aria-label={`remove ${nodeTitle(step)}`}
                          onClick={(event) => {
                            event.stopPropagation()
                            onRemoveStep(step.id)
                          }}
                        >
                          remove
                        </button>
                      </div>
                    ) : null}
                  </div>

                  {publishedCanvas ? (
                    <button
                      className="assembly-instructions-view__open-canvas"
                      type="button"
                      aria-label={`open ${nodeTitle(step)} visual`}
                      title="Open visual"
                      onClick={(event) => {
                        event.stopPropagation()
                        onEditVisual(publishedCanvas.canvas.id)
                      }}
                    >
                      <VisualCanvasPreview
                        visual={publishedCanvas.canvas}
                        embeddedVisuals={publishedCanvas.embeddedVisuals}
                        annotationTargets={annotationTargets}
                        className="assembly-card__visual-preview"
                      />
                    </button>
                  ) : !readOnly ? (
                    <p className="assembly-operation-step__canvas-empty">
                      {stepCanvas
                        ? 'publish this canvas to show it in the instruction card.'
                        : 'add a canvas for this step.'}
                    </p>
                  ) : null}
                </div>
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
            onCreateStep()
          }}
          style={{ justifySelf: 'start' }}
        >
          add step
        </button>
      ) : null}
    </section>
  )
}
