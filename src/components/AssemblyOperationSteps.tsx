import { OSA_PROPERTY } from '../graph/osaData'
import type { TextFlowNode } from '../graph/textNode'
import { nodeTitle } from './assemblyProjection'
import { transparentInput } from './assemblyViewPresentation'

type AssemblyOperationStepsProps = {
  operation: TextFlowNode
  steps: TextFlowNode[]
  stepCanvasByStepId: ReadonlyMap<string, TextFlowNode | undefined>
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
  return (
    <section style={{ display: 'grid', gap: 5, minWidth: 0 }} aria-label={`${nodeTitle(operation)} steps`}>
      <strong style={{ fontSize: 'clamp(0.76rem, 1.5vw, 1.15rem)', fontWeight: 500 }}>steps</strong>
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
        <ol style={{ display: 'grid', gap: 14, margin: 0, padding: 0, listStyle: 'none' }}>
          {steps.map((step, stepIndex) => {
            const stepCanvas = stepCanvasByStepId.get(step.id)
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
                    onFocus={onFocusCard}
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
                    <button
                      className="text-action"
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation()
                        const visualId = onEnsureStepCanvas(step.id)
                        if (visualId) onEditVisual(visualId)
                      }}
                    >
                      {stepCanvas ? 'canvas' : '+ canvas'}
                    </button>
                    <button
                      className="text-action"
                      type="button"
                      aria-label={`remove ${nodeTitle(step)}`}
                      onClick={(event) => {
                        event.stopPropagation()
                        onRemoveStep(step.id)
                      }}
                    >
                      remove
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
                  onFocus={onFocusCard}
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
